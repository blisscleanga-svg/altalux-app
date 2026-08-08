-- ============================================================
-- Fix: business_id se quedaba en 'altalux' para cualquier tenant
-- nuevo del sistema SaaS.
--
-- Hallazgo (2026-08-08, investigando el bug de "assign job no llega
-- al empleado"): `jobs`, `customers`, `vehicles`, `bookings`,
-- `payments`, `invoices`, `employees`, `proposals`, `events`,
-- `invoice_payments` e `invoice_refunds` tienen su columna
-- `business_id` con `DEFAULT 'altalux'` desde que la app era
-- single-tenant (phase_a_multitenant.sql / phase_b_invoicing.sql /
-- 20260718120000_proposals_events_tables.sql). El frontend
-- (admin/index.html) tiene ~12 llamadas `.insert(...)` que nunca
-- incluyen `business_id` explícito — funcionaba solo porque el
-- default coincidía por casualidad con el único tenant real que
-- existía. Las políticas RLS agregadas después
-- (security_rls_audit_part2.sql) exigen
-- `business_id = current_business_id()` en el INSERT — así que para
-- CUALQUIER tenant que no sea 'altalux', todo insert sin
-- business_id explícito choca contra RLS (42501), silenciosamente
-- (el error se traga en un toast "saved locally only").
--
-- Fix a nivel de base de datos (no se tocan los ~12 call sites del
-- frontend, que quedarían frágiles/fáciles de olvidar en el próximo
-- insert nuevo): un trigger BEFORE INSERT que sobreescribe
-- business_id con el tenant real del usuario autenticado, cuando se
-- puede resolver. No afecta:
--   - anon (booking widget): auth.jwt()->>'email' es null (el anon
--     key no trae email) -> current_business_id() devuelve null ->
--     el trigger deja pasar el business_id explícito que sí manda
--     booking/index.html.
--   - service_role (Edge Functions, incl. manage-tenant creando el
--     primer employee de un tenant nuevo): su JWT tampoco tiene
--     'email' -> mismo passthrough, no interfiere con la creación de
--     tenants nuevos.
--   - un empleado autenticado normal: current_business_id() resuelve
--     su negocio real vía el mismo mecanismo que ya usan las
--     policies RLS -> el insert queda automáticamente en SU tenant,
--     sin depender de que el frontend lo mande bien.
-- Bonus de seguridad: un usuario autenticado ya no puede insertar
-- business_id de otro tenant aunque lo mande explícito en el
-- payload — siempre se fija al suyo.

CREATE OR REPLACE FUNCTION public.set_business_id_from_context()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  jwt_biz text;
BEGIN
  jwt_biz := public.current_business_id();
  IF jwt_biz IS NOT NULL THEN
    NEW.business_id := jwt_biz;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'jobs', 'customers', 'vehicles', 'bookings', 'payments',
    'invoices', 'employees', 'proposals', 'events',
    'invoice_payments', 'invoice_refunds'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_business_id ON public.%I;', t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_set_business_id BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_context();', t
    );
  END LOOP;
END $$;
