-- Phase B — Invoicing, payment adjustments, and refunds.
--
-- `invoices` already exists in the live DB (created outside this repo,
-- columns: id, created_at, invoice_number, job_id, customer_id, status,
-- due_date, tax_enabled, tax_rate, notes, sent_at, business_id). It has
-- zero rows and admin never writes to it — the invoice UI is entirely
-- client-side/in-memory today. This migration ALTERs it in place (adding
-- the columns needed for service/price adjustments) instead of creating
-- a parallel table, per the analysis in this session.

alter table invoices add column if not exists service_id uuid references business_services(id);
alter table invoices add column if not exists original_service_name text;
alter table invoices add column if not exists original_amount numeric(10,2);
alter table invoices add column if not exists adjustments jsonb default '[]'; -- [{description, amount, type: fee|discount}]
alter table invoices add column if not exists final_amount numeric(10,2);
alter table invoices add column if not exists amount_paid numeric(10,2) default 0;

-- Payments against an invoice (distinct from the existing flat `payments`
-- table, which stays untouched — this is additive, not a replacement).
create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id),
  business_id text not null default 'altalux',
  square_payment_id text,
  amount numeric(10,2),
  status text, -- completed | failed | refunded
  created_at timestamptz default now()
);

-- Refunds
create table if not exists invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references invoice_payments(id),
  business_id text not null default 'altalux',
  square_refund_id text,
  amount numeric(10,2),
  reason text,
  status text, -- pending | completed | failed
  created_at timestamptz default now()
);

-- Real relational link from a job to its catalog service — didn't exist
-- before (confirmed against the live schema during Part 1 analysis).
-- Nullable/additive: existing jobs keep working with their free-text
-- category/package fields; this is only populated going forward when the
-- technician panel changes a job's service against the real catalog.
alter table jobs add column if not exists service_id uuid references business_services(id);

-- RLS: same pattern as the rest of this app (see rls_policies_authenticated_writes.sql
-- and phase_a_rls.sql) — anon has no access to financial tables, authenticated
-- (logged-in employee) has full read/write.
alter table invoice_payments enable row level security;
create policy "authenticated_all_invoice_payments" on public.invoice_payments for all to authenticated using (true) with check (true);

alter table invoice_refunds enable row level security;
create policy "authenticated_all_invoice_refunds" on public.invoice_refunds for all to authenticated using (true) with check (true);

-- invoices already has RLS enabled with an equivalent policy
-- ("Allow all for authenticated on invoices", set up outside this repo
-- alongside the table itself) — nothing to add here.
