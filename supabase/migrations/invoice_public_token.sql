-- ============================================================
-- Invoice público con link de pago (/pay/) — 2026-07-15
-- ============================================================
-- invoice_number YA EXISTE como integer con secuencia propia
-- (nextval('invoices_invoice_number_seq')) — no se toca, sigue
-- siendo la fuente de verdad numérica (mismo patrón que
-- jobs.job_number). El formato legible "INV-2026-0007" se genera
-- en la vista pública de abajo y en el JS del cliente, nunca se
-- guarda como texto en la tabla real.
-- sent_at y adjustments ya existían desde Fase B — sin cambios ahí.
-- ============================================================

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS public_token uuid,
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS comment text,
ADD COLUMN IF NOT EXISTS due_by date,
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_idx
ON invoices (public_token)
WHERE public_token IS NOT NULL;

-- ============================================================
-- Vista pública para pay/index.html
-- ============================================================
-- Decisión de seguridad (distinta al patrón sugerido originalmente):
-- NO se le da a `anon` una policy de RLS directa sobre la tabla base
-- `invoices` — eso permitiría consultar /rest/v1/invoices?... directo
-- y traer columnas de más (notes, tax_rate, service_id, etc.), y
-- además `customers`/`jobs`/`vehicles` no tienen ninguna policy para
-- `anon` desde la auditoría de seguridad de hoy (correctamente, son
-- datos de clientes). En vez de abrir esas tablas a `anon`, la vista
-- hace el JOIN internamente (corre con los privilegios del dueño de
-- la vista, no de quien consulta) y expone solo los campos de
-- visualización que /pay/ necesita — mismo patrón ya probado con
-- business_settings_public en Fase A.
CREATE OR REPLACE VIEW public.invoices_public AS
SELECT
  i.id,
  i.public_token,
  ('INV-' || to_char(i.created_at, 'YYYY') || '-' || lpad(i.invoice_number::text, 4, '0')) AS invoice_display_number,
  i.title,
  i.comment,
  i.due_by,
  i.status,
  i.original_amount,
  i.original_service_name,
  i.adjustments,
  i.final_amount,
  i.amount_paid,
  i.sent_at,
  i.paid_at,
  i.created_at,
  i.business_id,
  c.full_name AS customer_name,
  c.email     AS customer_email,
  c.phone     AS customer_phone,
  c.address   AS service_address,
  j.category  AS job_category,
  j.package   AS job_package,
  j.service_date,
  v.year  AS vehicle_year,
  v.make  AS vehicle_make,
  v.model AS vehicle_model,
  v.color AS vehicle_color
FROM public.invoices i
LEFT JOIN public.customers c ON c.id = i.customer_id
LEFT JOIN public.jobs j ON j.id = i.job_id
LEFT JOIN LATERAL (
  SELECT vv.year, vv.make, vv.model, vv.color
  FROM public.job_vehicles jv
  JOIN public.vehicles vv ON vv.id = jv.vehicle_id
  WHERE jv.job_id = i.job_id
  LIMIT 1
) v ON true
-- Solo facturas explícitamente enviadas (sent_at) con token real —
-- nunca un draft, sin importar quién consulte la vista.
WHERE i.public_token IS NOT NULL
  AND i.sent_at IS NOT NULL;

GRANT SELECT ON public.invoices_public TO anon;
