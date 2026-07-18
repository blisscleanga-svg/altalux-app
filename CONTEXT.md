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
- **Details**: datos del cliente (nombre, teléfono, email, dirección, vehículo) + checkboxes de notificaciones pre-marcados.
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
- **Botón flotante (FAB)**: centrado abajo, crea rápido: Quote/Job, Proposal, Event, Customer, Payment (con selector de job).
- **Realtime**: alertas en vivo de nuevos bookings entrantes.

**Backend real:** todo (jobs, payments, proposals, events, customers, employees) vive en Supabase — ya no es memoria de sesión.

## technician/index.html — App del Técnico (Fase 3)
App mobile-optimized para el equipo de campo.

- Login real por empleado (mismo modelo de Supabase Auth que admin).
- "Mis jobs de hoy" filtrado por la columna `assigned_to` en `jobs`.
- Registro de `start_time` / `end_time` al iniciar/terminar un job (sincronizado a Supabase).
- Alertas realtime de jobs asignados.

## Fixes recientes
- **2026-07-17:** Nuevo modal "New Customer" en `admin/index.html` (Person/Business, múltiples direcciones/teléfonos/emails, Google Places autocomplete). Migración `20260717180000_customers_extended.sql` aplicada. Google Maps API key restringida por HTTP referrer (`app.altaluxdetail.com/*`) y por API (solo Places + Maps JavaScript) en Google Cloud Console — hecho manualmente por Luis, yo no tengo acceso a esa consola. Nota: el happy-path del autocompletado (dropdown de sugerencias) no se pudo probar end-to-end en el sandbox de desarrollo porque la key rechaza el origen `file://` (`RefererNotAllowedMapError`, esperado) — sí se probó y confirmó el fallback (input vuelve a texto editable si Maps falla) y todo el resto del modal (toggle, filas múltiples, validación, guardado). Probar el autocomplete real una vez desplegado en `app.altaluxdetail.com`.
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
