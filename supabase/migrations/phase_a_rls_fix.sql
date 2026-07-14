-- The previous column-level REVOKE (phase_a_rls.sql) did not actually
-- block anon from reading square_access_token / stripe_secret_key —
-- verified by writing a test value and confirming it was readable via
-- the anon key. Supabase's default schema-level grants apparently
-- override a narrower per-column REVOKE. Switching to the standard,
-- reliable pattern instead: fully revoke table access from anon/
-- authenticated on the base table, and expose only a safe-column view.

REVOKE ALL ON public.business_settings FROM anon, authenticated;

CREATE OR REPLACE VIEW public.business_settings_public AS
SELECT
  id, created_at, business_id, name, email, phone, address, city, state, zip,
  website, logo_url,
  primary_color, secondary_color, accent_color, background_color,
  deposit_percentage, cancellation_hours, late_fee, cancellation_policy,
  notification_email, booking_url, admin_url, technician_url,
  square_app_id, square_location_id, square_environment, square_enabled,
  stripe_public_key, stripe_enabled,
  resend_from_email, resend_from_name, resend_enabled,
  twilio_phone, twilio_enabled,
  is_active
FROM public.business_settings;
-- Deliberately excluded: square_access_token, stripe_secret_key

GRANT SELECT ON public.business_settings_public TO anon, authenticated;

-- The admin dashboard (Settings page) needs full read/write on the real
-- table including secrets, but only as an authenticated employee. Keep
-- authenticated's existing SELECT/INSERT/UPDATE/DELETE policies on the
-- base table (they still apply once table-level GRANT exists for that role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_settings TO authenticated;
