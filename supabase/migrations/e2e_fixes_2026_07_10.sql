-- ============================================================
-- Fixes found and applied during the 2026-07-10 end-to-end test
-- ============================================================
-- 1. `bookings` was missing the `square_payment_id` column that
--    booking/index.html has always sent on insert — every paid
--    booking failed to save after a successful Square charge.
alter table public.bookings add column if not exists square_payment_id text;

-- 2. `bookings` had SELECT/INSERT policies for `anon` only. The
--    `authenticated` role (the real admin/technician session) had
--    no policy at all, so the admin dashboard could never see or
--    manage incoming bookings ("New Booking Requests" always empty).
create policy "Allow all for authenticated on bookings"
  on public.bookings for all to authenticated using (true) with check (true);

-- 3. Removed the plaintext-password authentication model:
--    - admin/index.html and technician/index.html used to compare
--      a plaintext `employees.password` column client-side, gated
--      behind one shared hardcoded Supabase Auth account embedded
--      in admin/index.html's source (full read/write DB access,
--      visible to anyone via "View Source").
--    - Real per-employee Supabase Auth accounts were created for
--      luisepabon@gmail.com and dario@blisscleandetail.com instead
--      (same passwords they already used, so login UX is unchanged).
--    - Both apps now call db.auth.signInWithPassword() directly.
--    - New employees / password resets go through the
--      `manage-employee-auth` Edge Function (Owner-only, uses the
--      service role key server-side) instead of writing plaintext.
--    - The shared master Supabase Auth account was deleted.
alter table public.employees drop column if exists password;
drop policy if exists "Allow anon read on employees" on public.employees;
