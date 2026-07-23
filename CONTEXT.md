# AltaLux App — Contexto del Proyecto
> Última actualización: 2026-07-22

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
- FASE 4 — Invoicing ✅ completo: invoices reales, envío por email (Resend) funcional (`invoice_link`, `payment_receipt`), trazabilidad completa de pagos (link abierto/iniciado/completado, tarjeta usada, notificación al admin) — corregida la línea de estado vieja de este archivo, que decía incorrectamente que el email era un placeholder (dejó de serlo desde el 2026-07-15, esto solo no se había actualizado acá)
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

- **Calendar**: mini-calendario + panel con 4 pestañas (Agenda/Week/Month/Day) + barra de navegación de periodo con ingresos y cantidad de jobs. Agenda agrupa jobs por día con ingresos diarios; Week es la grilla de slots (Lun–Sáb) con chips de jobs/eventos; Month muestra hasta 3 pills por día (puntos de color en móvil) y navega a Day al hacer click; Day es un timeline de una columna con los 6 slots fijos de horario. Los 4 KPI cards de arriba (Today's Revenue/This Week/Jobs Today/Pending) ahora sí se calculan en vivo (antes estaban hardcodeados en $0.00/0). Filtro por empleado (`#calendar-employee-filter`) aplica a las 4 vistas. El modal de detalle de job (admin y technician) tiene un panel "Share Payment Link" (Copy Link + Share vía Web Share API) que solo aparece si la invoice ya fue enviada (`job.invoice.publicToken` + `sentAt`).
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
- **2026-07-22:** Bug real encontrado por Luis en vivo inmediatamente después de subir el fix de recibos PDF: el botón "Download Receipt" daba `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` en vez de descargar el PDF. Causa: los botones nuevos usaban `window.open(generate-receipt-pdf?token=...)` — Supabase exige un header `Authorization` con un JWT válido a nivel de gateway **antes** de que el código de la Edge Function corra, y una navegación de navegador normal (`window.open`/`<a href>`) nunca manda ese header, solo `fetch()` puede fijarlo a mano. El caso de `paymentId` (pagos en efectivo) ya usaba `fetch()` + blob + descarga por su propia cuenta de auth y funcionaba bien; se unificó el caso de `token` al mismo patrón en `admin/index.html` y `pay/index.html`. Confirmado el diagnóstico reproduciendo el error exacto sin header, y confirmado el fix con header vía `curl` antes de desplegar.
- **2026-07-22:** **Recibos PDF reales + invoices versionadas + UI colapsable** (extensión del Payment Tracking del mismo día, a pedido de Luis tras revisar el feature en vivo). Tres piezas:
  1. **Invoices versionadas:** `sendPayableInvoice()` en `admin/index.html` ya no reusa/sobreescribe una sola fila de `invoices` por job — ahora cada envío (Send Invoice / Send Payable Invoice) crea una fila nueva, con su propio monto/token/fecha. Antes, reenviar una solicitud con un monto distinto perdía el detalle del envío anterior para siempre. `job.invoiceHistory` (array, todas las solicitudes del job) reemplaza el viejo patrón de sobrescribir `job.invoice` en cada fila cargada; `job.invoice` sigue existiendo como alias de la más reciente para no romper el resto del código. No requirió migración — todas las columnas ya existían.
  2. **Recibos PDF reales** — nueva Edge Function `generate-receipt-pdf`, usa `pdf-lib` vía `esm.sh` (JS puro, sin dependencias nativas — no hay forma de correr un navegador headless dentro de una Edge Function). Antes, "Download as PDF"/"Download Receipt" en todo el sitio eran literalmente `window.print()`, nunca un archivo real. Dos modos: `token` (invoice real, público, mismo modelo que `pay/index.html`) o `paymentId` (pago suelto de Cash/Zelle/Square Reader sin invoice asociada — requiere JWT de empleado activo, validado contra `employees`). El layout replica `invoiceBizInfo()`/`renderInvoiceLineItems()`/`renderInvoiceTotals()` de `admin/index.html`, reimplementado en Deno porque esas funciones manipulan el DOM directamente. Botón "📄 Download Receipt"/"📄" agregado en 3 lugares: Link Activity del modal del job, Payment History del modal del job (por pago suelto), y Job History del perfil del cliente. `pay/index.html` también se actualizó para usar el PDF real en vez de `window.print()`.
  3. **PDF adjunto en el email de notificación al admin** — `square-payment` ahora llama a `generate-receipt-pdf?format=base64` antes de notificar al admin, y `send-email`/`sendViaResend()` pasa el resultado como `attachments` a la API de Resend (antes solo mandaba `from/to/subject/html`, sin soporte de adjuntos). Si la generación del PDF falla, el email se manda igual sin adjunto — nunca bloquea la notificación.
  4. **UI colapsable para el timeline de Link Activity** — con 3+ intentos de pago fallidos la lista se volvía interminable (reportado por Luis con captura real: 3 pares started/failed = 6 líneas sueltas). Nuevo componente reusable `collapsibleGroupHtml()`/`.collapse-group` (mismo patrón visual que el toggle del mini-calendario — chevron que rota 90°), usado en dos niveles: un grupo colapsable por invoice (si el job tiene varias), y dentro de cada una, cada par `payment_started`+`payment_failed` consecutivo se colapsa en 1 línea "❌ Failed attempt" expandible (en vez de 2 líneas sueltas). De paso se corrigió un bug visible en la misma captura: cada apertura del link generaba una línea nueva repitiendo el mismo contador acumulado ("Link opened ×2" duplicado dos veces) — ahora se funde en una sola línea.
  - **Verificado en producción real, sin gastar dinero:** `generate-receipt-pdf` desplegada y probada contra el invoice real de Luis ($1, DISCOVER ****2201) — el PDF generado se revisó visualmente, datos correctos. Modo `paymentId` confirmado que rechaza con 401 sin un JWT de empleado válido. Email `payment_notification_admin` con el PDF adjunto probado de extremo a extremo vía Resend (id de mensaje real devuelto). El agrupamiento de intentos fallidos se verificó manualmente contra los eventos reales que Luis ya había generado en su prueba en vivo (2 link_opened, 3 pares started/failed, 1 completed — exactamente el escenario de su captura) — no se pudo verificar visualmente en el navegador desde este sandbox (mismo límite ya conocido), pendiente que Luis lo confirme.
- **2026-07-22:** **Payment Tracking — trazabilidad completa de pagos en tiempo real.** Antes no había forma de saber si un cliente abrió el link de pago, con qué tarjeta pagó, ni cuándo. Nueva tabla `payment_events` (migración `20260722190000_payment_tracking.sql`, con Realtime habilitado vía `ALTER PUBLICATION supabase_realtime`) registra 4 tipos de evento: `link_opened`, `payment_started`, `payment_completed`, `payment_failed`. Columnas nuevas en `invoices`: `link_opened_at`, `link_open_count`, `payment_started_at`, `card_brand`, `card_last4`, `square_payment_id`. Nueva Edge Function pública `track-payment-event` (valida por `public_token`, rate-limited, nunca revela si un token existe o no). `square-payment` ahora captura marca/últimos 4 dígitos de la tarjeta desde la respuesta de Square (API REST directa → campos snake_case, no el SDK), inserta el evento `payment_completed`, y dispara un email nuevo (`payment_notification_admin` en `send-email`) a `business_settings.notification_email`. `pay/index.html` registra `link_opened` al cargar la factura y `payment_started`/`payment_failed` alrededor del cobro (fire-and-forget, nunca bloquea el pago). `admin/index.html`: nueva sección "Link Activity" en el modal de detalle del job (deliberadamente separada de la sección "Payment History" ya existente, que muestra pagos cobrados, no interacción con el link — mismo modal, dos cosas distintas), indicador de apertura del link junto a "Share Payment Link", y suscripción Realtime (`db.channel`, mismo patrón que ya usaba `bookings`) con toasts en vivo cuando el cliente abre el link o completa el pago.
  - **Hallazgos durante el análisis previo (STEP 0) que corrigieron el plan original:** no existe una tabla `businesses` en este proyecto — `business_id` es `text` en todas las tablas, no uuid con FK a una tabla separada. `square-payment` llama a Square vía REST directo, no el SDK Node — los campos de la respuesta son snake_case (`card_details.card.card_brand`, `last_4`), no camelCase. El SELECT de invoice en `square-payment` no traía `job_id` (se agregó). El id de job usado en el modal de admin (`currentModalJobId`) es un índice local secuencial, no el UUID real de Supabase — hay que usar `job.supabaseId` para cualquier query real. `notification_email` en `business_settings` ya existía desde Fase A (no hacía falta agregarla), pero **estaba vacía en producción** — como efecto colateral, esto significa que el email `internal_notification` (alerta de booking nuevo) probablemente nunca llegó a nadie desde que existe. Se configuró `notification_email = 'altaluxdetail@gmail.com'` (la cuenta real del panel admin) — corrige ambos emails (booking nuevo y pago recibido) a la vez.
  - **Verificado en producción real** (sin gastar dinero ni tocar invoices reales de clientes): `track-payment-event` probado contra un invoice real sin pagar (`link_open_count` subió a 1, `link_opened_at` se seteó, fila real en `payment_events`); `payment_notification_admin` probado con un envío real vía `send-email` (Resend devolvió `id` de mensaje real); un evento `payment_completed` de prueba insertado directo por SQL confirmó que el schema/FKs/CHECK constraint son válidos. Todos los datos de prueba se limpiaron después (`DELETE` del evento, reset de `link_open_count`/`link_opened_at`). **Pendiente real de verificar:** el toast en vivo y el timeline "Link Activity" del modal necesitan una sesión real de admin autenticada — no se pudo probar visualmente desde este sandbox (mismo límite que ya aplicaba a otras features).
  - **Fix de seguimiento el mismo día:** Luis probó el feature en vivo enviando un invoice real de $1 (Job #2, reusando el mismo job de prueba histórico) — el registro sí llegó a Supabase correctamente (confirmado: `sent_at`, `link_opened_at` 20 segundos después, `link_open_count: 1` — el pipeline de tracking funcionó de punta a punta en producción), pero **no se veía el monto en ningún lado de la UI** — ni en "Link Activity" del modal del job, ni en el perfil del cliente (no existía ninguna vista de "solicitudes de invoice enviadas" ahí). Causa: `job.invoice` (el objeto local que arma `loadAllDataFromSupabase()`) nunca guardaba `final_amount`/`title`/`comment` de la fila real de `invoices` — solo status/fechas/token. Corregido: se agregaron esos 3 campos al mapeo, la línea "Invoice sent" de "Link Activity" ahora muestra el monto (`Invoice sent — $1.00`), y se agregó una línea nueva a cada entrada de "Job History" en el perfil del cliente (`buildJobHistoryEntryHtml`) mostrando la solicitud de invoice enviada con su monto y fecha, independientemente de si ya se pagó o no — antes esa vista solo mostraba pagos ya cobrados y el balance pendiente, nunca el evento de "se envió una solicitud por $X".
  - Deploy: migración aplicada con `supabase db push` **antes** de desplegar las Edge Functions (si se hiciera al revés, el primer pago real fallaría con 500 aunque Square ya hubiera cobrado). Las 3 funciones (`track-payment-event`, `square-payment`, `send-email`) desplegadas con `--use-api`. Type-checkeado con `deno check` antes de desplegar — encontró y corrigió un error real (un join anidado `customers(full_name)` se infería como array sin schema generado; se separó en dos queries).
- **2026-07-22:** Auditoría de sincronización repo/GitHub/Hostinger a pedido de Luis, sin cambios de código. Verificado byte a byte que `altalux-hostinger-2026-07-18.zip` (en la carpeta de OneDrive) coincide exactamente con el working tree local en el commit `d59fd53` (los 8 archivos del zip son idénticos al repo) — si ese zip ya se subió a Hostinger, producción está al día. `git fetch origin main` confirmó que `origin/main` también está en `d59fd53`: los 32 commits que un `git status` sin fetch previo mostraba como "ahead of origin/main" ya estaban pusheados, esa referencia local simplemente estaba obsoleta por falta de fetch en la sesión anterior — no había nada pendiente de push.
- **2026-07-18:** El mini-calendario mensual de la vista Calendar (arriba del panel Agenda/Week/Month/Day) ahora arranca colapsado por defecto, en escritorio y móvil — reportado por Luis tras subir el rediseño de Calendar ("aun esta ese calendario grande ahi ocupando todo el espacio"). Se colapsa a una sola fila delgada con el mes/año y una flecha (▸/▾) que lo expande/oculta con un click; al expandirlo reaparecen las flechas de mes anterior/siguiente. No cambia su lógica interna (sigue siendo el mismo `renderMiniCalendar()`), solo el estado de visibilidad inicial y un toggle nuevo.
- **2026-07-18:** Bug real encontrado en producción: dos jobs distintos con el mismo `job_number = 4`. Causa raíz: `admin/index.html` mandaba explícitamente `job_number: job.jobNumber` en los 2 únicos inserts a `jobs` (Quick Job del FAB y "Convert to Job" de Proposals), calculado con un contador en memoria (`nextJobNumCounter`) que arrancaba hardcodeado en `4` y nunca se resincronizaba con lo que ya existía en Supabase tras cargar datos reales — cada sesión nueva volvía a ofrecer "004" como si fuera el primer job. La columna `jobs.job_number` ya tenía su propio default de sequence (`nextval('jobs_job_number_seq')`) pero mandarlo explícitamente lo pisaba, y no había ninguna restricción `UNIQUE` que lo impidiera. Fix: los 2 inserts ya no mandan `job_number` (lo asigna la DB), y el número real vuelto por el insert se sincroniza de vuelta a `job.jobNumber` local (antes el UI mostraba el número optimista para siempre, incluso después de que la DB asignara otro). De paso se corrigió que los jobs cargados desde Supabase mostraban `job_number` sin cero-relleno (ej. "JOB #4" en vez de "JOB #004", inconsistente con los jobs creados en la misma sesión). Migración `20260718150000_fix_duplicate_job_number.sql`: renumeró el job duplicado más reciente (sin invoice enviada todavía) y agregó `UNIQUE (job_number)` sobre `jobs` como salvaguarda para que este bug no pueda repetirse silenciosamente — confirmado en vivo con consulta directa a la DB antes y después.
- **2026-07-18:** Rediseño de Calendar en admin — pasa de mini-calendario + week-grid fijo + 2 listas (jobs/events del día) a un panel con 4 pestañas Agenda/Week/Month/Day + barra de navegación de periodo (ingresos + cantidad de jobs, ±7 días para Agenda/Week, ±1 mes para Month, ±1 día para Day). Las 3 funciones viejas (`renderWeekView`/`renderJobsListForDay`/`renderEventsListForDay`) se dejaron como wrappers de compatibilidad hacia el nuevo `renderCalendarViews()` — evita tener que tocar ~20 puntos del código que ya las llamaban tras crear/editar jobs, proposals o events. Se aprovechó el cambio para conectar los 4 KPI cards de arriba (Today's Revenue/This Week/Jobs Today/Pending), que estaban muertos desde siempre (hardcodeados en $0.00/0). Se agregó el panel "Share Payment Link" (Copy Link + Web Share API) al modal de detalle de job en admin y technician, visible solo si la invoice ya se envió — technician no cargaba `job.invoice` en absoluto hasta este fix (solo lo llenaba en memoria si el envío pasaba por esa misma sesión), ahora también trae las invoices reales desde Supabase al cargar los jobs de la semana.
- **2026-07-18:** Events ahora soporta rangos de fecha/hora y "All Day" (migración `20260718140000_events_date_range.sql`, columnas `end_date`/`end_time`/`all_day`). Sirve para bloquear el calendario varios días seguidos (vacaciones, días libres) o un rango de horas dentro de un día (mantenimiento de equipo). `eventCoversDay()`/`eventCoversSlot()` reemplazan el match exacto de un solo día/slot — probado con 22 casos (todo-el-día, rango en un día, rango multi-día con horas específicas, y compatibilidad con eventos viejos de un solo slot).
- **2026-07-18:** Auditoría completa de "¿qué botón realmente escribe a Supabase?" a pedido de Luis. Encontrado y corregido:
  - `updateJobStatus()` (usada por el selector de status, "Mark Completed", acciones rápidas de Calendar) solo mutaba memoria — ningún cambio de status sobrevivía un reload. Confirmado en vivo con consulta directa a la DB tras el fix.
  - **Proposals y Events no tenían tabla en Supabase** — vivían 100% en arrays de JS (`PROPOSALS`/`EVENTS`), se perdían al recargar. Migración `20260718120000_proposals_events_tables.sql` crea ambas tablas (mismo patrón de RLS que `jobs`). Confirmado en vivo con consulta directa a la DB.
  - Settings > Servicios y Precios solo dejaba editar precio y activo — la columna `description` de `business_services` nunca se exponía en la UI. Ahora hay un textarea editable por fila.
  - Direcciones/vehículos del perfil de cliente (`CUSTOMER_PROFILES`, sistema separado derivado del historial de jobs) nunca escribían a Supabase. Direcciones ahora sincronizan al jsonb `customers.addresses`; vehículos usan la tabla `vehicles` (existía pero nunca se usaba) con insert/update/delete real vía `customer_id` (resuelto por email).
- **2026-07-18:** Bug real encontrado en el catálogo dinámico de precios (del fix de ayer): `business_services.package` para las categorías Interior/Exterior tiene el MISMO valor que `category` (ej. `'interior'`), no `NULL` como se asumió — por eso esas dos categorías nunca actualizaban precios (Full Detail sí, porque ahí `package` sí es real: 'essential'/'premium'). Confirmado en vivo (Exterior mostraba $159.99 hardcodeado vs $169.99 real) antes y después del fix. De paso: `job.invoice.number` guardaba el entero crudo de invoice_number en vez de "INV-2026-0004" al cargar desde Supabase (afectaba Resend Receipt y emails de confirmación/recordatorio) — corregido. Emails: agregada protección contra dark mode de Apple Mail/iPhone (invertía colores sin `color-scheme: light`).
- **2026-07-18:** Edit Job tampoco escribía fecha/status/precio/categoría/notas a la fila real de `jobs` en Supabase (solo lo hacía para nombre/teléfono/email, arreglado el 17) — reportado por Luis como "cambio la fecha de un job y no se guarda". Ahora persiste todo eso también. Pendiente conocido: vehículo/tipo de vehículo (tabla relacional `job_vehicles`/`vehicles`) y add-ons (`job_addons`) todavía no sincronizan desde este modal — se dejó fuera a propósito para no arriesgar una reescritura relacional apurada.
- **2026-07-18:** Bug real encontrado (reportado como "el invoice por correo dice que el link expiró"): `job.invoice.publicToken` nunca se cargaba desde Supabase (solo id/sentAt), y el routing de "Send Invoice" del visor decidía ir a "Resend Receipt" con solo mirar si el job tenía algún pago — pero el depósito del booking se cobra directo con Square y nunca crea una fila en `invoices`. Un job con solo depósito mandaba a Resend Receipt, que armaba el link con `token=null`. Corregido: se captura `public_token` al cargar, y el routing ahora exige que ya exista un invoice real enviado (`job.invoice.publicToken`) antes de ofrecer Resend Receipt.
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
├── pay/index.html           # Página pública de pago de invoices (?token=)
├── supabase/
│   ├── migrations/          # ver supabase/migrations/ — timestamped desde 2026-07-17
│   └── functions/
│       ├── square-payment/          # Cobro real vía Square Payments API + refunds del flujo de invoice
│       ├── square-refund/           # Reembolsos reales vía Square Refunds API
│       ├── send-email/              # Resend — 8 tipos de email (ver Cuentas y Servicios)
│       ├── track-payment-event/     # NUEVO (2026-07-22) — pública, registra link_opened/payment_started/payment_failed
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
