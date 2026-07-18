# AltaLux App — Contexto del Proyecto
> Última actualización: 2026-07-17

## ¿Qué es esto?
App de field service para AltaLux Mobile Detail (Roswell, GA).
Replica funcionalidad core de Urable pero custom, sin mensualidad.
Eventualmente se adaptará también para BlissClean Mobile Detail.

## Marcas
- **AltaLux Mobile Detail** — Roswell, GA (marca principal de este repo)
- **BlissClean Mobile Detail** — Dunwoody, GA (Fase 6, no iniciada)

## Stack
- Frontend: HTML/CSS/JS vanilla (sin frameworks)
- Base de datos: Supabase (PostgreSQL + Auth + Edge Functions) — **conectado y en uso real**
- Pagos: **Square** (Web Payments SDK + Payments API) — no Stripe
- Emails: Resend — no conectado (placeholder)
- SMS: Twilio — no conectado
- Hosting: Hostinger

## Fases del Proyecto
1. Booking widget con depósito (Square)
2. Panel admin (reservas, jobs, clientes)
3. App del técnico (mobile-optimized)
4. Invoicing y cobro del balance
5. SMS/Notificaciones automáticas
6. Adaptar para BlissClean (multi-tenant)

## Fase Actual
- FASE 0 — Setup ✅
- FASE 1 — Booking Widget ✅ completo, con cobro real vía Square
- FASE 2 — Panel Admin ✅ completo, conectado a Supabase real (ya no es memoria de sesión)
- FASE 3 — App del Técnico ✅ completo, login real por empleado, jobs asignados por `assigned_to`
- FASE 4 — Invoicing 🟡 parcial: invoices existen en el admin, pero el envío por email (Resend) es un placeholder ("coming soon")
- FASE 5 — SMS/Notificaciones ⬜ no iniciada
- FASE 6 — BlissClean multi-tenant ⬜ no iniciada

## Repositorio
- GitHub: `blisscleanga-svg/altalux-app` (rama `main`)
- Autenticación para push: Personal Access Token (no hay `gh` ni credencial guardada en el entorno de trabajo)

## booking/index.html — Booking Widget (Fase 1)
Widget de reserva público, un solo archivo HTML/CSS/JS vanilla, mobile-first.

**Flujo multi-step:** Service → Details → Schedule → Review & Pay

- **Service**: 3 categorías (Full Detail con paquetes Essential/Premium, Interior Only, Exterior Only), chips de vehículo con precio, add-ons organizados en 3 grupos (Interior, Machine Applied Wax con precio por tier de vehículo, Exterior), sidebar sticky con resumen en vivo (desktop).
- **Details**: datos del cliente (nombre, teléfono, email, dirección, vehículo) + checkboxes de notificaciones pre-marcados. Campo de dirección (`#c-address`) con autocompletado de Google Places (fallback a texto plano si Maps falla).
- **Schedule**: calendario inline (Lunes–Sábado, domingo deshabilitado), horarios 8am–4pm.
- **Review & Pay**: resumen completo, depósito 25% destacado en naranja, balance 75% en gris, política de cancelación, formulario de tarjeta con **Square Web Payments SDK** → tokeniza → Edge Function `square-payment` cobra el depósito → se guarda el booking en Supabase (`bookings`, incluyendo `square_payment_id`).

Todo el catálogo de precios (categorías/paquetes/vehículos) vive hardcodeado en el `<script>` de este archivo.

## admin/index.html — Panel Admin (Fase 2)
Un solo archivo HTML/CSS/JS vanilla. **Login real por empleado vía Supabase Auth** (`signInWithPassword`) — ya no hay password compartida hardcodeada ni cuenta maestra embebida en el código.

**Vistas (nav + sidebar):** Calendar, Jobs, Proposals, Customers, Payments.

- **Calendar**: mini-calendario + week view (Lun–Sáb) con chips de jobs coloreados por status, lista de jobs del día, lista de Events del día (bloqueos de calendario, no son jobs pagados).
- **Jobs**: tabla completa, status editable inline (Pending/Confirmed/In Progress/Completed), modal de detalle con historial de pagos.
- **Proposals**: cotizaciones previas a un job (Draft/Sent/Accepted/Declined), botón "Convert to Job" que crea un job real.
- **Customers**: derivados de los jobs + clientes standalone creados manualmente; perfil con tabs Overview/Job History y lifetime value. Modal "New Customer" con toggle Person/Business, múltiples direcciones/teléfonos/emails con label (Home/Work/Other), autocompletado de Google Places en direcciones (con fallback a texto plano si Maps falla — key restringida por dominio en Google Cloud). El perfil de cliente muestra estos datos en un bloque "Contact Info" dentro de Overview, separado de la pestaña "Addresses" (que es historial de direcciones de jobs, no datos de contacto). Columnas nuevas en `customers`: `customer_type`, `business_name`, `last_name`, `addresses`/`phones`/`emails` (jsonb) — las columnas viejas (`full_name`/`phone`/`email`/`address`) se mantienen por compatibilidad, siguen alimentando el resto de la app (Jobs/Payments/Invoices, todo sigue keyed por `email`).
- **Payments**: stats (Total Collected, This Month, This Week, Outstanding, Pending Deposits), filtros (fecha/status/cliente/método), tabla enriquecida, sistema de invoices (INV-00X, estados Draft/Sent/Paid/Overdue, tax toggle 6%, print/PDF), modal "Record Payment" con cobro real vía **Square Reader** (tarjeta presente) o **Square Link** (link de pago remoto), además de métodos manuales.
- **Empleados**: alta/gestión de empleados; crear login o resetear password pasa por la Edge Function `manage-employee-auth` (solo Owner, usa service role key server-side — el password nunca se guarda en una tabla legible por el cliente).
- **Botón flotante (FAB)**: centrado abajo, crea rápido: Quote/Job, Proposal, Event, Customer, Payment (con selector de job). El campo de dirección del modal "Quote/Job" (`#cj-address`) también tiene autocompletado de Google Places.
- **Realtime**: alertas en vivo de nuevos bookings entrantes.

**Backend real:** todo (jobs, payments, proposals, events, customers, employees) vive en Supabase — ya no es memoria de sesión.

## technician/index.html — App del Técnico (Fase 3)
App mobile-optimized para el equipo de campo.

- Login real por empleado (mismo modelo de Supabase Auth que admin).
- "Mis jobs de hoy" filtrado por la columna `assigned_to` en `jobs`.
- Registro de `start_time` / `end_time` al iniciar/terminar un job (sincronizado a Supabase).
- Alertas realtime de jobs asignados.

## Fixes recientes
- **2026-07-17:** 4 fixes reportados desde el uso real del dashboard (Edit Job):
  1. Google Maps autocomplete conectado a `#ej-address` (faltaba, mismo patrón que los demás campos de dirección).
  2. **Catálogo de precios dinámico**: `JOB_CATALOG`/`ADDONS_CATALOG` eran 100% hardcodeados en el código — nunca reflejaban cambios hechos en Settings > Servicios y Precios. Ahora se sobrescriben con los datos reales de `business_services`/`business_addons` al cargar el dashboard (`applyLiveCatalog()`), con fallback a los valores hardcodeados si Supabase no responde. Corrige Edit Job **y** el modal rápido "+ Job" del FAB (comparten el mismo catálogo).
  3. **Bug del checkbox "Override Price" que no se podía desmarcar**: causado por un listener global de `.role-radio-option` (pensado solo para los 4 radio-buttons de rol de empleado) que se aplicaba también a checkboxes sin relación por compartir la misma clase CSS — forzaba `checked=true` en cada click. Acotado a `[data-role]`. Efecto secundario positivo: también arregla el mismo bug latente en "Set as Default" (dirección/vehículo) del perfil de cliente.
  4. **Campos First Name / Last Name** en los 7 lugares donde antes había un solo campo "Name": `booking/index.html` (`c-firstname`/`c-lastname`), y en admin/technician — Edit Job, Quick Job, Create Proposal, Customer Profile, Edit Customer (technician), Add Customer (technician). Para datos existentes con un solo string, se divide con `splitFullName()` (primera palabra = nombre, resto = apellido); al guardar se reconstruye con `joinName()` — el resto de la app sigue usando el nombre combinado sin cambios. **Además**, Edit Job (admin), Customer Profile (admin) y Edit Customer (technician) ahora sí escriben el nombre/teléfono/email a la fila real de `customers` en Supabase vía `job.customerId` — antes esos 3 modales solo mutaban el job en memoria y el cambio se perdía al recargar la página (bug pre-existente, no introducido en esta sesión, corregido a pedido). El modal "Add Customer" de technician (`cf-*`) no se tocó en ese aspecto — nunca creó una fila real en Supabase, solo alimenta el caché local de perfiles.
  - Bug encontrado y corregido en el camino: el grid de 2 columnas de First/Last Name no colapsaba en móvil en 3 modales de admin (cj/cp/profile, usaban un grid inline sin breakpoint) y en los 2 modales de technician (donde se desbordaba fuera del viewport de 420px) — admin ahora reusa `.edit-job-section-grid` (ya tiene el breakpoint de 560px), technician los apila siempre (app 100% móvil).
- **2026-07-17:** Rediseño del invoice imprimible en admin (`admin/index.html`) — documento blanco profesional (logo a color, business info, Bill To / Service Details lado a lado, línea de método de pago) en vez del tema oscuro con overrides de impresión. Se quitó el checkbox "Apply Tax (6%)" (Georgia no cobra tax en detailing móvil) — Subtotal = Total ahora. "Mark as Sent" ahora escribe de verdad a `invoices.sent_at`/`status` en Supabase (con guardia `.is('sent_at', null)` contra doble-click) — antes solo mutaba estado en memoria. "Send Invoice" del visor de invoice ahora abre los modales reales que ya existían (`send-invoice-overlay` si el job no tiene pagos, `resend-receipt-overlay` si ya tiene alguno) en vez de un `alert()` placeholder. Bug encontrado y corregido en el camino: el `position:absolute` del contenedor de impresión estaba anidado dentro de `.modal-box`, lo que colapsaba su altura a la del padre en vez de la página completa — se ancló en `#invoice-modal-overlay` (hijo directo de body) en su lugar. Los 7 templates de email en `supabase/functions/send-email/index.ts` también se rediseñaron con el mismo sistema visual (tarjetas con acento lateral, media query mobile, Rajdhani/Inter) — desplegado con `supabase functions deploy send-email`.
- **2026-07-17:** Google Maps Places autocomplete extendido a `booking/index.html` (`#c-address`) y al modal "Quote/Job" de admin (`#cj-address`) — mismo patrón de fallback (`gm_authFailure`) que el modal de Customer. Reusa la misma key ya restringida a `app.altaluxdetail.com/*`, sin cambios necesarios en Google Cloud. Probado en vivo en `admin` (New Customer) tras habilitar "Places API" clásica en el proyecto de Google Cloud (estaba restringida en la key pero nunca habilitada a nivel de proyecto — dos pasos separados, causaba `LegacyApiNotActivatedMapError`).
- **2026-07-17:** Nuevo modal "New Customer" en `admin/index.html` (Person/Business, múltiples direcciones/teléfonos/emails, Google Places autocomplete). Migración `20260717180000_customers_extended.sql` aplicada. Google Maps API key restringida por HTTP referrer (`app.altaluxdetail.com/*`) y por API (solo Places + Maps JavaScript) en Google Cloud Console — hecho manualmente por Luis, yo no tengo acceso a esa consola. Nota: el happy-path del autocompletado (dropdown de sugerencias) no se pudo probar end-to-end en el sandbox de desarrollo porque la key rechaza el origen `file://` (`RefererNotAllowedMapError`, esperado) — sí se probó y confirmó el fallback (input vuelve a texto editable si Maps falla) y todo el resto del modal (toggle, filas múltiples, validación, guardado). Probado y confirmado funcionando en vivo en `app.altaluxdetail.com`.
- **2026-07-17:** `technician/index.html` — el panel de detalle de job (`#job-detail-screen`) se ocultaba con `transform:translateX(100%)`, relativo a su propio ancho (máx. 430px). En viewports más anchos que 430px (laptop/tablet) esto solo lo desplazaba 430px sin sacarlo de la pantalla, dejando un panel vacío visible junto al login. Corregido a `translateX(100vw)` (mueve el ancho completo del viewport, sin cambiar el comportamiento en móvil). Commit `b13d164`.

## Seguridad — cambios importantes (2026-07-10 y 2026-07-13)
- Se eliminó el modelo de contraseñas en texto plano (`employees.password`); cada empleado usa una cuenta real de Supabase Auth.
- Se eliminó la cuenta maestra de Supabase Auth que antes estaba embebida en el código fuente de `admin/index.html` (visible por "Ver código fuente", con acceso completo de lectura/escritura a la DB).
- Nueva Edge Function `manage-employee-auth` para crear/resetear logins sin exponer passwords al cliente.
- **2026-07-13:** typo de una letra en el Square Application ID (`z` minúscula en vez de `Z` mayúscula) causaba 401 Unauthorized y el formulario de pago de Square no cargaba en booking/admin/technician. Corregido (commit `e2f45b8`).

## Pendiente / Próximos pasos
- [ ] Envío real de invoices/confirmaciones por email (Resend) — hoy son placeholders "coming soon"
- [ ] Integración de Twilio (SMS/notificaciones automáticas — Fase 5)
- [ ] Fase 6: adaptar multi-tenant para BlissClean
- [ ] Confirmar que Hostinger sirve la última versión del sitio tras cada fix
- [ ] Mover el Personal Access Token de GitHub fuera de un archivo de texto plano
- [ ] El deploy a Hostinger sigue siendo manual vía zip (`C:\Users\ledua\OneDrive\Escritorio\Altaluxapp\altalux-hostinger-YYYY-MM-DD.zip`), no automático desde git — cada fix en el repo requiere generar y subir un zip nuevo aparte. Confirmado el 2026-07-17: el zip del 2026-07-15 estaba al día con el repo salvo por el fix de `job-detail-screen` de esa misma fecha (17).
- [ ] Se encontró `token subapse.txt` en texto plano en esa misma carpeta de OneDrive (`Altaluxapp/`) — mover/eliminar igual que el PAT de GitHub, no debería vivir como archivo de texto sin cifrar.
- [ ] Esa carpeta de OneDrive tiene varias copias de deploy (`altalux-deploy`, `altalux-deploy-2026-07-15`, `Nueva carpeta`) — vale la pena consolidar para no confundir cuál es la vigente.

## Estructura de Carpetas
```
altalux-app/
├── booking/index.html       # Widget de booking embebible
├── admin/index.html         # Panel de administración
├── technician/index.html    # App del técnico
├── supabase/
│   ├── migrations/          # employees.sql, employees_password.sql, e2e_fixes_2026_07_10.sql, ...
│   └── functions/
│       ├── square-payment/          # Cobro real vía Square Payments API
│       └── manage-employee-auth/    # Alta/reset de logins (solo Owner, service role)
└── CONTEXT.md                # Este archivo
```

## Servicios AltaLux (confirmar precios con Luis)
- Exterior Detail
- Full Detail
- Paint Correction
- Ceramic Coating

## Cuentas y Servicios
- **Square:** cuenta activa, credenciales de producción (Application ID, Location ID `LEWG2XNWRA7BS`). El access token vive como variable de entorno (`SQUARE_ACCESS_TOKEN`) en la Edge Function, nunca en el código.
- **Supabase:** proyecto activo (`xmhsehfdmiqbwhpqjgon`), Auth real por empleado, 2 Edge Functions en uso.
- **Resend:** cuenta por crear/conectar.
- **Twilio:** por integrar.
- **Hostinger:** activo — altaluxdetail.com.
- **GHL:** activo (toll-free +1 888-853-0590).

## Contacto / Owner
- Luis Pabón — Founder, BlissClean & AltaLux
- Equipo: Dario (técnico), Ami
- Sitio: altaluxdetail.com

## Identidad Visual AltaLux
- Azul principal: #104872
- Naranja: #FF8C00
- Dorado: #FFAA00
- Blanco: #FFFFFF
- Fondo oscuro UI: #0a1628
- Tipografía web: Rajdhani (títulos) + Inter (cuerpo)
- Logo archivo: /shared/assets/logo-altalux.png
