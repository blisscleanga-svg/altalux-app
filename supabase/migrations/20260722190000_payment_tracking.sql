-- ============================================================
-- Payment Tracking — trazabilidad completa de pagos en tiempo real
-- 2026-07-22
-- ============================================================
-- payment_events es un log de interacción con el link de pago (link
-- abierto, pago iniciado, completado, fallido) — separado de
-- invoice_payments (que ya registra el pago real cobrado, sin
-- tocarse). Las columnas nuevas en invoices son para no tener que
-- hacer join con payment_events en las queries simples del modal.
--
-- Nota (confirmado en el análisis de STEP 0): `paid_at` ya existía en
-- invoices desde invoice_public_token.sql (2026-07-15) — no se repite
-- acá. `notification_email` ya existía en business_settings desde
-- phase_a_multitenant.sql y ya está en uso real (internal_notification)
-- — tampoco se toca.
-- ============================================================

-- ============================================================
-- Columnas de tracking en invoices
-- ============================================================
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS link_opened_at     timestamptz,
  ADD COLUMN IF NOT EXISTS link_open_count    int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_brand         text,
  ADD COLUMN IF NOT EXISTS card_last4         text,
  ADD COLUMN IF NOT EXISTS square_payment_id  text;

-- ============================================================
-- Tabla payment_events
-- ============================================================
-- business_id es TEXT (no uuid) — mismo patrón que jobs/customers/
-- payments/invoices/invoice_payments en todo el proyecto. No existe
-- una tabla `businesses` separada con PK uuid (confirmado en STEP 0
-- contra phase_a_multitenant.sql) — referenciar esa tabla habría
-- roto la migración.
CREATE TABLE IF NOT EXISTS payment_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid REFERENCES invoices(id) ON DELETE CASCADE,
  business_id  text REFERENCES business_settings(business_id),
  job_id       uuid REFERENCES jobs(id),
  event_type   text NOT NULL
    CHECK (event_type IN (
      'link_opened',       -- cliente abrió pay/?token=
      'payment_started',   -- cliente presionó el botón de pagar
      'payment_completed', -- Square confirmó el pago (server-side)
      'payment_failed'     -- Square rechazó el pago
    )),
  occurred_at  timestamptz DEFAULT now(),
  metadata     jsonb DEFAULT '{}'
  -- link_opened:       { user_agent, device_type: 'mobile'|'desktop' }
  -- payment_completed: { card_brand, card_last4, square_payment_id, amount }
  -- payment_failed:    { error_code, error_message }
);

CREATE INDEX IF NOT EXISTS idx_payment_events_invoice
  ON payment_events(invoice_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_business
  ON payment_events(business_id, occurred_at DESC);

-- RLS: mismo patrón que el resto del proyecto (current_business_id(),
-- ver security_rls_audit_part2.sql) — empleados autenticados solo leen
-- eventos de su propio negocio. Nadie tiene DELETE (rastro de
-- auditoría, mismo criterio que payments/invoice_payments/invoice_refunds).
-- INSERT solo vía service_role desde las Edge Functions — no hace
-- falta policy de INSERT para `authenticated`.
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_payment_events" ON payment_events
  FOR SELECT TO authenticated
  USING (business_id = current_business_id());

-- ============================================================
-- Habilitar Realtime en payment_events
-- ============================================================
-- Sin REPLICA IDENTITY FULL + ALTER PUBLICATION, el canal de Realtime
-- se conecta pero nunca recibe eventos (falla silenciosa muy común).
-- El bloque DO evita error si esta migración se corriera dos veces.
ALTER TABLE payment_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payment_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payment_events;
  END IF;
END $$;

-- ============================================================
-- RPC de incremento atómico de link_open_count
-- ============================================================
-- Evita race condition si el cliente abre el link en 2 tabs a la vez
-- (ambas leerían el mismo valor viejo y se pisarían con un UPDATE
-- normal desde el cliente/Edge Function).
CREATE OR REPLACE FUNCTION increment_link_open_count(inv_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE invoices
  SET link_open_count = COALESCE(link_open_count, 0) + 1
  WHERE id = inv_id;
$$;
