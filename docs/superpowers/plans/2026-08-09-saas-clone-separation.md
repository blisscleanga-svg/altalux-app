# AltaLux SaaS Clone (altalux.io) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone the AltaLux App's code and database schema into a fully independent stack (new GitHub repo, new Supabase project, new Hostinger site) that serves `altalux.io` as the standalone SaaS product, while `altalux-app`/`altaluxdetail.com` keeps running untouched.

**Architecture:** Two stacks that share nothing at runtime. The new stack is a fork of today's `altalux-app` code with AltaLux-specific defaults replaced by neutral/demo-tenant data, deployed against a brand-new empty Supabase project (seeded only with a Super Admin account and one demo tenant) and a new Hostinger site bound to `altalux.io`.

**Tech Stack:** Same as the source project — vanilla HTML/CSS/JS, Supabase (Postgres + Auth + Edge Functions/Deno), Hostinger static hosting, Resend (new account), Square (guard-blocked, no real charges).

## Global Constraints

- `altalux-app` (repo, Supabase project `xmhsehfdmiqbwhpqjgon`, `altaluxdetail.com`) must not be modified by any task in this plan. Every command below targets the new repo/project explicitly — never the linked default.
- The new Supabase CLI commands must use `--project-ref`/`--linked` explicitly and must never run `supabase link` inside the `altalux-app` working directory (that would repoint its saved link away from the real project). **Amendment (discovered during Task 4 execution):** this sandbox's network blocks direct outbound Postgres connections (port 5432) — `--db-url` fails with a connection error for both `db push` and `psql` (not installed anyway). `supabase link --project-ref <ref> --password <pw>` run from *within* `/home/blisscleanga/altalux-saas` (never from `altalux-app`) followed by `--linked` on `db push`/`db query`/`db dump` works, because it tunnels through the Management API over HTTPS instead of raw Postgres wire protocol. All Task 4/8 commands use `--linked` from the altalux-saas directory, not `--db-url`. `psql` is not available in this sandbox — `supabase db query --linked "<SQL>"` replaces every `psql -c "<SQL>"` verification command in this plan.
- New GitHub repo: `blisscleanga-svg/altalux-saas`, public (matches the visibility of `altalux-app`, confirmed via GitHub API before writing this plan).
- The new stack's Super Admin email is `altaluxtech@gmail.com` — different from AltaLux's `blisscleanmobilega@gmail.com`. This requires changing the hardcoded `SUPER_ADMIN_EMAIL` constant in `manage-tenant/index.ts:27` and `platform/index.html:195` (Task 5) before the new project's Super Admin Auth account is created (Task 7).
- `SQUARE_ACCESS_TOKEN` in the new project is a dummy, non-functional value (`unused-guard-blocks-all-charges`) — never the real AltaLux production token. **This dummy value is the ONLY real safety net against a live charge on the new project — treat it as load-bearing, not a formality.** Task 5's review found the `business_id === 'altalux'` gates (client-side in `booking`/`admin`/`technician`, server-side in `square-payment`) do NOT actually block anything on their own: `shared/config.js`'s `detectBusinessId()` returns any `?b=` query value verbatim with no validation against real tenants, so visiting `https://altalux.io/booking/?b=altalux` sets `businessId = 'altalux'` client-side (matching the client gate), triggers `FALLBACK_SETTINGS` (which still carries AltaLux's real `square_app_id`/`square_location_id` and `square_enabled: true`), and the resulting request legitimately carries `businessId: 'altalux'` to `square-payment`, which the server guard explicitly allows. The gates were written assuming `'altalux'` could only mean the real AltaLux tenant — on a multi-tenant deploy reachable by URL parameter, that assumption doesn't hold. Whether a real charge can happen therefore depends entirely on `SQUARE_ACCESS_TOKEN` never being a real, working Square credential on this project. Never provision a real one here.
- Whenever a step needs a secret only the user has (GitHub PAT, Resend API key), the task pauses and asks the user to paste it in chat — same pattern already used in this project for GitHub pushes.

---

### Task 1: Create the `altalux-saas` GitHub repo as a full clone of `altalux-app`

**Files:** none (repo-level operation)

**Interfaces:**
- Produces: a new local clone at `~/altalux-saas` with full git history, pushed to `https://github.com/blisscleanga-svg/altalux-saas`, on branch `main`.

- [ ] **Step 1: Ask the user for a GitHub PAT if not already available in chat**

Same pattern as the AltaLux push workflow: ask the user to paste a fresh Personal Access Token (`repo` scope) directly in the conversation. Do not attempt `! export` — it does not propagate to tool calls in this environment.

- [ ] **Step 2: Create the empty repo via the GitHub API**

```bash
curl -s -X POST -H "Authorization: token $PASTED_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d '{"name":"altalux-saas","private":false,"description":"AltaLux SaaS platform (altalux.io) — cloned from altalux-app"}'
```

Expected: JSON response with `"full_name": "blisscleanga-svg/altalux-saas"`.

- [ ] **Step 3: Clone the current repo into a new local working copy and repoint its remote**

```bash
git clone /home/blisscleanga/altalux-app /home/blisscleanga/altalux-saas
cd /home/blisscleanga/altalux-saas
git remote set-url origin "https://x-access-token:${PASTED_TOKEN}@github.com/blisscleanga-svg/altalux-saas.git"
git push origin main
```

Expected: `main` branch pushed, no errors.

- [ ] **Step 4: Verify**

```bash
curl -s https://api.github.com/repos/blisscleanga-svg/altalux-saas/commits/main | python3 -c "import json,sys; print(json.load(sys.stdin)['sha'][:7])"
cd /home/blisscleanga/altalux-app && git rev-parse --short HEAD
```

Expected: both commands print the same short SHA — confirms the clone carried full history and nothing diverged yet.

---

### Task 2: Reorder migrations into a chronologically-correct, CLI-safe filenames and drop the AltaLux seed

**Files:**
- Modify (rename): the 11 non-timestamped files in `supabase/migrations/` (all in `/home/blisscleanga/altalux-saas`)
- Delete: `supabase/migrations/phase_a_seed_altalux.sql`

**Interfaces:**
- Produces: `supabase/migrations/` containing only `<YYYYMMDDHHMMSS>_*.sql` files, in the exact chronological order they were historically applied (verified via `git log --follow --diff-filter=A`), so `supabase db push` will apply every one of them instead of silently skipping the non-conforming names.

- [ ] **Step 1: Rename the 11 files using the real add-dates recovered from git history**

```bash
cd /home/blisscleanga/altalux-saas/supabase/migrations
git mv employees.sql 20260707121103_employees.sql
git mv employees_password.sql 20260707144925_employees_password.sql
git mv e2e_fixes_2026_07_10.sql 20260709230043_e2e_fixes.sql
git mv phase_a_multitenant.sql 20260713231356_phase_a_multitenant.sql
git mv phase_a_rls.sql 20260713231357_phase_a_rls.sql
git mv phase_a_rls_fix.sql 20260713231358_phase_a_rls_fix.sql
git mv phase_a_settings_extra_columns.sql 20260713231359_phase_a_settings_extra_columns.sql
git mv phase_b_invoicing.sql 20260714214443_phase_b_invoicing.sql
git mv security_fix_bookings_anon_select.sql 20260715121258_security_fix_bookings_anon_select.sql
git mv security_rls_audit_part2.sql 20260715122419_security_rls_audit_part2.sql
git mv invoice_public_token.sql 20260715194756_invoice_public_token.sql
```

The four `phase_a_*` timestamps (`...56` through `...59`) are 1 second apart on purpose — they were all added in the same historical commit (`a134740`), so their real order was recovered by reading each file's content: `phase_a_multitenant.sql` creates `business_settings`; `phase_a_rls.sql` adds its first RLS pass; `phase_a_rls_fix.sql` replaces that with the `business_settings_public` view (references the columns `phase_a_multitenant` created); `phase_a_settings_extra_columns.sql` adds two more columns and re-issues `CREATE OR REPLACE VIEW` on top of `phase_a_rls_fix`'s version. Getting this order wrong will break the view's `CREATE OR REPLACE` chain.

- [ ] **Step 2: Delete the AltaLux-specific seed migration**

```bash
git rm phase_a_seed_altalux.sql
```

- [ ] **Step 3: Verify the final migrations directory**

```bash
ls /home/blisscleanga/altalux-saas/supabase/migrations
```

Expected: exactly 18 files, all matching `^[0-9]{14}_.*\.sql$`, no `phase_a_seed_altalux.sql`.

```bash
ls /home/blisscleanga/altalux-saas/supabase/migrations | grep -vE '^[0-9]{14}_' 
```

Expected: empty output.

- [ ] **Step 4: Commit and push**

```bash
cd /home/blisscleanga/altalux-saas
git add -A supabase/migrations
git commit -m "chore: rename migrations to CLI-safe timestamps, drop AltaLux seed data

Renamed using each file's real git add-date so the chronological order
(and the CREATE OR REPLACE VIEW dependency chain in the phase_a_* files)
is preserved. supabase db push silently skips any migration filename
that doesn't match <YYYYMMDDHHMMSS>_desc.sql, which is why the source
repo's un-renamed files never actually break db push there — they were
applied by hand historically. phase_a_seed_altalux.sql is AltaLux's real
seed data and has no place in a generic SaaS clone."
git push origin main
```

---

### Task 3: Provision the new Supabase project

**Files:**
- Create: `/home/blisscleanga/altalux-saas/.secrets/supabase.env` (gitignored — see Step 4)

**Interfaces:**
- Produces: a Supabase project ref, anon key, and service role key for the new backend. Every later task that touches this project uses these three values.

- [ ] **Step 1: Generate a database password**

```bash
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
echo "$DB_PASSWORD" # copy this value, you'll need it in Step 2 and Task 4
```

- [ ] **Step 2: Create the project**

```bash
supabase projects create altalux-saas \
  --org-id ccixhziqckerauskfqom \
  --db-password "$DB_PASSWORD" \
  --region us-east-1 \
  --output json
```

Expected: JSON with an `id`/`ref` field (a 20-character project ref, e.g. `abcdefghijklmnopqrst`). Save it as `PROJECT_REF`.

- [ ] **Step 3: Fetch the project's API keys**

```bash
supabase projects api-keys --project-ref "$PROJECT_REF" --output json
```

Expected: JSON array with `anon` and `service_role` keys. Save them as `ANON_KEY` and `SERVICE_ROLE_KEY`.

- [ ] **Step 4: Store all four values in a gitignored local file**

```bash
mkdir -p /home/blisscleanga/altalux-saas/.secrets
cat > /home/blisscleanga/altalux-saas/.secrets/supabase.env <<EOF
PROJECT_REF=$PROJECT_REF
DB_PASSWORD=$DB_PASSWORD
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EOF
cd /home/blisscleanga/altalux-saas
echo ".secrets/" >> .gitignore
git add .gitignore
git commit -m "chore: gitignore local secrets directory"
git push origin main
```

- [ ] **Step 5: Verify the project is healthy**

```bash
supabase projects list --output json | python3 -c "
import json, sys
projects = json.load(sys.stdin)['projects']
p = next(p for p in projects if p['ref'] == '$PROJECT_REF')
print(p['status'])
"
```

Expected: `ACTIVE_HEALTHY` (may need to retry after a minute if it prints `COMING_UP`).

---

### Task 4: Apply the full schema to the new project

> **⚠️ AMENDMENT — this task's original design was wrong, discovered and fixed during execution (2026-08-09):**
>
> 1. **The 18 renamed/original migration files are not the full schema.** Testing `db push` against the empty new project failed immediately on `employees.sql`'s `ALTER TABLE jobs ...` — the `jobs` table doesn't exist. Investigation (comparing the live project's real 20 tables against every `create table` in every migration file) found **8 core tables never created by any migration**: `bookings`, `customers`, `jobs`, `payments`, `invoices`, `vehicles`, `job_addons`, `job_vehicles`. They were created directly via the Supabase SQL Editor when the project started, before this repo adopted migrations — every existing migration only `ALTER`s them, assuming they already exist. A new file, `supabase/migrations/20260707120000_baseline_core_tables.sql`, reconstructs these 8 tables (columns, PKs, FKs, RLS enablement, and the one undocumented RLS policy — `"Allow public insert on bookings"`, anon INSERT — that no migration ever creates) by introspecting the live project's `information_schema`/`pg_catalog` (`pg_dump`/`supabase db dump` need Docker, unavailable in this sandbox). It deliberately excludes any column/constraint a *later* migration already adds via `ADD COLUMN IF NOT EXISTS` (idempotent, so redundant either way) — except `jobs_job_number_unique`, a non-idempotent bare `ADD CONSTRAINT` in `20260718150000_fix_duplicate_job_number.sql` that would fail if the baseline also created it.
> 2. **`phase_a_seed_altalux.sql` (deleted in Task 2) turned out to be a hard dependency, not just discardable seed data.** `20260805190000_onboarding_system.sql` seeds `service_templates`/`addon_templates` (the generic catalog every new tenant gets) via `INSERT ... SELECT ... FROM business_services WHERE business_id = 'altalux'` — with the seed gone, that SELECT matches nothing and the demo/future tenants would get an empty catalog. Fix: restored the file from `altalux-app`'s working tree as `supabase/migrations/20260713231400_phase_a_seed_altalux.sql` (same historical slot as the other `phase_a_*` files, positioned last among them since it has no dependency requiring otherwise), and added `supabase/migrations/20260805190100_purge_altalux_seed_after_templates_copied.sql` immediately after `onboarding_system.sql` to `DELETE` the `business_id = 'altalux'` rows from `business_settings`/`business_services`/`business_addons` once the copy is done — `service_templates`/`addon_templates` keep their 21+10 rows (no `business_id` column, unaffected by the delete). Net effect: AltaLux's real catalog exists only transiently, mid-migration, purely to bootstrap the generic templates; the final database has zero AltaLux rows anywhere, same as originally intended.
> 3. **Direct Postgres connections don't work from this sandbox** — see the Global Constraints amendment above. Every command below uses `--linked` (via `supabase link` run once, from within `/home/blisscleanga/altalux-saas`) instead of `--db-url`, and `supabase db query --linked "<SQL>"` instead of `psql`.
>
> The steps below reflect what was actually run, not the original (incomplete) design.

**Files:**
- Create: `supabase/migrations/20260707120000_baseline_core_tables.sql` (in `/home/blisscleanga/altalux-saas`)
- Create: `supabase/migrations/20260713231400_phase_a_seed_altalux.sql` (restored from `altalux-app`, retimestamped)
- Create: `supabase/migrations/20260805190100_purge_altalux_seed_after_templates_copied.sql`

**Interfaces:**
- Consumes: `PROJECT_REF`, `DB_PASSWORD` from `/home/blisscleanga/altalux-saas/.secrets/supabase.env` (Task 3).
- Produces: a fully-migrated schema on the new Supabase project — every table/view/RLS policy that exists on `xmhsehfdmiqbwhpqjgon` today, with zero AltaLux tenant rows anywhere but a fully-populated generic template catalog.

- [ ] **Step 1: Link the altalux-saas directory to the new project (Management-API-based, not a direct DB connection)**

```bash
cd /home/blisscleanga/altalux-saas
source .secrets/supabase.env
supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"
```

Expected: `{"project_ref":"<PROJECT_REF>","message":""}`. Verify `altalux-app`'s own link is untouched: `cat /home/blisscleanga/altalux-app/supabase/.temp/project-ref` must still print `xmhsehfdmiqbwhpqjgon`.

- [ ] **Step 2: Write the 3 new migration files** (content given in the amendment above / in the actual files — a fresh implementer should read the existing files in `/home/blisscleanga/altalux-saas/supabase/migrations/` rather than re-deriive them, they already exist from this session's recovery work)

- [ ] **Step 3: Push all 21 migrations**

```bash
cd /home/blisscleanga/altalux-saas
supabase db push --linked --yes
```

Expected: `Finished supabase db push.` `NOTICE ... does not exist, skipping` lines are expected and harmless (from `DROP ... IF EXISTS` statements running for the first time). Any real `ERROR` means stop and fix before re-running — do not skip ahead. If you need to retry from scratch after a partial failure, wipe first with **exactly** this sequence (found the hard way: a version of this that only re-granted schema usage, without the 3 `ALTER DEFAULT PRIVILEGES` lines, left `anon`/`authenticated`/`service_role` with zero table grants after the migrations re-ran — RLS policies were perfect but every request got `42501 permission denied` before RLS was ever consulted):

```bash
supabase db query --linked "
drop schema public cascade;
create schema public;
grant all on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
"
supabase db query --linked "delete from supabase_migrations.schema_migrations;"
```

- [ ] **Step 4: Verify every expected table exists (20 tables, matching the live project exactly)**

```bash
supabase db query --linked "select tablename from pg_tables where schemaname='public' order by tablename;"
```

Expected: `addon_templates, audit_log, bookings, business_addons, business_services, business_settings, customers, employees, events, invoice_payments, invoice_refunds, invoices, job_addons, job_vehicles, jobs, payment_events, payments, proposals, service_templates, vehicles` — 20 rows.

- [ ] **Step 5: Verify `business_settings`/`business_services`/`business_addons` have zero rows (no AltaLux data leaked in)**

```bash
supabase db query --linked "select (select count(*) from business_settings) as settings, (select count(*) from business_services) as services, (select count(*) from business_addons) as addons;"
```

Expected: `{"settings": 0, "services": 0, "addons": 0}`.

- [ ] **Step 6: Verify the `business_settings_public` view has the exact final column set**

```bash
supabase db query --linked "select column_name from information_schema.columns where table_name='business_settings_public' order by ordinal_position;"
```

Expected columns (in order): `id, created_at, business_id, name, email, phone, address, city, state, zip, website, logo_url, primary_color, secondary_color, accent_color, background_color, deposit_percentage, cancellation_hours, late_fee, cancellation_policy, notification_email, booking_url, admin_url, technician_url, square_app_id, square_location_id, square_environment, square_enabled, stripe_public_key, stripe_enabled, resend_from_email, resend_from_name, resend_enabled, twilio_phone, twilio_enabled, is_active, available_days, available_time_slots, status`. If this doesn't match exactly, the migration reordering in Task 2 was wrong — stop and re-derive the order before continuing.

- [ ] **Step 7: Verify template catalog was seeded (21 services + 10 add-ons) and survived the purge**

```bash
supabase db query --linked "select (select count(*) from service_templates) as services, (select count(*) from addon_templates) as addons;"
```

Expected: `{"services": 21, "addons": 10}`.

---

### Task 5: Genericize the client code for a neutral SaaS deploy

> **⚠️ AMENDMENT — scope gap found during execution (2026-08-09):** `shared/config.js`'s own header comment claims it's the single source of truth for the Supabase connection, specifically to avoid a `supabase-js` dependency. But `booking/index.html`, `admin/index.html`, `technician/index.html`, `pay/index.html`, and `onboarding/index.html` each separately load `supabase-js` and hardcode their **own** copy of `SUPABASE_URL`/`SUPABASE_ANON_KEY` (for auth/RPCs/mutations beyond `config.js`'s plain-REST reads) — all 6 (plus `platform/index.html`, already in scope) still pointed at AltaLux's live project. Left as originally scoped, the new deploy would have booked, authenticated, and processed payments against AltaLux's real production database for everything except the initial branding read. Fixed in all 6 files as part of this task, same mechanical replace as Step 1. Also found and fixed, while auditing: a hardcoded `businessId: 'altalux'` in an email call, hardcoded `app.altaluxdetail.com` pay-link URLs in 2 files, and an invoice contact-info fallback that would have leaked AltaLux's real email/website onto other tenants' invoices. Two things were found but deliberately **not** fixed here, flagged for later: (1) AltaLux's real Square merchant credentials (`square_app_id`/`square_location_id`) remain hardcoded client-side in 3 places — still worth cleaning up eventually, but not itself a live-charge risk as long as the Global Constraints note on `SQUARE_ACCESS_TOKEN` is honored; (2) `send-email/index.ts` has its own hardcoded `app.altaluxdetail.com` fallback URL — server-side, folded into Task 6's scope instead of duplicating work across two tasks.
>
> **Follow-up fixes applied after the task-5 review round:** a static footer on `booking/index.html` ("AltaLux Mobile Detail · Roswell, GA", never touched by any JS) and `booking/success.html`'s `<title>`/body text leaked the same way and were missed by the original audit — fixed. `admin/index.html`'s `invoiceBizInfo()` fix (the review's Important finding) had also left the `address` fallback (`'Roswell, GA 30075'`) unfixed one line above the `email`/`website` fixes — corrected to fall through the same way. **The payment-gate safety argument in the original report was wrong and has been corrected in the Global Constraints entry above** — the review found `?b=altalux` bypasses `detectBusinessId()`'s lack of tenant validation, meaning the `SQUARE_ACCESS_TOKEN` dummy value (not the business_id gates) is the real safety mechanism against a live charge. Task 6's review also found 2 more instances of the contact-info-leak class (`generate-receipt-pdf/index.ts:93`, `send-email/index.ts:110`) — added to Task 6's scope.

**Files:**
- Modify: `/home/blisscleanga/altalux-saas/shared/config.js`
- Modify: `/home/blisscleanga/altalux-saas/supabase/functions/manage-tenant/index.ts`
- Modify: `/home/blisscleanga/altalux-saas/platform/index.html`

**Interfaces:**
- Consumes: `PROJECT_REF`, `ANON_KEY` from Task 3.
- Produces: `shared/config.js` pointing at the new Supabase project, with a neutral fallback (no AltaLux branding/data as the default), no AltaLux/BlissClean domain special-casing, and `altaluxtech@gmail.com` as the enforced Super Admin email (consumed by Task 7).

- [ ] **Step 1: Update the Supabase connection constants**

In `/home/blisscleanga/altalux-saas/shared/config.js`, replace:

```js
  var SUPABASE_URL = 'https://xmhsehfdmiqbwhpqjgon.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtaHNlaGZkbWlxYndocHFqZ29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODU5NzQsImV4cCI6MjA5ODk2MTk3NH0.J2UOp-pgzP6ByvDBoHcocFAmarWdlDK8M31YgKrUNss';
```

with the values captured in Task 3 (`PROJECT_REF`, `ANON_KEY`):

```js
  var SUPABASE_URL = 'https://<PROJECT_REF>.supabase.co';
  var SUPABASE_ANON_KEY = '<ANON_KEY>';
```

- [ ] **Step 2: Simplify domain detection — remove the AltaLux/BlissClean special case**

Replace:

```js
  function detectBusinessId() {
    var qsBusiness = new URLSearchParams(window.location.search).get('b');
    if (qsBusiness) return qsBusiness.toLowerCase();
    var host = (window.location.hostname || '').toLowerCase();
    if (host.indexOf('blisscleandetail.com') !== -1) return 'blissclean';
    if (host.indexOf('altaluxdetail.com') !== -1) return 'altalux';
    return 'altalux'; // localhost / altalux.io sin ?b / anything else — dev default
  }
```

with:

```js
  function detectBusinessId() {
    var qsBusiness = new URLSearchParams(window.location.search).get('b');
    if (qsBusiness) return qsBusiness.toLowerCase();
    return 'demo'; // altalux.io / localhost sin ?b — tenant demo por defecto
  }
```

- [ ] **Step 3: Replace `FALLBACK_SETTINGS` with neutral demo-tenant data**

Replace the AltaLux values inside `FALLBACK_SETTINGS` (the block starting `var FALLBACK_SETTINGS = { business_id: 'altalux', ...`) with:

```js
  var FALLBACK_SETTINGS = {
    business_id: 'demo',
    status: 'approved',
    name: 'Demo Detailing Co',
    email: null,
    phone: null,
    city: null,
    state: null,
    website: 'https://altalux.io',
    primary_color: '#104872',
    secondary_color: '#FF8C00',
    accent_color: '#FFAA00',
    background_color: '#0a1628',
    deposit_percentage: 25,
```

Keep every field after `deposit_percentage` in the original object unchanged (booking policy text, URLs, etc.) unless it names AltaLux specifically — check the remainder of the object for any literal "AltaLux"/"altaluxdetail.com" text and neutralize it the same way.

- [ ] **Step 4: Update the hardcoded Super Admin email**

In `/home/blisscleanga/altalux-saas/supabase/functions/manage-tenant/index.ts:27`, replace:

```ts
const SUPER_ADMIN_EMAIL = 'blisscleanmobilega@gmail.com';
```

with:

```ts
const SUPER_ADMIN_EMAIL = 'altaluxtech@gmail.com';
```

In `/home/blisscleanga/altalux-saas/platform/index.html:195`, replace:

```js
  var SUPER_ADMIN_EMAIL = 'blisscleanmobilega@gmail.com'; // cosmético — el enforcement real vive en manage-tenant
```

with:

```js
  var SUPER_ADMIN_EMAIL = 'altaluxtech@gmail.com'; // cosmético — el enforcement real vive en manage-tenant
```

- [ ] **Step 5: Audit the 3 big app files for stray hardcoded AltaLux references, plus the old Super Admin email**

```bash
cd /home/blisscleanga/altalux-saas
grep -rniE "altalux|altaluxdetail\.com" booking/index.html admin/index.html technician/index.html pay/index.html onboarding/index.html platform/index.html
grep -rn "blisscleanmobilega@gmail.com" supabase/functions/ platform/index.html admin/index.html
```

Expected: first command — no matches (or only matches inside comments/changelog text that don't affect runtime behavior — judge each hit; anything that renders to the user or drives logic must be fixed). Second command — no matches anywhere (confirms the old Super Admin email from Step 4 wasn't left in some other spot, e.g. a comment or log message elsewhere in the codebase).

- [ ] **Step 6: Commit and push**

```bash
git add shared/config.js supabase/functions/manage-tenant/index.ts platform/index.html
git commit -m "feat: point config at the new Supabase project, genericize fallback tenant

FALLBACK_SETTINGS no longer carries AltaLux's real branding/contact info —
it now describes the seeded demo tenant, since this is what shows if
Supabase is ever unreachable on altalux.io. Domain detection no longer
special-cases altaluxdetail.com/blisscleandetail.com; every business is
reached via ?b=<slug>, defaulting to the demo tenant. Super Admin email
switched to altaluxtech@gmail.com — this stack's own identity, distinct
from AltaLux's blisscleanmobilega@gmail.com."
git push origin main
```

---

### Task 6: Deploy Edge Functions with their own secrets

> **⚠️ AMENDMENT — carried over from Task 5's audit:** `supabase/functions/send-email/index.ts` has 2 of its own hardcoded AltaLux fallbacks: `'https://app.altaluxdetail.com/booking/'` (line ~358, used when building links inside actual customer-facing emails — booking confirmations, invoice notifications, etc.) and `(biz.website || 'altaluxdetail.com')` (line ~110). `supabase/functions/generate-receipt-pdf/index.ts:93` has the matching `email: data?.email || 'contact@altaluxdetail.com'` fallback. Same category of bug as the pay-link URLs and `invoiceBizInfo()` fallbacks fixed in Task 5, just server-side and therefore this task's territory. Fix all 3: the booking-link URL → `'https://altalux.io/booking/'` (matching the client-side pattern), the website/email fallbacks → `''` (matching `invoiceBizInfo()`'s pattern — empty, never another tenant's real contact info) — before deploying.

**Files:**
- Modify: `supabase/functions/send-email/index.ts` (2 hardcoded fallbacks described above)
- Modify: `supabase/functions/generate-receipt-pdf/index.ts` (1 hardcoded fallback described above)

**Interfaces:**
- Consumes: `PROJECT_REF` from Task 3.
- Produces: all 7 Edge Functions live on the new project, with `SQUARE_ACCESS_TOKEN` and `RESEND_API_KEY` set.

- [ ] **Step 1: Type-check every function before deploying**

```bash
cd /home/blisscleanga/altalux-saas
for f in supabase/functions/*/index.ts; do
  echo "=== $f ==="
  deno check "$f" || echo "FAILED: $f"
done
```

Expected: no `FAILED` lines.

If `deno` isn't installed (`which deno` prints nothing), install it first — no `sudo`, no `unzip` dependency:

```bash
mkdir -p /tmp/deno-install
curl -fsSL -o /tmp/deno-install/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip
python3 -c "import zipfile; zipfile.ZipFile('/tmp/deno-install/deno.zip').extractall('/tmp/deno-install')"
mkdir -p ~/.local/bin
mv /tmp/deno-install/deno ~/.local/bin/deno
chmod +x ~/.local/bin/deno
export PATH="$HOME/.local/bin:$PATH"
deno --version
```

Expected: prints a `deno x.x.x` version line. Re-run Step 1's loop after this succeeds.

- [ ] **Step 2: Ask the user for the new Resend account's API key**

Pause and ask: "¿Cuál es la API key de la cuenta de Resend nueva para altalux.io?" Do not proceed until you have it.

- [ ] **Step 3: Set the two custom secrets**

```bash
source /home/blisscleanga/altalux-saas/.secrets/supabase.env
supabase secrets set --project-ref "$PROJECT_REF" \
  SQUARE_ACCESS_TOKEN=unused-guard-blocks-all-charges \
  RESEND_API_KEY="$PASTED_RESEND_KEY"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` do not need to be set manually — Supabase injects them automatically into every Edge Function's runtime for its own project.

- [ ] **Step 4: Deploy all 7 functions**

```bash
supabase functions deploy --project-ref "$PROJECT_REF" --use-api \
  manage-tenant manage-employee-auth square-payment square-refund \
  send-email track-payment-event generate-receipt-pdf
```

Expected: all 7 report `Deployed Function`.

- [ ] **Step 5: Verify one function responds (unauthenticated call to `manage-tenant` should reject, not 404/500)**

```bash
source /home/blisscleanga/altalux-saas/.secrets/supabase.env
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/manage-tenant" \
  -H "Authorization: Bearer ${ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"action":"stats"}'
```

Expected: `401` or `403` (rejected for lacking a real user session) — proves the function is live and enforcing auth, not missing.

---

### Task 7: Create the Super Admin Auth account

**Files:** none (Supabase Auth Admin API call)

**Interfaces:**
- Consumes: `PROJECT_REF`, `SERVICE_ROLE_KEY` from Task 3.
- Produces: a Supabase Auth user for `altaluxtech@gmail.com` on the new project, confirmed and able to sign in to `platform/index.html`.

- [ ] **Step 1: Ask the user for the password they want for the Super Admin login on altalux.io**

Pause and ask Luis directly (this is his own login credential — don't generate it for him).

- [ ] **Step 2: Create the Auth user**

```bash
source /home/blisscleanga/altalux-saas/.secrets/supabase.env
curl -s -X POST "https://${PROJECT_REF}.supabase.co/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"altaluxtech@gmail.com","password":"'"$PASTED_PASSWORD"'","email_confirm":true}'
```

Expected: JSON with `"email": "altaluxtech@gmail.com"` and a real `id`.

- [ ] **Step 3: Verify sign-in works**

```bash
curl -s -X POST "https://${PROJECT_REF}.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"email":"altaluxtech@gmail.com","password":"'"$PASTED_PASSWORD"'"}'
```

Expected: JSON with an `access_token` field.

---

### Task 8: Seed and approve the demo tenant

**Files:** none (SQL insert + Edge Function call against the new project)

**Interfaces:**
- Consumes: `PROJECT_REF`, `DB_PASSWORD`, `SERVICE_ROLE_KEY`, `ANON_KEY` from Task 3; the Super Admin credentials from Task 7.
- Produces: `business_id = 'demo'` in `business_settings` with `status = 'approved'`, an `employees` Owner row, a Supabase Auth account for the demo owner, and `business_services`/`business_addons` copied from the templates.

- [ ] **Step 1: Ask the user for a login email/password for the demo tenant's Owner**

Pause and ask (e.g. a throwaway address like `demo-owner@altalux.io` is fine — confirm with Luis).

- [ ] **Step 2: Pre-create the demo owner's Auth account with a known password**

```bash
source /home/blisscleanga/altalux-saas/.secrets/supabase.env
curl -s -X POST "https://${PROJECT_REF}.supabase.co/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$DEMO_OWNER_EMAIL"'","password":"'"$DEMO_OWNER_PASSWORD"'","email_confirm":true}'
```

`approve_tenant` (Task 8, Step 4) only creates a new Auth account if one doesn't already exist for that email — pre-creating it here means the demo owner's password is the one just chosen, not a random one nobody knows.

- [ ] **Step 3: Insert the pending application row directly**

```bash
cd /home/blisscleanga/altalux-saas
supabase db query --linked "
insert into business_settings (business_id, name, city, state, slug, owner_email, status, tos_accepted_at)
values ('demo', 'Demo Detailing Co', 'Atlanta', 'GA', 'demo', '${DEMO_OWNER_EMAIL}', 'pending', now());
"
```

Requires the directory to already be linked to the new project (`supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"` — done once in Task 4/Step 1; re-run it here if this is a fresh shell/session).

- [ ] **Step 4: Approve it via the real `manage-tenant` Edge Function, authenticated as Super Admin**

```bash
SUPER_ADMIN_TOKEN=$(curl -s -X POST "https://${PROJECT_REF}.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"email":"altaluxtech@gmail.com","password":"'"$SUPER_ADMIN_PASSWORD"'"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

curl -s -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/manage-tenant" \
  -H "Authorization: Bearer ${SUPER_ADMIN_TOKEN}" -H "Content-Type: application/json" \
  -d '{"action":"approve_tenant","businessId":"demo"}'
```

Expected: `{"success": true, ...}` (check the function's actual response shape by reading `actionApproveTenant`'s return statement if this doesn't match).

- [ ] **Step 5: Verify all 4 steps landed**

```bash
cd /home/blisscleanga/altalux-saas
supabase db query --linked "
select status, approved_at is not null as has_approved_at from business_settings where business_id = 'demo';
select count(*) from employees where business_id = 'demo' and role = 'Owner';
select count(*) from business_services where business_id = 'demo';
select count(*) from business_addons where business_id = 'demo';
"
```

Expected: `status = 'approved'`, `has_approved_at = t`, employee count `1`, service count `21`, addon count `10`.

---

### Task 9: Stand up the Hostinger site and deploy the static files

**Files:**
- Create (locally, for deploy only — not committed): a zip archive of the static site

**Interfaces:**
- Consumes: the genericized code from Task 5.
- Produces: `altalux.io` serving the app from the new Hostinger hosting.

- [ ] **Step 1: Check whether a website resource already exists for `altalux.io`**

Use the Hostinger MCP tool `hosting_listWebsitesV1` (optionally filtered with `domain: "altalux.io"`) and `domains_getDomainListV1` to confirm the domain is in the account and see whether a website/hosting slot is already provisioned for it.

- [ ] **Step 2a: If no website exists yet, create one**

Use `hosting_createWebsiteV1` with `domain: "altalux.io"` and the `order_id` from the new hosting plan (find it via the account's order list if not already known from Step 1's output).

- [ ] **Step 2b: If DNS isn't already pointed at the new hosting, fix it**

Compare `DNS_getDNSRecordsV1(domain: "altalux.io")` against the A/CNAME records Hostinger's website creation step reports as required, and reconcile with `DNS_updateDNSRecordsV1` if they don't match.

- [ ] **Step 3: Build the deploy archive**

```bash
cd /home/blisscleanga/altalux-saas
python3 -c "
import zipfile, os
files = [
    'admin/index.html', 'booking/index.html', 'booking/success.html',
    'brand/altalux-logo-color.png', 'brand/altalux-logo-white.png',
    'pay/index.html', 'shared/config.js',
    'technician/index.html', 'onboarding/index.html', 'platform/index.html',
    'terms.html', 'privacy.html',
]
with zipfile.ZipFile('/tmp/claude-1000/-home-blisscleanga/bd60e6ac-4dce-452a-b983-b69961f35a9f/scratchpad/altalux-saas-deploy.zip', 'w') as z:
    for f in files:
        z.write(f, f)
"
```

`onboarding/index.html`, `platform/index.html`, `terms.html`, and `privacy.html` are new additions to the file set versus AltaLux's zip — AltaLux's own deploy never needed them (no public onboarding wizard, no ToS link on a booking-only widget), but `altalux.io` does, since `onboarding/index.html:96` links to `/terms.html` and `/privacy.html`.

- [ ] **Step 4: Deploy**

Use the Hostinger MCP tool `hosting_deployStaticWebsite` with `domain: "altalux.io"` and `archivePath` pointing at the zip built in Step 3.

- [ ] **Step 5: Verify the live site**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://altalux.io/onboarding/
curl -s -o /dev/null -w "%{http_code}\n" https://altalux.io/platform/
```

Expected: both `200`.

---

### Task 10: End-to-end verification on the live altalux.io stack

**Files:** none (uses the project's `headless-browser-sandbox` skill, Playwright)

**Interfaces:**
- Consumes: everything from Tasks 1–9 — the live `altalux.io` site, the new Supabase project, the Super Admin and demo tenant credentials.
- Produces: a pass/fail report against every item in the design spec's testing section (`docs/superpowers/specs/2026-08-09-saas-clone-separation-design.md`).

- [ ] **Step 1: Full public onboarding wizard, for a NEW third tenant (not the seeded demo)**

Using `headless-browser-sandbox`, navigate to `https://altalux.io/onboarding/`, complete both wizard steps for a throwaway test business (e.g. "E2E Test Detailing"), accept ToS, and confirm the signup succeeds (check for the wizard's success state, then confirm a `pending` row landed in `business_settings` via `supabase db query --linked` against the new project).

- [ ] **Step 2: Approve the new test tenant as Super Admin**

Log into `https://altalux.io/platform/` as the Super Admin (Task 7 credentials), find the test tenant in the Tenants list, approve it. Verify via `supabase db query --linked` that the same 4 steps checked in Task 8/Step 5 landed for this tenant too.

- [ ] **Step 3: Demo tenant full admin flow**

Log into `https://altalux.io/admin/?b=demo` as the demo tenant Owner (Task 8 credentials). Create a customer, create a job, confirm both persist (reload the page, confirm they're still there — proves the write actually reached Supabase, not just local state).

- [ ] **Step 4: Payment guard blocks the demo tenant**

From `https://altalux.io/booking/?b=demo`, walk through the booking flow to the payment step and attempt to submit a deposit with a Square test card. Expected: rejected with a 403 from `square-payment` (check the network response, not just the UI message) — confirms the guard blocks the demo tenant exactly like it blocks every non-`altalux` business today.

- [ ] **Step 5: Technician flow**

Create a technician employee for the demo tenant (via `admin/index.html` > Empleados), assign the job from Step 3 to them, log into `https://altalux.io/technician/?b=demo` as that employee, confirm the assigned job appears.

- [ ] **Step 6: Cross-check — no data crossed between the two stacks**

```bash
supabase db query --linked "select business_id from jobs where business_id in ('demo', 'e2e-test-detailing');"
```

Run this against `xmhsehfdmiqbwhpqjgon` (the currently-linked AltaLux project, unchanged in this task) — expected: zero rows. Then run the equivalent query against the new project's `supabase db query --linked` connection for `business_id = 'altalux'` — expected: zero rows there too (proves neither stack's tenant data leaked into the other's database, since they're physically separate databases this should be trivially true, but confirm it explicitly).

- [ ] **Step 7: Clean up test data**

Delete the throwaway "E2E Test Detailing" tenant's rows (`business_settings`, `employees`, `business_services`, `business_addons`, any `jobs`/`customers` created) from the new project via `supabase db query --linked`. Leave the seeded `demo` tenant's data as-is — it's meant to stay as the permanent demo.

---

### Task 11: Document the new project

**Files:**
- Create: `/home/blisscleanga/altalux-saas/CONTEXT.md`
- Modify: `/home/blisscleanga/altalux-app/CONTEXT.md`

**Interfaces:** none

- [ ] **Step 1: Write a CONTEXT.md for the new repo**

Base it on `altalux-app/CONTEXT.md`'s structure (this project already has an established discipline of keeping this file current after every change — carry it into the new repo). Cover: what this repo is (the SaaS platform product, distinct from AltaLux's own operational site), the stack table from this plan's header, the Super Admin/demo tenant credentials location (`.secrets/supabase.env` — never commit it), and a "Fixes recientes" section seeded with today's clone entry.

- [ ] **Step 2: Update `altalux-app/CONTEXT.md`'s existing "Clon SaaS independiente" note**

Replace the "en planificación" note added on 2026-08-09 with a short status update pointing at the live result: repo URL, `altalux.io`, and a note that this file (`altalux-app/CONTEXT.md`) will not track the SaaS product's ongoing changes going forward — `altalux-saas/CONTEXT.md` does.

- [ ] **Step 3: Commit both**

```bash
cd /home/blisscleanga/altalux-saas && git add CONTEXT.md && git commit -m "docs: add CONTEXT.md for the new SaaS repo" && git push origin main
cd /home/blisscleanga/altalux-app && git add CONTEXT.md && git commit -m "docs: altalux.io SaaS clone is live — see altalux-saas repo going forward" && git push origin main
```
