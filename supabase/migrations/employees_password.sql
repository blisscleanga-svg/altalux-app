-- ============================================================
-- AltaLux — Employee email/password login
-- ============================================================
-- Adds a password column to the employees table (replacing the
-- old PIN-based mobile login) and sets the initial passwords for
-- the two seeded employees.
-- ============================================================

alter table employees add column if not exists password text default 'altalux2026';

update employees set password = 'altalux2026' where email = 'luisepabon@gmail.com';
update employees set password = 'dario2026' where email = 'dario@blisscleandetail.com';
