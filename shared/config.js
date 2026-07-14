/*
 * shared/config.js — single source of truth for business configuration.
 *
 * Every HTML file (booking, admin, technician) loads this first. It
 * detects which business is being served from the domain, fetches that
 * business's settings/services/addons from Supabase over plain REST
 * (no supabase-js dependency, so this file has zero load-order
 * requirements against other scripts), exposes them on window.APP_CONFIG,
 * applies branding, and fires `appConfigLoaded` on `document` when ready
 * — successfully or via fallback — so callers never have to guess.
 *
 * Note: the public read goes through the `business_settings_public` VIEW,
 * not the `business_settings` table. The table holds real payment secrets
 * (square_access_token, stripe_secret_key) and anon/authenticated have NO
 * grant on it at all (enforced in supabase/migrations/phase_a_rls_fix.sql)
 * — only service_role (used server-side in Edge Functions) can read it.
 * The view exposes every other column, which is everything the client
 * legitimately needs (square_app_id/location_id are publishable IDs, not
 * secrets — the Square Web Payments SDK is designed to use them client-side).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://xmhsehfdmiqbwhpqjgon.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtaHNlaGZkbWlxYndocHFqZ29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODU5NzQsImV4cCI6MjA5ODk2MTk3NH0.J2UOp-pgzP6ByvDBoHcocFAmarWdlDK8M31YgKrUNss';

  function detectBusinessId() {
    var host = (window.location.hostname || '').toLowerCase();
    if (host.indexOf('blisscleandetail.com') !== -1) return 'blissclean';
    if (host.indexOf('altaluxdetail.com') !== -1) return 'altalux';
    return 'altalux'; // localhost / 127.0.0.1 / anything else — dev default
  }

  // ---------- Hardcoded AltaLux fallback (used only if Supabase is
  // unreachable, or returns no row for the detected business) ----------
  var FALLBACK_SETTINGS = {
    business_id: 'altalux',
    name: 'AltaLux Mobile Detail',
    email: null,
    phone: '(888) 853-0590',
    city: 'Roswell',
    state: 'GA',
    website: 'https://altaluxdetail.com',
    primary_color: '#104872',
    secondary_color: '#FF8C00',
    accent_color: '#FFAA00',
    background_color: '#0a1628',
    deposit_percentage: 25,
    cancellation_hours: 72,
    late_fee: 50,
    cancellation_policy: 'A 25% non-refundable deposit is required to confirm your booking. Cancellations or rescheduling with less than 72 hours notice will forfeit the deposit. Our technicians rely on scheduled appointments for their income. Please be aware of your arrival window — if your vehicle is not available within 15 minutes of technician arrival, a $50 late fee will apply.',
    booking_url: '/booking/',
    admin_url: '/admin/',
    technician_url: '/technician/',
    square_app_id: 'sq0idp-jVMn1EDrut74rDnsRGgZrQ',
    square_location_id: 'LEWG2XNWRA7BS',
    square_environment: 'production',
    square_enabled: true,
    stripe_enabled: false,
    resend_enabled: false,
    twilio_enabled: false
  };

  var WAX_TIER_LABEL = { small: 'Small', mid: 'Mid', large: 'Large' };

  function buildFallbackAddon(name, price, category, priceVaries, description) {
    return { id: name, name: name, price: price, price_varies: !!priceVaries, description: description || null, category: category, is_active: true };
  }

  var FALLBACK_ADDONS = [
    buildFallbackAddon('Pet Hair Removal', 50.00, 'interior', true, 'Final price may vary'),
    buildFallbackAddon('Leather Seat Conditioning', 50.00, 'interior'),
    buildFallbackAddon('New Car Smell Air Cabin Treatment', 50.00, 'interior'),
    buildFallbackAddon('UV Protective Dressing – Interior Plastics', 50.00, 'interior'),
    buildFallbackAddon('Ozone Treatment', 125.00, 'interior'),
    buildFallbackAddon('Sap/Tar Removal', 75.00, 'exterior', true, 'Final price may vary'),
    buildFallbackAddon('Black Trim Restoration', 125.00, 'exterior'),
    buildFallbackAddon('Machine Applied Wax - Small', 50.00, 'machine_wax_tier'),
    buildFallbackAddon('Machine Applied Wax - Mid', 60.00, 'machine_wax_tier'),
    buildFallbackAddon('Machine Applied Wax - Large', 70.00, 'machine_wax_tier')
  ];

  // Kept intentionally minimal — full service catalog (all 21 rows with
  // descriptions/included items) lives in Supabase. If Supabase is down,
  // the booking widget still needs *some* prices to not be fully broken;
  // this fallback favors "never break" over completeness.
  var FALLBACK_SERVICES = [
    { business_id: 'altalux', category: 'full', package: 'essential', vehicle_type: 'Cars/Sedans', price: 208.99, duration_minutes: 180, description: '', included_items: { tier: 'small', includesWax: false } },
    { business_id: 'altalux', category: 'full', package: 'essential', vehicle_type: 'Mid-Size/Compact SUVs', price: 238.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: false } },
    { business_id: 'altalux', category: 'full', package: 'essential', vehicle_type: 'Small Trucks', price: 268.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: false } },
    { business_id: 'altalux', category: 'full', package: 'essential', vehicle_type: 'Minivans', price: 268.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: false } },
    { business_id: 'altalux', category: 'full', package: 'essential', vehicle_type: 'Large SUVs/Trucks', price: 268.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: false } },
    { business_id: 'altalux', category: 'full', package: 'premium', vehicle_type: 'Cars/Sedans', price: 288.99, duration_minutes: 180, description: '', included_items: { tier: 'small', includesWax: true } },
    { business_id: 'altalux', category: 'full', package: 'premium', vehicle_type: 'Mid-Size/Compact SUVs', price: 308.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: true } },
    { business_id: 'altalux', category: 'full', package: 'premium', vehicle_type: 'Small Trucks', price: 308.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: true } },
    { business_id: 'altalux', category: 'full', package: 'premium', vehicle_type: 'Minivans', price: 378.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: true } },
    { business_id: 'altalux', category: 'full', package: 'premium', vehicle_type: 'Large SUVs/Trucks', price: 378.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: true } },
    { business_id: 'altalux', category: 'interior', package: 'interior', vehicle_type: 'Cars/Sedans', price: 239.99, duration_minutes: 180, description: '', included_items: { tier: 'small', includesWax: false } },
    { business_id: 'altalux', category: 'interior', package: 'interior', vehicle_type: 'Compact/Mid-Size SUV', price: 264.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: false } },
    { business_id: 'altalux', category: 'interior', package: 'interior', vehicle_type: 'Small Truck', price: 264.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: false } },
    { business_id: 'altalux', category: 'interior', package: 'interior', vehicle_type: 'Large SUV/3rd Row SUVs', price: 284.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: false } },
    { business_id: 'altalux', category: 'interior', package: 'interior', vehicle_type: 'Large Truck', price: 284.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: false } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'Car', price: 159.99, duration_minutes: 180, description: '', included_items: { tier: 'small', includesWax: true } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'Compact/Midsize SUV', price: 189.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: true } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'Truck', price: 189.99, duration_minutes: 180, description: '', included_items: { tier: 'mid', includesWax: true } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'Minivan', price: 189.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: true } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'Large/XL SUV', price: 219.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: true } },
    { business_id: 'altalux', category: 'exterior', package: 'exterior', vehicle_type: 'XL SUV, Truck or Van', price: 244.99, duration_minutes: 180, description: '', included_items: { tier: 'large', includesWax: true } }
  ];

  async function restGet(path) {
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!res.ok) throw new Error('Supabase REST error ' + res.status + ' for ' + path);
    return res.json();
  }

  function applyBranding(settings) {
    var root = document.documentElement.style;
    // Spec-named tokens
    root.setProperty('--brand-primary', settings.primary_color);
    root.setProperty('--brand-secondary', settings.secondary_color);
    root.setProperty('--brand-accent', settings.accent_color);
    root.setProperty('--brand-bg', settings.background_color);
    // Alias the variable names already used throughout the existing
    // booking/admin/technician CSS (--blue/--orange/--gold/--dark) so
    // every existing rule re-colors automatically without having to
    // rewrite hundreds of CSS declarations across three large files.
    root.setProperty('--blue', settings.primary_color);
    root.setProperty('--orange', settings.secondary_color);
    root.setProperty('--gold', settings.accent_color);
    root.setProperty('--dark', settings.background_color);
    if (settings.name) document.title = document.title.replace(/AltaLux Mobile Detail/g, settings.name);
  }

  function makeHelpers(cfg) {
    cfg.getServicePrice = function (category, pkg, vehicleType) {
      var row = cfg.services.find(function (s) {
        return s.category === category && s.package === pkg && s.vehicle_type === vehicleType;
      });
      return row ? Number(row.price) : null;
    };
    cfg.getDeposit = function (total) {
      var pct = (cfg.settings && cfg.settings.deposit_percentage != null) ? cfg.settings.deposit_percentage : 25;
      return Math.round(total * (pct / 100) * 100) / 100;
    };
    cfg.getAddonsByCategory = function (category) {
      return cfg.addons.filter(function (a) { return a.category === category && a.is_active !== false; });
    };
    cfg.getWaxPrice = function (tier) {
      var label = WAX_TIER_LABEL[tier] || tier;
      var row = cfg.addons.find(function (a) {
        return a.category === 'machine_wax_tier' && a.name === 'Machine Applied Wax - ' + label;
      });
      return row ? Number(row.price) : null;
    };
    cfg.formatCurrency = function (amount) {
      return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    cfg.formatDate = function (date) {
      var d = (date instanceof Date) ? date : new Date(date);
      return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };
    return cfg;
  }

  var businessId = detectBusinessId();

  window.APP_CONFIG = makeHelpers({
    businessId: businessId,
    settings: null,
    services: [],
    addons: [],
    loaded: false
  });

  function finish(settings, services, addons) {
    window.APP_CONFIG.settings = settings;
    window.APP_CONFIG.services = services;
    window.APP_CONFIG.addons = addons;
    window.APP_CONFIG.loaded = true;
    try { applyBranding(settings); } catch (e) { console.error('APP_CONFIG: branding apply failed', e); }
    document.dispatchEvent(new CustomEvent('appConfigLoaded', { detail: window.APP_CONFIG }));
  }

  function useFallback(reason) {
    console.warn('APP_CONFIG: falling back to hardcoded AltaLux defaults —', reason);
    finish(FALLBACK_SETTINGS, FALLBACK_SERVICES, FALLBACK_ADDONS);
  }

  (async function load() {
    try {
      var settingsRows = await restGet('business_settings_public?business_id=eq.' + encodeURIComponent(businessId) + '&select=*&is_active=eq.true');
      if (!settingsRows || !settingsRows.length) {
        useFallback('no business_settings row for "' + businessId + '"');
        return;
      }
      var settings = settingsRows[0];
      var services = await restGet('business_services?business_id=eq.' + encodeURIComponent(businessId) + '&is_active=eq.true&select=*');
      var addons = await restGet('business_addons?business_id=eq.' + encodeURIComponent(businessId) + '&is_active=eq.true&select=*');
      finish(settings, services || [], addons || []);
    } catch (err) {
      useFallback(err.message || err);
    }
  })();
})();
