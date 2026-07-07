-- ============================================================
-- AltaLux — Employees table
-- ============================================================
-- Run this once in the Supabase SQL Editor (or via
-- `supabase db push` if the project is linked to the CLI).
-- ============================================================

create table if not exists employees (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  first_name text not null,
  last_name text,
  email text,
  phone text,
  role text default 'Technician',
  hourly_rate numeric,
  commission_rate numeric default 0,
  pin text default '1234',
  preferred_payment_method text default 'Square Reader',
  notes text,
  is_active boolean default true,
  photo_url text
);

alter table employees enable row level security;

create policy "Allow all for authenticated on employees"
on employees for all to authenticated using (true) with check (true);

create policy "Allow anon read on employees"
on employees for select to anon using (true);

insert into employees (first_name, last_name, email, phone, role, commission_rate, pin) values
('Luis', 'Pabón', 'luisepabon@gmail.com', '4708774347', 'Owner', 0, '0000'),
('Dario', 'Pabón', 'dario@blisscleandetail.com', null, 'Technician', 15, '1234')
on conflict do nothing;

-- ============================================================
-- Link jobs to employees
-- ============================================================
-- The technician app filters "my jobs today" by this column.
-- Nullable and additive — existing jobs/queries are unaffected.
-- ============================================================
alter table jobs add column if not exists assigned_to uuid references employees(id);
alter table jobs add column if not exists start_time timestamp with time zone;
alter table jobs add column if not exists end_time timestamp with time zone;
