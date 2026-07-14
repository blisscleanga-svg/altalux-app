-- BUSINESS SETTINGS
create table if not exists business_settings (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  business_id text unique not null,
  name text not null,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  website text,
  logo_url text,
  primary_color text default '#104872',
  secondary_color text default '#FF8C00',
  accent_color text default '#FFAA00',
  background_color text default '#0a1628',
  deposit_percentage numeric default 25,
  cancellation_hours integer default 72,
  late_fee numeric default 50,
  cancellation_policy text,
  notification_email text,
  booking_url text,
  admin_url text,
  technician_url text,
  square_app_id text,
  square_location_id text,
  square_access_token text,
  square_environment text default 'production',
  square_enabled boolean default false,
  stripe_public_key text,
  stripe_secret_key text,
  stripe_enabled boolean default false,
  resend_from_email text,
  resend_from_name text,
  resend_enabled boolean default false,
  twilio_phone text,
  twilio_enabled boolean default false,
  is_active boolean default true
);

-- BUSINESS SERVICES
create table if not exists business_services (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  business_id text references business_settings(business_id),
  category text not null,
  package text,
  vehicle_type text not null,
  price numeric not null,
  duration_minutes integer,
  description text,
  included_items jsonb,
  is_active boolean default true
);

-- BUSINESS ADDONS
create table if not exists business_addons (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  business_id text references business_settings(business_id),
  name text not null,
  price numeric not null,
  price_varies boolean default false,
  description text,
  category text,
  is_active boolean default true
);

-- ADD business_id TO EXISTING TABLES
alter table jobs add column if not exists business_id text default 'altalux';
alter table customers add column if not exists business_id text default 'altalux';
alter table vehicles add column if not exists business_id text default 'altalux';
alter table bookings add column if not exists business_id text default 'altalux';
alter table payments add column if not exists business_id text default 'altalux';
alter table invoices add column if not exists business_id text default 'altalux';
alter table employees add column if not exists business_id text default 'altalux';
