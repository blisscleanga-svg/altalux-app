-- ============================================================
-- Fase 5, Sub-fase 1+2 — SMS vía Twilio: tablas de mensajes,
-- opt-outs, y toggle por negocio.
-- Ver docs/superpowers/specs/2026-09-02-sms-subfase-1-2-design.md
--
-- Todos los INSERT a sms_messages/sms_opt_outs vienen de las Edge
-- Functions send-sms / twilio-webhook con la service role key (que
-- bypassea RLS) — nunca del cliente autenticado directo. Por eso no
-- hay policy de INSERT para `authenticated` en ninguna de las dos
-- tablas, y no hace falta el trigger set_business_id_from_context
-- (20260808200000_fix_business_id_default_trigger.sql) que sí
-- necesitan las tablas con inserts directos desde admin/index.html.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id text NOT NULL REFERENCES public.business_settings(business_id),
  customer_id uuid REFERENCES public.customers(id),
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body text NOT NULL,
  twilio_sid text,
  status text NOT NULL DEFAULT 'queued',
  action text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_business_phone_created
  ON public.sms_messages (business_id, phone, created_at);

CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  business_id text NOT NULL REFERENCES public.business_settings(business_id),
  phone text NOT NULL,
  opted_out_at timestamptz,
  PRIMARY KEY (business_id, phone)
);

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS sms_toggles jsonb DEFAULT '{"booking_confirmation":true}'::jsonb;

-- RLS: solo empleados autenticados del mismo negocio pueden LEER
-- sms_messages (Message Center del admin) y marcar mensajes como
-- leídos (UPDATE de `read`). Sin policy de INSERT a propósito (ver
-- comentario arriba).
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_sms_messages_same_business"
  ON public.sms_messages FOR SELECT TO authenticated
  USING (business_id = current_business_id());

CREATE POLICY "auth_update_sms_messages_same_business"
  ON public.sms_messages FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- sms_opt_outs: service_role only (send-sms lo consulta antes de
-- enviar, twilio-webhook lo escribe en STOP/START) — el admin no
-- tiene UI que lo lea en esta sub-fase, así que ninguna policy para
-- `authenticated`.
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
