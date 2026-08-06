-- ============================================================
-- AltaLux App — SaaS Onboarding System (arquitectura y diseño)
-- 2026-08-05
-- ============================================================
-- Cualquier negocio de detailing puede aplicar por un wizard público
-- (onboarding/index.html), Luis (Super Admin) aprueba desde
-- platform/index.html, y el tenant obtiene su propio workspace. Los
-- cobros reales por tenant (Square OAuth por-negocio) son una fase
-- futura fuera de alcance — esta migración solo deja la arquitectura
-- lista (status, aprobación, catálogo inicial de templates).
-- ============================================================

-- ============================================================
-- Columnas nuevas en business_settings
-- ============================================================
alter table business_settings
  add column if not exists status text default 'pending',
  -- pending | approved | suspended | rejected
  add column if not exists slug text unique,
  add column if not exists owner_email text unique,
  add column if not exists onboarding_step integer default 0,
  add column if not exists setup_complete boolean default false,
  add column if not exists tos_accepted_at timestamp with time zone,
  add column if not exists approved_at timestamp with time zone,
  add column if not exists approved_by text,
  -- Ítem "Booking" del checklist de setup: deposit%/días/horarios ya
  -- traen defaults válidos desde que se crea la fila (no hay forma de
  -- distinguir "nunca lo revisó" de "eligió dejarlo igual" sin esto).
  add column if not exists booking_settings_confirmed boolean default false;

update business_settings
  set status = 'approved', slug = business_id, setup_complete = true,
      booking_settings_confirmed = true
  where business_id in ('altalux', 'blissclean');

-- ============================================================
-- 🔴 CRÍTICO: actualizar business_settings_public para incluir status.
-- shared/config.js lee esta VISTA, no la tabla base (ver
-- phase_a_rls_fix.sql) — sin este CREATE OR REPLACE, `settings.status`
-- llega undefined para TODOS los negocios (incluido altalux en
-- producción real) en cuanto se despliegue el check de status en
-- shared/config.js, mostrando la pantalla de bloqueo a todo el mundo.
-- Mismas columnas que ya tenía la vista + status. Se mantiene la
-- exclusión deliberada de owner_email (PII de otro tenant) y de las
-- columnas de credenciales.
-- ============================================================
-- Nota: la vista real en vivo tiene 2 columnas más que la versión
-- original documentada en phase_a_rls_fix.sql (available_days,
-- available_time_slots, agregadas después — confirmado consultando
-- information_schema.columns directo contra producción, ese archivo
-- había quedado desactualizado). Postgres exige que CREATE OR REPLACE
-- VIEW mantenga el orden exacto de las columnas existentes y solo
-- permite agregar nuevas al final — se respeta ese orden real acá.
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
  available_days, available_time_slots,
  status
FROM public.business_settings;
-- Deliberately excluded: square_access_token, stripe_secret_key,
-- owner_email (PII de otro tenant), slug/onboarding_step/setup_complete/
-- tos_accepted_at/approved_at/approved_by/booking_settings_confirmed
-- (uso interno de manage-tenant/admin, no hace falta exponerlos anon).

GRANT SELECT ON public.business_settings_public TO anon, authenticated;

-- ============================================================
-- Templates de plataforma — catálogo neutro que se copia a
-- business_services/business_addons de un tenant recién aprobado.
-- ============================================================
create table if not exists service_templates (
  id uuid default gen_random_uuid() primary key,
  category text not null,
  package text,
  vehicle_type text not null,
  suggested_price numeric not null,
  duration_minutes integer default 180,
  description text,
  included_items jsonb,
  sort_order integer default 0
);

create table if not exists addon_templates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  suggested_price numeric not null,
  price_varies boolean default false,
  description text,
  category text,
  sort_order integer default 0
);

-- Seed derivado en vivo del catálogo real de AltaLux (21 servicios + 10
-- add-ons, verificado) — nunca se tipean precios a mano, cero riesgo de
-- drift/typo entre lo que existe hoy y lo que queda en el template.
insert into service_templates (category, package, vehicle_type, suggested_price, duration_minutes, description, included_items, sort_order)
select category, package, vehicle_type, price, duration_minutes, description, included_items,
       row_number() over (order by category, package, vehicle_type)
from business_services
where business_id = 'altalux';

insert into addon_templates (name, suggested_price, price_varies, description, category, sort_order)
select name, price, price_varies, description, category,
       row_number() over (order by category, name)
from business_addons
where business_id = 'altalux';

-- RLS: catálogo público de solo-lectura para anon (decisión explícita del
-- spec original — es un espejo de precios de AltaLux que ya son públicos
-- vía business_services_public, no hay dato nuevo que proteger). El resto
-- de tablas de este sistema (business_settings cross-tenant) NO tiene
-- policy nueva para anon — todo eso pasa por manage-tenant con
-- service_role, ver Edge Function.
alter table service_templates enable row level security;
create policy "anon_select_service_templates" on service_templates
  for select to anon, authenticated using (true);

alter table addon_templates enable row level security;
create policy "anon_select_addon_templates" on addon_templates
  for select to anon, authenticated using (true);

-- ============================================================
-- TODO (deuda técnica documentada, no implementada en esta entrega):
-- cleanup automático de tenants 'pending' con más de 30 días sin
-- aprobar/rechazar — candidato a un cron job o Edge Function programada
-- que los marque 'rejected' o los notifique para revisión manual. No
-- se implementa acá porque requiere decidir la política exacta
-- (¿auto-rechazar? ¿solo avisar a Luis?) con Luis primero.
-- ============================================================
