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
FASE 0 — Setup completo ✅ → Iniciando FASE 1: Booking Widget

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