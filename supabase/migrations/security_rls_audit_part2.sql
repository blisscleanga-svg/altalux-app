-- ============================================================
-- Auditoría de seguridad 2026-07-15 — Parte 2
-- (Hallazgo #1 — anon SELECT en bookings — ya se cerró en
--  security_fix_bookings_anon_select.sql, aparte)
-- ============================================================
-- Cubre: filtrado por business_id (riesgo cross-tenant), roles
-- Owner/Technician en business_settings y employees, quitar DELETE
-- de tablas financieras, y la tabla audit_log.
--
-- Bloqueador que existía: no hay columna employees.user_id que
-- vincule una fila con auth.uid(), así que el patrón del prompt
-- original (`WHERE user_id = auth.uid()`) no es viable hoy sin una
-- migración de schema + backfill. En su lugar se usa el mismo patrón
-- que YA está en producción y probado (manage-employee-auth/index.ts):
-- emparejar por email, vía `auth.jwt() ->> 'email'` (el email viene
-- en el JWT de cada request, no hace falta una columna nueva).
-- Documentado como decisión, no como fallback temporal — es el mismo
-- mecanismo de identidad que ya usa el resto de la app.

-- ---------- Funciones auxiliares ----------
-- SECURITY DEFINER: su propia consulta a `employees` corre sin pasar
-- por las policies de `employees` (evita recursión cuando se usan
-- estas funciones DENTRO de una policy de `employees`).
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT business_id FROM public.employees
  WHERE lower(email) = lower(auth.jwt() ->> 'email') AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE lower(email) = lower(auth.jwt() ->> 'email')
      AND role = 'Owner' AND is_active = true
  );
$$;

-- ============================================================
-- employees
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on employees" ON public.employees;

CREATE POLICY "auth_select_employees_same_business"
  ON public.employees FOR SELECT TO authenticated
  USING (business_id = current_business_id());

CREATE POLICY "owner_insert_employees"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_update_employees"
  ON public.employees FOR UPDATE TO authenticated
  USING (is_owner() AND business_id = current_business_id())
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_delete_employees"
  ON public.employees FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- ============================================================
-- business_settings — solo Owner, nunca DELETE
-- ============================================================
DROP POLICY IF EXISTS "anon_select_business_settings" ON public.business_settings; -- ya inerte (REVOKE ALL en phase_a_rls_fix), se limpia por claridad
DROP POLICY IF EXISTS "authenticated_insert_business_settings" ON public.business_settings;
DROP POLICY IF EXISTS "authenticated_update_business_settings" ON public.business_settings;
DROP POLICY IF EXISTS "authenticated_delete_business_settings" ON public.business_settings;

CREATE POLICY "owner_select_business_settings"
  ON public.business_settings FOR SELECT TO authenticated
  USING (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_insert_business_settings"
  ON public.business_settings FOR INSERT TO authenticated
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_update_business_settings"
  ON public.business_settings FOR UPDATE TO authenticated
  USING (is_owner() AND business_id = current_business_id())
  WITH CHECK (is_owner() AND business_id = current_business_id());
-- Sin policy de DELETE a propósito: nadie borra la fila de configuración de un negocio desde el cliente.

-- ============================================================
-- business_services / business_addons
-- anon: solo activos (antes veía TODO, incluyendo inactivos/borrados)
-- authenticated: solo Owner puede escribir; lectura sigue abierta a
-- cualquier empleado del mismo negocio (Settings lo necesita).
-- ============================================================
DROP POLICY IF EXISTS "anon_select_business_services" ON public.business_services;
DROP POLICY IF EXISTS "authenticated_insert_business_services" ON public.business_services;
DROP POLICY IF EXISTS "authenticated_update_business_services" ON public.business_services;
DROP POLICY IF EXISTS "authenticated_delete_business_services" ON public.business_services;

CREATE POLICY "anon_select_active_business_services"
  ON public.business_services FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "auth_select_business_services_same_business"
  ON public.business_services FOR SELECT TO authenticated
  USING (business_id = current_business_id());

CREATE POLICY "owner_insert_business_services"
  ON public.business_services FOR INSERT TO authenticated
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_update_business_services"
  ON public.business_services FOR UPDATE TO authenticated
  USING (is_owner() AND business_id = current_business_id())
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_delete_business_services"
  ON public.business_services FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

DROP POLICY IF EXISTS "anon_select_business_addons" ON public.business_addons;
DROP POLICY IF EXISTS "authenticated_insert_business_addons" ON public.business_addons;
DROP POLICY IF EXISTS "authenticated_update_business_addons" ON public.business_addons;
DROP POLICY IF EXISTS "authenticated_delete_business_addons" ON public.business_addons;

CREATE POLICY "anon_select_active_business_addons"
  ON public.business_addons FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "auth_select_business_addons_same_business"
  ON public.business_addons FOR SELECT TO authenticated
  USING (business_id = current_business_id());

CREATE POLICY "owner_insert_business_addons"
  ON public.business_addons FOR INSERT TO authenticated
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_update_business_addons"
  ON public.business_addons FOR UPDATE TO authenticated
  USING (is_owner() AND business_id = current_business_id())
  WITH CHECK (is_owner() AND business_id = current_business_id());

CREATE POLICY "owner_delete_business_addons"
  ON public.business_addons FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- ============================================================
-- customers / vehicles — cualquier empleado del negocio puede
-- ver/crear/editar; solo Owner puede borrar.
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on customers" ON public.customers;

CREATE POLICY "auth_select_customers_same_business"
  ON public.customers FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_customers_same_business"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_customers_same_business"
  ON public.customers FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_customers"
  ON public.customers FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

DROP POLICY IF EXISTS "Allow all for authenticated on vehicles" ON public.vehicles;

CREATE POLICY "auth_select_vehicles_same_business"
  ON public.vehicles FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_vehicles_same_business"
  ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_vehicles_same_business"
  ON public.vehicles FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_vehicles"
  ON public.vehicles FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- ============================================================
-- bookings — solo la parte de `authenticated` (anon ya se corrigió
-- por separado). El admin necesita ver/gestionar los bookings de SU
-- negocio únicamente.
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on bookings" ON public.bookings;

CREATE POLICY "auth_select_bookings_same_business"
  ON public.bookings FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_bookings_same_business"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_bookings_same_business"
  ON public.bookings FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_bookings"
  ON public.bookings FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- ============================================================
-- jobs / job_addons / job_vehicles
-- job_addons y job_vehicles no tienen su propia columna business_id
-- (son líneas hijas de jobs) — se filtran vía EXISTS contra jobs.
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on jobs" ON public.jobs;

CREATE POLICY "auth_select_jobs_same_business"
  ON public.jobs FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_jobs_same_business"
  ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_jobs_same_business"
  ON public.jobs FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_jobs"
  ON public.jobs FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

DROP POLICY IF EXISTS "Allow all for authenticated on job_addons" ON public.job_addons;

CREATE POLICY "auth_all_job_addons_same_business"
  ON public.job_addons FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_addons.job_id AND j.business_id = current_business_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_addons.job_id AND j.business_id = current_business_id()));

DROP POLICY IF EXISTS "Allow all for authenticated on job_vehicles" ON public.job_vehicles;

CREATE POLICY "auth_all_job_vehicles_same_business"
  ON public.job_vehicles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_vehicles.job_id AND j.business_id = current_business_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_vehicles.job_id AND j.business_id = current_business_id()));

-- ============================================================
-- payments — nunca DELETE (rastro de auditoría financiera)
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on payments" ON public.payments;

CREATE POLICY "auth_select_payments_same_business"
  ON public.payments FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_payments_same_business"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_payments_same_business"
  ON public.payments FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
-- Sin policy de DELETE a propósito.

-- ============================================================
-- invoices
-- ============================================================
DROP POLICY IF EXISTS "Allow all for authenticated on invoices" ON public.invoices;

CREATE POLICY "auth_select_invoices_same_business"
  ON public.invoices FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_invoices_same_business"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_invoices_same_business"
  ON public.invoices FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- ============================================================
-- invoice_payments / invoice_refunds — nunca DELETE
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_invoice_payments" ON public.invoice_payments;

CREATE POLICY "auth_select_invoice_payments_same_business"
  ON public.invoice_payments FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_invoice_payments_same_business"
  ON public.invoice_payments FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_invoice_payments_same_business"
  ON public.invoice_payments FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

DROP POLICY IF EXISTS "authenticated_all_invoice_refunds" ON public.invoice_refunds;

CREATE POLICY "auth_select_invoice_refunds_same_business"
  ON public.invoice_refunds FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_invoice_refunds_same_business"
  ON public.invoice_refunds FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_invoice_refunds_same_business"
  ON public.invoice_refunds FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- ============================================================
-- audit_log (tabla nueva)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL,
  user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Las Edge Functions insertan con el service_role key (bypasea RLS).
-- Esta policy cubre el caso de que algún día se inserte directo desde
-- el cliente autenticado.
CREATE POLICY "auth_insert_audit_log_same_business"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());

CREATE POLICY "owner_select_audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (is_owner() AND business_id = current_business_id());

-- Sin UPDATE ni DELETE: el registro de auditoría es inmutable.
