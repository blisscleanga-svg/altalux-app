-- ============================================================
-- AltaLux Admin — RLS policies to allow authenticated writes
-- ============================================================
-- Context: the anon key can SELECT everything and INSERT into
-- `bookings` (the public booking widget), but cannot write to
-- any other table. These policies grant INSERT/UPDATE/DELETE to
-- the `authenticated` role (i.e. a real logged-in Supabase Auth
-- user — the admin dashboard), while the public `anon` role
-- keeps its current read-only + bookings-insert-only access.
--
-- Run this once in the Supabase SQL Editor.
-- ============================================================

-- customers
CREATE POLICY "authenticated_insert_customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_customers" ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_customers" ON public.customers FOR DELETE TO authenticated USING (true);

-- vehicles
CREATE POLICY "authenticated_insert_vehicles" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_vehicles" ON public.vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_vehicles" ON public.vehicles FOR DELETE TO authenticated USING (true);

-- jobs
CREATE POLICY "authenticated_insert_jobs" ON public.jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_jobs" ON public.jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_jobs" ON public.jobs FOR DELETE TO authenticated USING (true);

-- job_vehicles
CREATE POLICY "authenticated_insert_job_vehicles" ON public.job_vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_job_vehicles" ON public.job_vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_job_vehicles" ON public.job_vehicles FOR DELETE TO authenticated USING (true);

-- job_addons
CREATE POLICY "authenticated_insert_job_addons" ON public.job_addons FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_job_addons" ON public.job_addons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_job_addons" ON public.job_addons FOR DELETE TO authenticated USING (true);

-- payments
CREATE POLICY "authenticated_insert_payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_payments" ON public.payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_payments" ON public.payments FOR DELETE TO authenticated USING (true);

-- invoices
CREATE POLICY "authenticated_insert_invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_invoices" ON public.invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_invoices" ON public.invoices FOR DELETE TO authenticated USING (true);

-- bookings: anon can already INSERT (public widget); admin (authenticated)
-- additionally needs UPDATE (Convert to Job / Dismiss) and DELETE (cleanup).
CREATE POLICY "authenticated_update_bookings" ON public.bookings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_bookings" ON public.bookings FOR DELETE TO authenticated USING (true);
