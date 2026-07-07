# AltaLux App — Contexto del Proyecto

## ¿Qué es esto?
App de field service para AltaLux Mobile Detail (Roswell, GA).
Replica funcionalidad core de Urable pero custom, sin mensualidad.
Eventualmente se adaptará también para BlissClean Mobile Detail.

## Marcas
- **AltaLux Mobile Detail** — Roswell, GA (marca principal de este repo)
- **BlissClean Mobile Detail** — Dunwoody, GA (se integrará en Fase 6)

## Stack
- Frontend: HTML/CSS/JS vanilla (sin frameworks)
- Base de datos: Supabase (PostgreSQL)
- Pagos: Stripe Checkout
- Emails: Resend
- SMS: Twilio
- Hosting: Hostinger

## Fases del Proyecto
1. Booking widget con depósito (Stripe)
2. Panel admin (reservas, jobs, clientes)
3. App del técnico (mobile-optimized)
4. Invoicing y cobro del balance
5. SMS/Notificaciones automáticas
6. Adaptar para BlissClean (multi-tenant)

## Fase Actual
FASE 0 — Setup completo ✅
FASE 1 — Booking Widget ✅ (completo, ver detalle abajo)
FASE 2 — Panel Admin ✅ (completo, ver detalle abajo)
Próximo: conectar Supabase real (todo hoy es data en memoria de sesión, se pierde al recargar) + Stripe real + Fase 3 (app técnico)

## Repositorio
- GitHub: `blisscleanga-svg/altalux-app` (rama `main`)
- Autenticación para push: se usa un Personal Access Token pegado manualmente en el chat cuando se necesita (no hay `gh` ni credencial guardada en este entorno). El entorno de trabajo es un sandbox Linux remoto, **no** la PC del usuario — los archivos creados aquí no aparecen automáticamente en `C:\Users\...`; hay que hacer `git pull`/clonar desde la PC local, o descargar el archivo.

## booking/index.html — Booking Widget (Fase 1)
Widget de reserva público, un solo archivo HTML/CSS/JS vanilla, mobile-first.

**Flujo multi-step:** Service → Details → Schedule → Review & Pay

- **Service**: 3 categorías (Full Detail con paquetes Essential/Premium, Interior Only, Exterior Only), chips de vehículo con precio, add-ons organizados en 3 grupos (Interior, Machine Applied Wax con precio por tier de vehículo, Exterior), sidebar sticky con resumen en vivo (desktop).
- **Details**: datos del cliente (nombre, teléfono, email, dirección, vehículo) + checkboxes de notificaciones pre-marcados.
- **Schedule**: calendario inline (Lunes–Sábado, domingo deshabilitado), horarios 8am–4pm.
- **Review & Pay**: resumen completo, depósito 25% destacado en naranja, balance 75% en gris, política de cancelación, botón "Pay Deposit" (alert placeholder — Stripe real pendiente).

Todo el catálogo de precios (categorías/paquetes/vehículos) vive hardcodeado en el `<script>` de este archivo.

## admin/index.html — Panel Admin (Fase 2)
Dashboard protegido por password (`altalux2026`, hardcodeada — cambiar antes de producción). Un solo archivo HTML/CSS/JS vanilla.

**Vistas (nav + sidebar):** Calendar, Jobs, Proposals, Customers, Payments.

- **Calendar**: mini-calendario + week view (Lun–Sáb) con chips de jobs coloreados por status, lista de jobs del día, lista de Events del día (bloqueos de calendario, no son jobs pagados).
- **Jobs**: tabla completa, status editable inline (Pending/Confirmed/In Progress/Completed), modal de detalle con historial de pagos.
- **Proposals**: cotizaciones previas a un job (Draft/Sent/Accepted/Declined), botón "Convert to Job" que crea un job real.
- **Customers**: derivados de los jobs + clientes standalone creados manualmente; perfil con tabs Overview/Job History y lifetime value.
- **Payments**: stats (Total Collected, This Month, This Week, Outstanding, Pending Deposits), filtros (fecha/status/cliente/método), tabla enriquecida, sistema de invoices (INV-00X, estados Draft/Sent/Paid/Overdue, tax toggle 6%, print/PDF), modal "Record Payment" (deposit/balance/full/custom).
- **Botón flotante (FAB)**: centrado abajo, crea rápido: Quote/Job, Proposal, Event, Customer, Payment (con selector de job).

**Datos de muestra:** 3 jobs precargados (John Smith, Maria Garcia, David Johnson) con pagos e invoices consistentes con el catálogo de precios del booking widget.

**Importante:** todo el estado (jobs, payments, proposals, events, customers) es **solo en memoria de sesión** — no hay backend ni persistencia real todavía. Al recargar la página se resetea a los 3 jobs de muestra.

## Pendiente / Próximos pasos
- [ ] Conectar Supabase (DB real, reemplazar arrays en memoria)
- [ ] Integración real de Stripe (booking widget + admin)
- [ ] Integración real de Resend (envío de invoices/confirmaciones)
- [ ] Cambiar password hardcodeada del admin por auth real
- [ ] Fase 3: app del técnico
- [ ] Fase 6: adaptar multi-tenant para BlissClean

## Stack Técnico
- Sin frameworks pesados — vanilla JS para máxima velocidad
- Supabase como backend completo (DB + Auth + Edge Functions)
- Stripe Checkout hosted — sin manejar datos de tarjeta directamente
- Multi-tenant desde el inicio — diseñar pensando en dos marcas

## Estructura de Carpetas
altalux-app/
├── booking/        # Widget de booking embebible
├── admin/          # Panel de administración
├── technician/     # App del técnico
├── shared/         # CSS, JS, componentes compartidos
├── supabase/       # Migrations, edge functions
└── CONTEXT.md      # Este archivo

## Servicios AltaLux (confirmar precios con Luis)
- Exterior Detail
- Full Detail
- Paint Correction
- Ceramic Coating

## Credenciales / Cuentas Necesarias
- [ ] Stripe account para AltaLux
- [ ] Supabase project creado
- [ ] Resend account

## Contacto / Owner
- Luis Pabón — Founder, BlissClean & AltaLux
- Equipo: Dario (técnico), Ami
- Teléfono AltaLux: por confirmar
- Sitio: altaluxdetail.com

## Identidad Visual AltaLux
- Azul principal: #104872
- Naranja: #FF8C00
- Dorado: #FFAA00
- Blanco: #FFFFFF
- Fondo oscuro UI: #0a1628
- Tipografía web: Rajdhani (títulos) + Inter (cuerpo)
- Logo archivo: /shared/assets/logo-altalux.png