# Separación AltaLux ↔ Plataforma SaaS (altalux.io) — Diseño

> Fecha: 2026-08-09
> Estado: aprobado por Luis, listo para plan de implementación

## Contexto

`altalux-app` ya evolucionó de ser el sitio de un solo negocio (AltaLux Mobile Detail)
a tener toda la base de un producto SaaS multi-tenant: wizard de onboarding
(`onboarding/index.html`), panel de Super Admin (`platform/index.html`), Edge
Function `manage-tenant`, RLS por `business_id` en todas las tablas (con el
trigger de `20260808200000_fix_business_id_default_trigger.sql` recién
corregido). Pero AltaLux mismo sigue siendo el tenant "por defecto" hardcodeado
en el código (`FALLBACK_SETTINGS` de `shared/config.js`, dominio
`altaluxdetail.com` mapeado directo, `DEFAULT 'altalux'` en varias columnas) —
no es un negocio más del sistema, es el cimiento.

Luis ya tiene un Hostinger nuevo y el dominio `altalux.io` reservados para
lanzar la plataforma SaaS como su propio producto, sin tocar la operación real
de AltaLux mientras el producto nuevo evoluciona.

## Objetivo

Clonar toda la infraestructura (código + esquema de base de datos) a un stack
completamente independiente que sirva `altalux.io`, dejando `altalux-app` /
`altaluxdetail.com` funcionando exactamente igual que hoy, sin ningún cambio.
Terminar con una prueba end-to-end completa del flujo SaaS sobre el stack
nuevo.

## Decisiones de arquitectura

| | AltaLux (actual — sin tocar) | altalux.io (SaaS — nuevo) |
|---|---|---|
| Repo GitHub | `blisscleanga-svg/altalux-app` | `blisscleanga-svg/altalux-saas` (fork del actual) |
| Supabase | proyecto `xmhsehfdmiqbwhpqjgon` (real, con datos reales) | proyecto Supabase nuevo, vacío de datos reales |
| Dominio | `altaluxdetail.com` | `altalux.io` |
| Hosting | Hostinger actual | Hostinger nuevo |
| Resend (emails) | cuenta actual | cuenta nueva, separada |
| Square | cuenta real de producción | mismas credenciales da igual — el payment guard bloquea a todos (ver más abajo), no hay cobro real posible |
| Datos día 1 | los reales de producción, sin cambios | 1 cuenta Super Admin (Luis) + 1 tenant demo (no AltaLux) sembrado con catálogo de ejemplo |

Los dos stacks no comparten nada en producción: ni base de datos, ni repo, ni
dominio, ni cuenta de email transaccional. Un fix genérico (ej. un bug de UI
que aplica a cualquier tenant) se porta a mano de un repo al otro si se
decide que aplica — no hay sincronización automática.

## Alcance

**Incluido:**
1. Provisionar el proyecto Supabase nuevo y aplicar el esquema completo (ver
   sección de migraciones).
2. Crear el repo `altalux-saas` como fork del código actual.
3. Genericizar el código clonado (ver sección siguiente) — ya no debe quedar
   ninguna referencia a la marca/datos reales de AltaLux como valor por
   defecto.
4. Desplegar las 7 Edge Functions al proyecto nuevo con sus propios secrets.
5. Sembrar la cuenta de Super Admin y un tenant demo (no AltaLux) en el
   proyecto nuevo.
6. Configurar el deploy a Hostinger nuevo / dominio `altalux.io`.
7. Prueba end-to-end completa del flujo SaaS al final (ver sección de
   testing).

**Fuera de alcance (explícito):**
- Square OAuth real por-tenant (cobros reales para negocios que no sean
  AltaLux) — ya estaba marcado como fase futura en `CONTEXT.md`, sigue
  siéndolo.
- Cualquier cambio de código, datos, o infraestructura de
  `altalux-app`/`altaluxdetail.com`.
- Mecanismo de sincronización automática entre los dos repos/backends.
- Migrar al tenant real de AltaLux hacia la plataforma SaaS (AltaLux sigue
  siendo un sitio aparte, no un tenant de altalux.io).

## Componentes y cambios

### 1. Payment guard — sin cambio de código necesario

`square-payment/index.ts` rechaza con 403 (`TenantGuardError`) cualquier
cobro donde `business_id !== 'altalux'`, en sus 3 rutas (job real vía
`job_number`, depósito de booking vía `body.businessId`, invoice/pay-link vía
`invoice.business_id`). Como el proyecto Supabase nuevo nunca va a tener una
fila con `business_id = 'altalux'`, este guard bloquea automáticamente a
**cualquier** tenant del stack nuevo, incluido el demo — coincide
exactamente con la decisión de "nadie cobra real todavía" sin tocar el
código del guard.

### 2. Genericización de `shared/config.js`

- `FALLBACK_SETTINGS` (hoy los datos reales de AltaLux: nombre, teléfono,
  colores, credenciales de Square) se reemplaza por los datos del tenant
  demo — este fallback solo se usa si Supabase no responde, pero como el
  tenant demo va a ser lo que la gente vea al probar/mostrar el producto, no
  debe aparecer la marca de otro negocio ahí.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` apuntan al proyecto nuevo.
- El mapa de dominios (`detectBusinessId()`) se simplifica: ya no hace falta
  el caso especial de `altaluxdetail.com`/`blisscleandetail.com`; `altalux.io`
  sirve cualquier tenant vía `?b=<slug>`, con el tenant demo como default de
  desarrollo/localhost.
- Revisar `booking/index.html`, `admin/index.html`, `technician/index.html`
  por cualquier texto o link fijo (ej. `altaluxdetail.com`) que haya quedado
  hardcodeado fuera de `shared/config.js`.

### 3. Migraciones — riesgo identificado

De los 19 archivos en `supabase/migrations/`, 12 no siguen el patrón
`<YYYYMMDDHHMMSS>_descripcion.sql` que exige el Supabase CLI (`e2e_fixes_*`,
`employees.sql`, `phase_a_*.sql`, `phase_b_invoicing.sql`,
`security_*_audit_part2.sql`, `invoice_public_token.sql`). Como ya se sabía
por experiencia previa en este proyecto, `supabase db push` **ignora
silenciosamente** cualquier migración que no matchee ese patrón. El proyecto
actual llegó a su estado real por aplicación manual histórica de esos 12
archivos, no por `db push` — así que correr `db push` tal cual contra el
proyecto nuevo dejaría el esquema incompleto sin ningún error visible.

**Enfoque:** reconstruir el orden cronológico real de los 19 archivos (por
historial de git — fecha de creación de cada archivo — no orden alfabético,
que no garantiza respetar dependencias entre tablas) y aplicarlos a mano en
ese orden contra el proyecto nuevo, **salteando `phase_a_seed_altalux.sql`**
(es seed data real de AltaLux — nombre, teléfono, catálogo de precios reales,
credenciales de Square — no pertenece al clon). El detalle de comandos queda
para el plan de implementación.

### 4. Edge Functions y secrets

Las 7 Edge Functions (`manage-tenant`, `manage-employee-auth`,
`square-payment`, `square-refund`, `send-email`, `track-payment-event`,
`generate-receipt-pdf`) se despliegan al proyecto nuevo con:
- Su propia `SUPABASE_SERVICE_ROLE_KEY` (la del proyecto nuevo).
- `RESEND_API_KEY` de la cuenta de Resend nueva y separada.
- `SQUARE_ACCESS_TOKEN`: puede ser el mismo valor que ya existe como
  variable de entorno — es irrelevante para el resultado porque el guard del
  punto 1 bloquea cualquier cobro real de todas formas.

Type-check con `deno check` antes de desplegar, mismo patrón ya usado en este
proyecto.

### 5. Datos semilla del proyecto nuevo

- 1 cuenta de Supabase Auth + fila en `employees` con rol Super Admin (mismo
  email que ya usa Luis: `blisscleanmobilega@gmail.com`), vía el mismo
  mecanismo que `manage-tenant`/`approve_tenant` ya usa para crear el primer
  Owner de un tenant.
- 1 tenant demo (negocio ficticio, no AltaLux) aprobado con estado
  `approved`, catálogo de servicios/add-ons de ejemplo (puede reusar los
  `service_templates`/`addon_templates` ya sembrados por
  `20260805190000_onboarding_system.sql`, que no son específicos de
  AltaLux).

### 6. Deploy a Hostinger

Mismo patrón zip ya usado para AltaLux (ver memoria del proyecto), apuntando
al Hostinger nuevo. El set de archivos del zip se amplía respecto al de
AltaLux: además de `admin/`, `booking/`, `pay/`, `shared/`, `technician/`,
`brand/`, ahora también incluye `onboarding/` y `platform/` (hoy no viajan en
el zip de AltaLux porque no hacen falta ahí).

## Plan de testing (todo al final, sobre altalux.io real)

Con navegador headless real (mismo patrón que ya se usa en este proyecto —
`headless-browser-sandbox`), contra el stack nuevo desplegado y en vivo:

1. Wizard de onboarding completo (`onboarding/index.html`) dando de alta un
   tenant de prueba adicional (distinto del demo sembrado) — confirma que
   cualquier negocio nuevo puede aplicar de verdad.
2. Login de Super Admin en `platform/index.html`, aprobación del tenant de
   prueba, verificación en DB de los 4 pasos de `approve_tenant`.
3. Login del tenant demo (ya sembrado) en `admin/index.html` — booking, jobs,
   customers, payments, empleados — confirmando que todo escribe al proyecto
   Supabase nuevo (no al de AltaLux).
4. Intento de cobro real (booking con depósito, invoice/pay-link) — debe
   rechazar con 403 en los 3 casos, confirmando el guard sin cobro real.
5. `technician/index.html` con un empleado del tenant demo — jobs asignados,
   login.
6. Verificación cruzada: ningún dato de prueba de esta sesión debe aparecer
   en el Supabase de AltaLux, y viceversa — confirmar con `supabase db
   query --linked` contra ambos proyectos.
7. Limpieza de cualquier dato de prueba adicional creado durante el testing
   (más allá del tenant demo permanente).

## Riesgos conocidos / notas

- El reordenamiento manual de las 12 migraciones sin timestamp es el paso
  con más superficie de error de todo el proyecto — un orden incorrecto
  puede fallar a mitad de camino dejando el esquema nuevo a medias. Se
  valida migración por migración contra el proyecto nuevo antes de seguir a
  la siguiente.
- `phase_a_seed_altalux.sql` debe saltearse explícitamente; si se aplica por
  error, hay que hacer rollback manual de esas filas antes de sembrar el
  tenant demo (para no terminar con datos de AltaLux mezclados en el clon).
