-- Small additive columns needed by the admin Settings > Booking Settings
-- and Settings > Notifications tabs, which the original phase_a_multitenant
-- schema didn't include a place for (available days/time slots, per-email
-- toggles). Nullable / defaulted, non-breaking.

alter table business_settings add column if not exists available_days jsonb default '["Mon","Tue","Wed","Thu","Fri","Sat"]'::jsonb;
alter table business_settings add column if not exists available_time_slots jsonb default '["8:00 AM","10:00 AM","12:00 PM","2:00 PM","4:00 PM"]'::jsonb;
alter table business_settings add column if not exists email_toggles jsonb default '{"booking_confirmation":true,"job_confirmed":true,"reminder_24h":true,"job_completed":true,"internal_notification":true}'::jsonb;

-- These are non-secret, needed for rendering the public booking widget's
-- calendar/time picker too, so expose them through the safe view as well.
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
  is_active,
  available_days, available_time_slots
FROM public.business_settings;
-- Deliberately excluded: square_access_token, stripe_secret_key, email_toggles (internal-only)
