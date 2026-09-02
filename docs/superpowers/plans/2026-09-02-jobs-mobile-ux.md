# Unified Jobs Card View + Filters + Calendar Date-Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontally-scrolling Jobs table in `admin/index.html` (desktop and mobile) with a compact, tappable card list — status/online-booking filter tabs, no horizontal overflow at any screen width — plus a native date-jump control on the Calendar.

**Architecture:** A new `buildJobCardCompactHtml()` sits alongside the existing `buildJobCardHtml()` (already proven in the Agenda calendar view), reusing its `STATUS_SLUG`/color/click-through conventions. The Jobs view's `<table>` is replaced by a filter-tab bar + a `<div>` of these cards, backed by the same in-memory `JOBS` array — no new queries. A new `jobs.source` column (`'manual'` default) is stamped `'online_booking'` at the one place a booking becomes a job, powering a filter toggle. The Calendar gets a plain `<input type="date">` wired to the state/render functions it already has.

**Tech Stack:** Vanilla JS/HTML (`admin/index.html`), Supabase Postgres migration.

**Spec:** `docs/superpowers/specs/2026-09-02-jobs-mobile-ux-design.md`

## Global Constraints

- Same component for desktop and mobile — no separate breakpoint-switched rendering path (confirmed with Luis: "los dos, unificar como Urable").
- `jobs.source` only applies going forward — historical jobs are NOT retroactively tagged (confirmed with Luis).
- The compact card shows only: job#/service/location, customer name, balance due, status badge — everything else (address, deposit breakdown, vehicle) stays behind a tap into the existing job-detail modal (`openJobModal`), never re-added to the card itself.
- Do not touch `buildJobCardHtml()` (the fuller card) or the Agenda calendar view — those are explicitly out of scope, still needed by technicians in the field.
- Do not touch Customers/Payments/Proposals tables, Week/Day/Month calendar views, mobile modals, touch-target sizing, or dark/light theme — all explicitly out of scope for this plan (separate specs).
- Status colors for the new card must match the existing `.job-card[data-status="..."]` rules exactly (`admin/index.html:802-806`): pending `#90a4ae`, confirmed `var(--blue-light)`, inprogress `var(--orange)`, completed `var(--green)`, cancelled `var(--danger)` + `opacity:.7`.

---

### Task 1: Migration — `jobs.source` column

**Files:**
- Create: `supabase/migrations/20260902200000_jobs_source_column.sql`

**Interfaces:**
- Produces: column `public.jobs.source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'online_booking'))`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Jobs mobile UX — columna de origen del job (manual vs. booking
-- online). Ver docs/superpowers/specs/2026-09-02-jobs-mobile-ux-design.md
--
-- Solo aplica hacia adelante: jobs históricos quedan en el default
-- 'manual' sin intentar inferir su origen real (decisión explícita,
-- no vale la pena el esfuerzo de reconstruir datos históricos).
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'online_booking'));
```

- [ ] **Step 2: Apply the migration**

Run: `cd /home/blisscleanga/altalux-app && supabase db push`
Expected: output lists `20260902200000_jobs_source_column.sql` as applied, no errors.

- [ ] **Step 3: Verify**

Run: `supabase db query --linked "select column_name, data_type, column_default from information_schema.columns where table_name = 'jobs' and column_name = 'source';"`
Expected: one row, `data_type: text`, `column_default` containing `'manual'::text`.

Run: `supabase db query --linked "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%';"`
Expected: one row showing the `CHECK` constraint on `source`.

- [ ] **Step 4: Update CONTEXT.md and commit**

Add a `## Fixes recientes` entry (dated today) noting the migration landed and what it's for (first piece of the Jobs mobile UX work — see the spec).

```bash
git add supabase/migrations/20260902200000_jobs_source_column.sql CONTEXT.md
git commit -m "feat: jobs.source column (manual vs online_booking)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Tag booking-to-job conversion with `source: 'online_booking'`

**Files:**
- Modify: `admin/index.html:4374` (the `jobs` insert inside the booking-conversion flow)

**Interfaces:**
- Consumes: `jobs.source` column (Task 1).
- Produces: every job created by converting a booking now carries `source: 'online_booking'`; every other `jobs` insert in the codebase is untouched and continues to rely on the column's `'manual'` default (no code change needed there — verified below).

The exact insertion point is inside the function that converts a `bookings` row into a real `jobs` row (search for the literal string `status: 'Confirmed', notes: ''` — there are two matches in the file; the one inside a `db.from('jobs').insert([{...}])` call, NOT the one inside the hardcoded sample `JOBS` array near the top of the file, is the one to change).

- [ ] **Step 1: Add the `source` field to the insert**

Find:

```javascript
      const { data: jobData, error: jobErr } = await db
        .from('jobs')
        .insert([{
          customer_id: custData.id,
          category: b.category, package: b.package,
          service_date: toInputDate(b.serviceDate), service_time: b.serviceTime,
          subtotal: b.subtotal, addons_total: b.addonsTotal, total: b.total,
          deposit: depositAmount, balance_due: round2(b.total - depositAmount),
          payment_status: depositAmount > 0 ? 'Deposit Paid' : 'Unpaid',
          status: 'Confirmed', notes: ''
        }])
        .select()
        .single();
```

Replace with:

```javascript
      const { data: jobData, error: jobErr } = await db
        .from('jobs')
        .insert([{
          customer_id: custData.id,
          category: b.category, package: b.package,
          service_date: toInputDate(b.serviceDate), service_time: b.serviceTime,
          subtotal: b.subtotal, addons_total: b.addonsTotal, total: b.total,
          deposit: depositAmount, balance_due: round2(b.total - depositAmount),
          payment_status: depositAmount > 0 ? 'Deposit Paid' : 'Unpaid',
          status: 'Confirmed', notes: '', source: 'online_booking'
        }])
        .select()
        .single();
```

- [ ] **Step 2: Carry `source` into the client-side job object**

`admin/index.html:4015`, `function mapJobRow(row, index){...}`, maps each Supabase `jobs` row (fetched with `select('*, customers(*), job_vehicles(*, vehicles(*)), job_addons(*))` — the `'*'` already includes the new `source` column automatically, no query change needed) into the in-memory shape every other task in this plan reads as `j.source`.

Find (`admin/index.html:4037-4038`):

```javascript
      status: row.status || 'Pending',
      notes: row.notes || '',
```

Replace with:

```javascript
      status: row.status || 'Pending',
      notes: row.notes || '',
      source: row.source || 'manual',
```

- [ ] **Step 3: Verify with a real conversion**

This can't be exercised without a real booking in this sandbox (no authenticated write path — same limitation documented throughout this project's history). Instead, verify statically: `grep -n "source: 'online_booking'" admin/index.html` must show exactly one match (the insert from Step 1), and `grep -n "source: row.source || 'manual'" admin/index.html` must show exactly one match (the mapping from Step 2).

- [ ] **Step 4: Update CONTEXT.md and commit**

```bash
git add admin/index.html CONTEXT.md
git commit -m "feat: tag jobs created from bookings with source=online_booking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `buildJobCardCompactHtml()` component + CSS

**Files:**
- Modify: `admin/index.html` — add the function near `buildJobCardHtml()` (`admin/index.html:5185-5219`)
- Modify: `admin/index.html` — add CSS near `.job-card[data-status="..."]` rules (`admin/index.html:771-806`)

**Interfaces:**
- Consumes: `j.jobNumber`, `j.service`, `j.address`, `j.customer.name`, `j.id`, `j.status` (all already present on every job object); `STATUS_SLUG` (existing, `admin/index.html:3255`); `renderStatusBadge(j)` (existing, `admin/index.html:3385`); `formatCurrency` (existing, `admin/index.html:3274`); `balanceDue(j)` (existing, `admin/index.html:3653`); `escapeHtml` (existing, `admin/index.html:6798` at time of writing — locate by name, not line number, since earlier tasks in this session have shifted it).
- Produces: `buildJobCardCompactHtml(j)` → HTML string, consumed by Task 4's `renderJobsTable()`. CSS class `.job-card-compact` with `data-status` and `data-job-id` attributes, consumed by Task 4's click delegation.

- [ ] **Step 1: Add the CSS**

Find (`admin/index.html:802-806`):

```css
  .job-card[data-status="pending"]{ border-left:3px solid #90a4ae; }
  .job-card[data-status="confirmed"]{ border-left:3px solid var(--blue-light); }
  .job-card[data-status="inprogress"]{ border-left:3px solid var(--orange); }
  .job-card[data-status="completed"]{ border-left:3px solid var(--green); }
  .job-card[data-status="cancelled"]{ border-left:3px solid var(--danger); opacity:.7; }
```

Add immediately after:

```css
  .job-card-compact{
    display:flex; align-items:center; gap:12px; padding:12px 14px;
    background:rgba(255,255,255,.02); border:1px solid var(--line);
    border-radius:var(--radius-sm); border-left-width:3px; border-left-style:solid;
    cursor:pointer; margin-bottom:8px;
  }
  .job-card-compact:hover{ background:rgba(255,255,255,.05); }
  .job-card-compact[data-status="pending"]{ border-left-color:#90a4ae; }
  .job-card-compact[data-status="confirmed"]{ border-left-color:var(--blue-light); }
  .job-card-compact[data-status="inprogress"]{ border-left-color:var(--orange); }
  .job-card-compact[data-status="completed"]{ border-left-color:var(--green); }
  .job-card-compact[data-status="cancelled"]{ border-left-color:var(--danger); opacity:.7; }
  .job-card-compact-main{ flex:1; min-width:0; }
  .job-card-compact-title{
    font-size:13.5px; font-weight:600; color:var(--white);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .job-card-compact-pin{ margin-left:4px; font-size:11px; opacity:.7; }
  .job-card-compact-customer{ font-size:12px; color:var(--ink-muted); margin-top:2px; }
  .job-card-compact-right{ text-align:right; flex:none; }
  .job-card-compact-amount{ font-size:12.5px; font-weight:600; color:var(--green); margin-bottom:4px; white-space:nowrap; }
  .job-card-compact-chevron{ color:var(--ink-faint); font-size:18px; flex:none; }
```

- [ ] **Step 2: Add the builder function**

Find (`admin/index.html:5219`, right after `buildJobCardHtml`'s closing `}` and before `function canEditJobs(){`):

```javascript
  function canEditJobs(){
```

Insert immediately before it:

```javascript
  // Lean row-card for the Jobs list (Task: unified Jobs card view) —
  // shows only what's needed to identify/tap into a job; everything else
  // (address, deposit breakdown, vehicle) stays in the detail modal
  // (openJobModal), same as Urable's reference pattern. Does NOT replace
  // buildJobCardHtml() — Agenda keeps the fuller card on purpose.
  function buildJobCardCompactHtml(j){
    return `
      <div class="job-card-compact" data-status="${STATUS_SLUG[j.status]}" data-job-id="${j.id}">
        <div class="job-card-compact-main">
          <div class="job-card-compact-title">
            JOB #${escapeHtml(j.jobNumber)} — ${escapeHtml(j.service)}${j.address ? '<span class="job-card-compact-pin">📍</span>' : ''}
          </div>
          <div class="job-card-compact-customer">${escapeHtml(j.customer.name)}</div>
        </div>
        <div class="job-card-compact-right">
          <div class="job-card-compact-amount">${formatCurrency(balanceDue(j))} due</div>
          ${renderStatusBadge(j)}
        </div>
        <span class="job-card-compact-chevron">›</span>
      </div>
    `;
  }

```

- [ ] **Step 3: Verify with Playwright**

Use the `headless-browser-sandbox` project skill. Load `admin/index.html` via the fake-https-origin technique already used earlier in this session (real file content served over `page.route()`, never modified on disk), seed a fake job into `JOBS`, call `buildJobCardCompactHtml(job)` via `page.evaluate`, inject the returned HTML into a scratch container, and assert: the element has `data-status="confirmed"` (or whatever status you seeded), `data-job-id` matches, the title/customer/amount text is present and HTML-escaped (seed a job with `service: '<script>alert(1)</script>'` and confirm the literal tag text appears escaped, not executed — check `document.querySelectorAll('script').length` didn't grow).

- [ ] **Step 4: Update CONTEXT.md and commit**

```bash
git add admin/index.html CONTEXT.md
git commit -m "feat: buildJobCardCompactHtml() — lean job row-card component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Jobs view — filter tabs + card list (replaces the table)

**Files:**
- Modify: `admin/index.html:1724-1741` (the `view-jobs` section's markup)
- Modify: `admin/index.html:5335-5368` (`renderJobsTable()`)
- Modify: `admin/index.html:6375-6390` (the document-level click delegation block)

**Interfaces:**
- Consumes: `buildJobCardCompactHtml(j)` (Task 3); `JOBS` array with `j.source` (Task 2); `state.customerFilterEmail` (existing); `openJobModal(jobId)` (existing, `admin/index.html:5946`); `ADMIN_TIME_SLOTS` (existing, used for sorting).
- Produces: `state.jobsStatusFilter` (new, one of `'all' | 'Pending' | 'Confirmed' | 'In Progress' | 'Completed' | 'Cancelled'`, default `'all'`); `state.jobsOnlineOnly` (new, boolean, default `false`).

The line numbers below are current as of this plan being written; Task 1-3 don't touch these lines, so they should still be accurate — locate by the shown text if anything drifted.

- [ ] **Step 1: Replace the view-jobs markup**

Find (`admin/index.html:1724-1741`):

```html
      <section class="view" id="view-jobs">
        <div class="panel">
          <h3 class="section-title">All Jobs</h3>
          <div class="filter-banner" id="jobs-filter-banner" hidden>
            Showing jobs for <strong id="jobs-filter-name"></strong> —
            <button type="button" class="link-btn" id="jobs-filter-clear">Clear filter</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Job #</th><th>Date</th><th>Customer</th><th>Service</th><th>Vehicle</th>
                  <th>Total</th><th>Deposit</th><th>Balance</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody id="jobs-table-body"></tbody>
            </table>
          </div>
```

Replace with:

```html
      <section class="view" id="view-jobs">
        <div class="panel">
          <h3 class="section-title">All Jobs</h3>
          <div class="filter-banner" id="jobs-filter-banner" hidden>
            Showing jobs for <strong id="jobs-filter-name"></strong> —
            <button type="button" class="link-btn" id="jobs-filter-clear">Clear filter</button>
          </div>
          <div class="job-status-tabs" id="jobs-status-tabs"></div>
          <button type="button" class="pm-method-btn" id="jobs-online-toggle" style="margin-bottom:12px;">🌐 Online Bookings</button>
          <div id="jobs-cards-list"></div>
```

(The closing `</div>` for `.panel` and `</section>` further down are unchanged — only the table markup and its immediate wrapper are replaced.)

- [ ] **Step 2: Add the status-tabs CSS**

Add near the existing `.pm-method-btn`/`.pm-method-grid` rules (search for `.pm-method-btn.selected{`):

```css
  .job-status-tabs{ display:flex; gap:6px; overflow-x:auto; margin-bottom:12px; padding-bottom:2px; }
  .job-status-tab{
    flex:none; padding:6px 12px; border-radius:999px; border:1px solid var(--line);
    background:transparent; color:var(--ink-muted); font-size:12.5px; font-weight:600;
    cursor:pointer; white-space:nowrap;
  }
  .job-status-tab.active{ background:var(--gold); border-color:var(--gold); color:#1a1200; }
  #jobs-online-toggle.active{ border-color:var(--gold); color:var(--gold); }
```

- [ ] **Step 3: Rewrite `renderJobsTable()`**

Find (`admin/index.html:5334-5373`, the whole function plus its old filter-clear listener):

```javascript
  // ================= JOBS TABLE =================
  function renderJobsTable(){
    const tbody = document.getElementById('jobs-table-body');
    const banner = document.getElementById('jobs-filter-banner');

    let list = [...JOBS].sort((a,b) => a.date - b.date || ADMIN_TIME_SLOTS.indexOf(a.time) - ADMIN_TIME_SLOTS.indexOf(b.time));

    if (state.customerFilterEmail){
      list = list.filter(j => j.customer.email === state.customerFilterEmail);
      const customer = list[0] || JOBS.find(j => j.customer.email === state.customerFilterEmail);
      document.getElementById('jobs-filter-name').textContent = customer ? customer.customer.name : '';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    tbody.innerHTML = list.map(j => `
      <tr>
        <td>#${j.jobNumber}</td>
        <td>${formatShortDate(j.date)}</td>
        <td>${j.customer.name}</td>
        <td>${j.service}</td>
        <td>${j.vehicle}</td>
        <td>${formatCurrency(j.total)}</td>
        <td>${formatCurrency(getDepositAmount(j))}</td>
        <td>${formatCurrency(balanceDue(j))}</td>
        <td><span class="status-display" data-job-id="${j.id}">${renderStatusBadge(j)}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn-mini job-view-btn" data-job-id="${j.id}">View</button>
          <button type="button" class="btn-mini job-editstatus-btn" data-job-id="${j.id}">Edit Status</button>
          ${canEditJobs() ? `<button type="button" class="btn-mini job-edit-btn" data-job-id="${j.id}">Edit</button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('jobs-filter-clear').addEventListener('click', () => {
    state.customerFilterEmail = null;
    renderJobsTable();
  });
```

Replace with:

```javascript
  // ================= JOBS LIST (card view) =================
  const JOB_STATUS_TABS = ['all', 'Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];

  function renderJobsTable(){
    const banner = document.getElementById('jobs-filter-banner');
    const tabsEl = document.getElementById('jobs-status-tabs');
    const listEl = document.getElementById('jobs-cards-list');
    const onlineBtn = document.getElementById('jobs-online-toggle');

    let list = [...JOBS].sort((a,b) => a.date - b.date || ADMIN_TIME_SLOTS.indexOf(a.time) - ADMIN_TIME_SLOTS.indexOf(b.time));

    if (state.customerFilterEmail){
      list = list.filter(j => j.customer.email === state.customerFilterEmail);
      const customer = list[0] || JOBS.find(j => j.customer.email === state.customerFilterEmail);
      document.getElementById('jobs-filter-name').textContent = customer ? customer.customer.name : '';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    // Tab counts reflect the customer filter (if any) but not the other
    // tab/online-toggle selections themselves, so switching tabs never
    // makes another tab's count jump around.
    tabsEl.innerHTML = JOB_STATUS_TABS.map(status => {
      const count = status === 'all' ? list.length : list.filter(j => j.status === status).length;
      const active = state.jobsStatusFilter === status;
      const label = status === 'all' ? 'All' : status;
      return `<button type="button" class="job-status-tab${active ? ' active' : ''}" data-status-tab="${escapeHtml(status)}">${escapeHtml(label)} (${count})</button>`;
    }).join('');

    onlineBtn.classList.toggle('active', state.jobsOnlineOnly);

    if (state.jobsStatusFilter !== 'all'){
      list = list.filter(j => j.status === state.jobsStatusFilter);
    }
    if (state.jobsOnlineOnly){
      list = list.filter(j => j.source === 'online_booking');
    }

    listEl.innerHTML = list.map(buildJobCardCompactHtml).join('')
      || '<p class="empty-state">No jobs match this filter.</p>';
  }

  document.getElementById('jobs-filter-clear').addEventListener('click', () => {
    state.customerFilterEmail = null;
    renderJobsTable();
  });
  document.getElementById('jobs-status-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-status-tab]');
    if (!tab) return;
    state.jobsStatusFilter = tab.dataset.statusTab;
    renderJobsTable();
  });
  document.getElementById('jobs-online-toggle').addEventListener('click', () => {
    state.jobsOnlineOnly = !state.jobsOnlineOnly;
    renderJobsTable();
  });
```

- [ ] **Step 4: Initialize the new state fields**

Find (`admin/index.html:3698-3704`):

```javascript
  const state = {
    selectedDate: new Date(TODAY),
    calendarViewDate: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1),
    calendarView: 'agenda',
    customerFilterEmail: null,
    paymentsFilters: { dateFrom:null, dateTo:null, status:'', customer:'', method:'' }
  };
```

Replace with:

```javascript
  const state = {
    selectedDate: new Date(TODAY),
    calendarViewDate: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1),
    calendarView: 'agenda',
    customerFilterEmail: null,
    jobsStatusFilter: 'all',
    jobsOnlineOnly: false,
    paymentsFilters: { dateFrom:null, dateTo:null, status:'', customer:'', method:'' }
  };
```

- [ ] **Step 5: Wire the card click to open the job modal**

Find (`admin/index.html:6374-6390`):

```javascript
  // ---- Event delegation: View / Edit Status buttons + status <select> changes ----
  document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('.job-view-btn');
    if (viewBtn){
      openJobModal(Number(viewBtn.dataset.jobId));
      return;
    }
```

Insert immediately after the opening of that listener (before the `viewBtn` check, so it takes priority — though the two never overlap since `.job-card-compact` doesn't contain a `.job-view-btn`):

```javascript
    const compactCard = e.target.closest('.job-card-compact');
    if (compactCard){
      openJobModal(Number(compactCard.dataset.jobId));
      return;
    }
```

- [ ] **Step 6: Verify with Playwright**

Use the `headless-browser-sandbox` project skill, fake-https-origin technique. Seed `JOBS` with a mix of statuses and `source` values (at least one `'online_booking'` and one `'manual'`), call `renderJobsTable()`, then:
1. Assert `#jobs-status-tabs` renders 6 tabs with correct counts.
2. Click a status tab (e.g. `[data-status-tab="Completed"]`), assert `#jobs-cards-list` only shows cards for that status and the tab gets `.active`.
3. Click `#jobs-online-toggle`, assert only `source === 'online_booking'` jobs remain (combined with whatever status tab is active) and the button gets `.active`.
4. Click a `.job-card-compact`, assert `openJobModal` was invoked with the right id — the simplest real check is that `#modal-overlay` (the job detail modal) becomes visible (`hidden` attribute removed) and its title reflects the clicked job's number.
5. Set the viewport to `375x812` (iPhone-sized) and assert `document.documentElement.scrollWidth <= 375` after rendering a full list — no horizontal overflow.
6. Set the viewport to `1400x900` and assert the same list renders without error (desktop uses the identical markup/function, per the Global Constraint — this check just confirms nothing broke at a wide viewport, not a separate code path).

- [ ] **Step 7: Update CONTEXT.md and commit**

```bash
git add admin/index.html CONTEXT.md
git commit -m "feat: replace Jobs table with filterable compact card list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Calendar — date-jump input

**Files:**
- Modify: `admin/index.html:1703-1709` (the `.cal-revenue-bar` toolbar)

**Interfaces:**
- Consumes: `state.selectedDate` (existing); `renderCalendarViews()` (existing, `admin/index.html:5060`); `toInputDate`/`fromInputDate` (existing — used elsewhere in this file for `<input type="date">` value conversion, e.g. `document.getElementById('ce-date').value = toInputDate(state.selectedDate)` at `admin/index.html:8323` — same conversion helpers, same pattern).

- [ ] **Step 1: Add the input**

Find (`admin/index.html:1703-1709`):

```html
          <div class="cal-revenue-bar">
            <button type="button" class="cal-nav" id="cal-period-prev" aria-label="Previous period">‹</button>
            <button type="button" class="btn-mini" id="cal-period-today">Today</button>
            <span class="cal-period-label" id="cal-period-label"></span>
            <button type="button" class="cal-nav" id="cal-period-next" aria-label="Next period">›</button>
            <span class="cal-period-revenue" id="cal-period-revenue"></span>
          </div>
```

Replace with:

```html
          <div class="cal-revenue-bar">
            <button type="button" class="cal-nav" id="cal-period-prev" aria-label="Previous period">‹</button>
            <button type="button" class="btn-mini" id="cal-period-today">Today</button>
            <input type="date" id="cal-jump-date" aria-label="Jump to date" class="btn-mini">
            <span class="cal-period-label" id="cal-period-label"></span>
            <button type="button" class="cal-nav" id="cal-period-next" aria-label="Next period">›</button>
            <span class="cal-period-revenue" id="cal-period-revenue"></span>
          </div>
```

- [ ] **Step 2: Wire it, and keep it synced when the date changes some other way**

`renderCalendarViews()` (`admin/index.html:5060`) calls `updateCalendarPeriodBar()` (`admin/index.html:5038-5044`) on every render, which is the single choke point where the period label already refreshes — hook the date input's value there too so Prev/Next/Today/clicking a day cell all keep it in sync, not just picking a date from the input itself.

Find (`admin/index.html:5038-5041`, locate by this literal text — Task 4 shifts line numbers above this point):

```javascript
  function updateCalendarPeriodBar(){
    const { start, end } = getCalendarPeriodRange();
    const label = isSameDay(start, end) ? formatLongDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
    document.getElementById('cal-period-label').textContent = label;
```

Replace with:

```javascript
  function updateCalendarPeriodBar(){
    const { start, end } = getCalendarPeriodRange();
    const label = isSameDay(start, end) ? formatLongDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
    document.getElementById('cal-period-label').textContent = label;
    document.getElementById('cal-jump-date').value = toInputDate(state.selectedDate);
```

Then find (`admin/index.html:4984-4989`):

```javascript
  document.getElementById('cal-period-today').addEventListener('click', () => {
    state.selectedDate = new Date(TODAY);
    state.calendarViewDate = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    renderCalendarViews();
  });
  document.getElementById('calendar-employee-filter').addEventListener('change', () => renderCalendarViews());
```

Add immediately after (before `calendar-employee-filter`'s listener, order doesn't matter — placed here to stay next to the other date-navigation listener):

```javascript
  document.getElementById('cal-jump-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.selectedDate = fromInputDate(e.target.value);
    state.calendarViewDate = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
    renderCalendarViews();
  });
```

(Also updates `state.calendarViewDate` to the picked date's month — same as the `Today` handler does — so jumping to a date in a different month correctly moves the Month view too, not just the Agenda/Week/Day selection.)

- [ ] **Step 3: Verify with Playwright**

Use the `headless-browser-sandbox` project skill, fake-https-origin technique. Load the page, call `renderCalendarViews()` once to establish a baseline, set `#cal-jump-date`'s value to a date two months in the future (`page.fill` or `page.evaluate` setting `.value` + dispatching a `change` event — native date inputs need a real `change` event, not just a value assignment, to fire the listener), and assert `state.selectedDate` (read via the same `window.__test` exposure pattern used elsewhere this session) now matches that date, and `#cal-period-label`'s text changed accordingly.

- [ ] **Step 4: Update CONTEXT.md and commit**

```bash
git add admin/index.html CONTEXT.md
git commit -m "feat: add date-jump input to Calendar toolbar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: CONTEXT.md wrap-up, Hostinger deploy zip

**Files:**
- Modify: `CONTEXT.md`
- No code files — packaging/deploy only.

- [ ] **Step 1: Update CONTEXT.md**

Add a `## Fixes recientes` entry (dated today) summarizing the whole effort: `jobs.source` column, the compact card component, the unified filterable Jobs view (desktop+mobile, no more horizontal scroll), and the calendar date-jump. Note explicitly what's still out of scope per the spec (full-screen mobile modals, touch targets, dark/light theme, Customers/Payments/Proposals tables) so the next session doesn't have to re-derive it.

- [ ] **Step 2: Rebuild and verify the Hostinger deploy zip**

Follow the established pattern (write to a scratch temp path with Python's `zipfile`, `shutil.copyfile` into the OneDrive path, extract-and-`diff -rq` against the repo to confirm a byte-exact match — same 10 files as every prior deploy zip this session: `admin/index.html`, `booking/index.html`, `booking/success.html`, `brand/altalux-logo-color.png`, `brand/altalux-logo-white.png`, `pay/index.html`, `shared/config.js`, `technician/index.html`, `privacy.html`, `terms.html` — only `admin/index.html` carries this plan's changes).

- [ ] **Step 3: Deploy**

Try the Hostinger API first (`hosting_generateUploadURLV1`/TUS upload/`hosting_deployStaticSiteArchiveV1`, same flow used earlier this session) — **confirm with the user before the deploy call**, it overwrites the live site and cannot be undone. If the API is down (it has been intermittently flaky throughout this session), tell the user the zip path and let them upload via Hostinger's file manager instead, same fallback used earlier.

- [ ] **Step 4: Live verification**

Fetch the raw live HTML directly (`curl`, not `WebFetch` — `WebFetch` has repeatedly failed to reliably find strings inside `<script>` tags earlier in this session) and `grep` for `job-card-compact` and `jobs-status-tabs` to confirm the new markup is actually live. Ask the user to check the Jobs tab on their phone for the real "no horizontal scroll" experience — that's not something this sandbox can verify visually.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: Jobs mobile UX (card view + filters + date-jump) shipped

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
