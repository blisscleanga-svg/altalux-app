-- RLS for the Phase A multi-tenant tables.
--
-- business_services / business_addons: public catalog data (prices,
-- descriptions), no secrets. Follows the same convention as the rest of
-- this app (see rls_policies_authenticated_writes.sql): anon can SELECT,
-- only `authenticated` (logged-in admin) can write.
--
-- business_settings is different: it holds real payment credentials
-- (square_access_token, stripe_secret_key) alongside public branding
-- data (name, colors, deposit %, square_app_id/location_id — those two
-- are publishable IDs, not secrets, and are meant to be read client-side
-- by the Square Web Payments SDK). Row-level access stays open like the
-- rest of the app, but the two genuinely secret columns are revoked from
-- anon/authenticated at the column-privilege level so PostgREST can never
-- return them to the browser. Only service_role (used server-side in the
-- Edge Functions, which bypasses RLS/grants entirely) can read them.

ALTER TABLE business_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_business_services" ON public.business_services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_insert_business_services" ON public.business_services FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_business_services" ON public.business_services FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_business_services" ON public.business_services FOR DELETE TO authenticated USING (true);

ALTER TABLE business_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_business_addons" ON public.business_addons FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_insert_business_addons" ON public.business_addons FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_business_addons" ON public.business_addons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_business_addons" ON public.business_addons FOR DELETE TO authenticated USING (true);

ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_business_settings" ON public.business_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_insert_business_settings" ON public.business_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_business_settings" ON public.business_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_business_settings" ON public.business_settings FOR DELETE TO authenticated USING (true);

-- Column-level lockdown: even though the row is selectable above, these
-- two columns must never reach anon or a merely-authenticated employee
-- session. Grant table SELECT first (Postgres column REVOKE requires an
-- existing grant to narrow), then explicitly revoke just the secrets.
GRANT SELECT ON public.business_settings TO anon, authenticated;
REVOKE SELECT (square_access_token, stripe_secret_key) ON public.business_settings FROM anon, authenticated;
