# AltaLux App — Reporte Fase A: Fundación Multi-Tenant
> Fecha: 2026-07-14
> Commit: `f25b8af` (rama `main`, ya en GitHub)

---

## Objetivo de esta fase

Mover toda la configuración de negocio (precios, servicios, colores, contacto,
credenciales de Square) de estar hardcodeada en el HTML a vivir en Supabase,
para que el mismo código sirva a AltaLux y — más adelante — a BlissClean sin
tocar código, solo agregando una fila nueva en `business_settings`.

---

## 1. Base de datos (Supabase)

5 migraciones nuevas en `supabase/migrations/`, aplicadas directo contra la
base remota (proyecto `xmhsehfdmiqbwhpqjgon`):

- **`phase_a_multitenant.sql`** — Tablas nuevas: `business_settings`,
  `business_services` (21 filas con el catálogo real de precios de AltaLux),
  `business_addons` (10 filas, incluye el wax por tier de vehículo). Se agregó
  columna `business_id` (default `'altalux'`) a `jobs`, `customers`,
  `vehicles`, `bookings`, `payments`, `invoices`, `employees` — no rompe nada
  existente.
- **`phase_a_seed_altalux.sql`** — Los datos reales de AltaLux sembrados en
  las tablas nuevas.
- **`phase_a_rls.sql`** + **`phase_a_rls_fix.sql`** — Políticas de seguridad
  (ver sección 2).
- **`phase_a_settings_extra_columns.sql`** — 3 columnas adicionales
  (`available_days`, `available_time_slots`, `email_toggles`) que el panel de
  Settings necesitaba y el esquema original no incluía.

## 2. Hallazgo de seguridad crítico

El esquema original iba a guardar `square_access_token` y `stripe_secret_key`
en una tabla legible por la `anon key` pública (la misma que está en el HTML
del sitio) — es decir, el token real de Square habría quedado públicamente
visible en internet apenas se guardara.

**Se probó de verdad:** se metió un valor de prueba en esa columna y se
confirmó que se filtraba con la configuración original. Se corrigió creando
una vista `business_settings_public` que excluye esas dos columnas, y se
bloqueó el acceso directo a la tabla real para todos excepto el rol
`authenticated` (empleados logueados) y el `service_role` (Edge Functions).
Se volvió a probar con el mismo valor y se confirmó que ya no se filtra por
ningún camino. El valor de prueba fue eliminado.

## 3. `shared/config.js` (archivo nuevo)

Detecta el negocio por dominio (`altaluxdetail.com` → `altalux`,
`blisscleandetail.com` → `blissclean`), carga settings/servicios/addons desde
Supabase vía REST plano (sin dependencia de supabase-js), expone
`window.APP_CONFIG` con funciones helper (`getServicePrice`, `getDeposit`,
`getWaxPrice`, `formatCurrency`, `formatDate`), aplica los colores de marca
automáticamente sobrescribiendo las variables CSS existentes (`--blue`,
`--orange`, `--gold`, `--dark`), y tiene un fallback hardcodeado con los datos
reales de AltaLux por si Supabase no responde.

## 4. `admin/index.html` — Página nueva: Settings (solo Owner)

7 pestañas, todas conectadas a Supabase de verdad (no placeholders):
Business Info, Branding (selector de color con vista previa en vivo),
Servicios y Precios (tabla editable), Add-ons (editable + agregar/quitar),
Booking Settings, Payments (credenciales de Square, token enmascarado con
botón mostrar/ocultar), Notifications (toggles por tipo de email).

## 5. `technician/index.html`

Se agregó `shared/config.js` — los colores de marca se aplican ahí también.

## 6. Edge Function nueva: `send-email`

Desplegada y funcionando (`supabase functions deploy send-email`). Maneja 5
tipos de correo: `booking_confirmation`, `job_confirmed`, `reminder_24h`,
`job_completed` (factura), `internal_notification`. Usa Resend
(`RESEND_API_KEY` ya configurado como secret).

## 7. Emails conectados a la app real

- **Booking**: al pagar el depósito con Square, dispara confirmación al
  cliente + notificación interna al negocio — sin bloquear la pantalla de
  confirmación si el email falla (no-blocking).
- **Admin**: status → "Confirmed" dispara email al cliente. Status →
  "Completed" dispara factura por email. Nuevo botón "Send Reminder". Los
  botones "Send Invoice"/"Resend Invoice" (antes solo mostraban una alerta
  falsa) ahora mandan el correo real.
- **Technician**: al completar un trabajo (con fotos), dispara el email de
  factura.

## 8. Bug de producción encontrado y corregido: `SQUARE_APP_ID`

Este repo de git tenía `SQUARE_APP_ID` con una `z` minúscula
(`...RGgzrQ`), pero la carpeta de despliegue en Windows
(`Altaluxapp/altalux-deploy`, lo que corre en producción) tenía la `Z`
mayúscula correcta (`...RGgZrQ`) — un fix histórico (commit `e2f45b8`,
"fix: correct Square Application ID typo") que nunca se había sincronizado a
este clon local. Se verificó carácter por carácter con Python y se corrigió
en los 6 lugares donde vivía ese valor: los 3 archivos HTML, `config.js`, la
fila en Supabase, y el SQL de seed.

**El código de inicialización de Square, el formulario de pago, y la lógica
de tokenización nunca fueron tocados** — confirmado por `git diff` línea por
línea en cada paso.

Al hacer `git push`, git detectó que ese mismo commit `e2f45b8` y otro
(`402c493`, actualización de `CONTEXT.md`) ya estaban en GitHub — pusheados
por separado el mismo día. Se hizo `git merge` sin conflictos (el contenido
ya coincidía) antes de subir todo.

## 9. Pruebas realizadas

Con Playwright headless (siguiendo el skill del proyecto
`.claude/skills/headless-browser-sandbox/`):

- **Booking y Technician**: cero errores de consola, cero requests fallidos,
  capturas de pantalla confirman que todo se ve igual que antes.
- **Admin Settings**: las 7 pestañas cargan y navegan bien, el selector de
  color con vista previa en vivo funciona (probado cambiando un color y
  viendo el preview actualizarse en tiempo real). No había credenciales
  reales de login disponibles, así que no se pudo probar la carga de datos
  con una sesión real — pero se confirmó a nivel de base de datos que el rol
  `authenticated` tiene los permisos correctos (`SELECT`/`INSERT`/`UPDATE`/
  `DELETE` en `business_settings`), así que con un login real debería
  funcionar sin cambios adicionales.

## 10. Pendiente / no tocado en esta fase

- **`square-payment` Edge Function** — todavía lee credenciales de una
  variable de entorno fija, no de `business_settings` por negocio. Se dejó
  intacta a propósito (instrucción explícita de no tocar Square hasta que el
  resto estuviera confirmado funcionando).
- **`booking/index.html`** — el catálogo de servicios/precios todavía está
  hardcodeado ahí (`CATEGORIES`, `ADDONS_INTERIOR`, etc.), no conectado a
  `APP_CONFIG` todavía. Solo se tocó lo mínimo necesario para disparar los
  emails post-pago.
- El botón "Test Connection" en Settings → Payments es honesto: indica que
  necesita la actualización de `square-payment` para funcionar.
- Fase 6 (BlissClean multi-tenant) sigue sin iniciar — la fundación de esta
  fase ya lo deja listo (solo falta crear la fila de `business_settings` para
  `blissclean` y sus servicios/addons).

## 11. Commits de esta fase

```
a134740  feat: phase A — multi-tenant foundation, business_settings, shared config, Resend emails, security fix
f25b8af  Merge remote-tracking branch 'refs/remotes/origin-temp/main'
```

---

## Cuentas y Servicios (sin cambios desde `CONTEXTO_PROYECTO.md`)

- **Supabase**: proyecto `xmhsehfdmiqbwhpqjgon`, 5 Edge Functions ahora en uso
  (`square-payment`, `manage-employee-auth`, `send-email`, más las que ya
  existían).
- **Resend**: `RESEND_API_KEY` configurado como secret — falta configurar
  `resend_from_email` real en Settings → Notifications para que los correos
  salgan (por ahora `send-email` responde con error claro si falta).
- **Square**: producción, `SQUARE_APP_ID` corregido y verificado en los 6
  lugares donde vive.
