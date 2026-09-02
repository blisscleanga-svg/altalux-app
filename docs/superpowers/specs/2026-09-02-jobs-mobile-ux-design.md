# Admin UX — Vista de Jobs unificada + filtros + salto de fecha en Calendar — Diseño

> Fecha: 2026-09-02
> Estado: en revisión con Luis

## Contexto

Primer entregable de una iniciativa más grande de UX mobile para `admin/index.html`
(el resto — modales full-screen en mobile, touch targets, tema claro/oscuro —
queda para specs separados, ver "Fuera de alcance" abajo).

Luis reportó dos problemas concretos usando capturas reales de Urable
(la referencia que este proyecto ya replica) como comparación:

1. La vista de **Jobs** es una tabla ancha (`.data-table`, `min-width:820px`)
   con `overflow-x:auto` — en mobile obliga a scroll horizontal interminable
   para ver una fila completa. En Urable (escritorio Y mobile) es una lista
   de filas compactas tipo tarjeta, sin scroll horizontal en ningún tamaño
   de pantalla.
2. El Calendar ya tiene una vista **Agenda** que agrupa jobs por fecha con
   el ingreso del día (parecida a la Agenda de Urable) — lo que falta es una
   forma rápida de saltar a una fecha específica sin navegar mes por mes.

Hallazgo útil durante la exploración: `buildJobCardHtml()` (admin/index.html
~línea 5185) ya existe y ya es lo que renderiza cada tarjeta en Agenda — es
más densa que la de Urable (7 campos + 3 botones siempre visibles), pero es
la base real a partir de la cual construir la tarjeta compacta que Luis
pidió para Jobs, no algo que haya que inventar desde cero.

## Objetivo

Reemplazar la tabla de Jobs (escritorio y mobile) por una lista de tarjetas
compactas estilo Urable — título/ubicación, cliente, monto, status, sin
scroll horizontal — con tabs de filtro por status y un toggle nuevo para ver
solo bookings online. Agregar un selector de fecha rápido al Calendar.

## Alcance

**Incluido:**
1. Columna nueva `jobs.source` (`'online_booking' | 'manual'`), marcada al
   convertir un booking a job. Jobs históricos quedan sin marcar/`'manual'`
   por defecto — confirmado con Luis que no vale la pena inferir el origen
   retroactivamente.
2. Tarjeta compacta nueva (`buildJobCardCompactHtml()`) — variante liviana
   de `buildJobCardHtml()`, NO lo reemplaza (Agenda se queda con la
   completa, sigue sirviendo al técnico en campo que necesita
   dirección/balance de un vistazo).
3. Vista de Jobs reconstruida con la tarjeta compacta — mismo componente en
   escritorio y mobile (confirmado con Luis: "los dos"), sin tabla ancha en
   ningún tamaño de pantalla.
4. Tabs de filtro por status (All/Pending/Confirmed/In Progress/Completed/
   Cancelled, con conteo — igual que Urable) + toggle "Online Bookings"
   (usa la columna nueva).
5. Selector de fecha rápido en Calendar (salta a cualquier fecha sin
   navegar mes por mes).

**Explícitamente fuera de alcance** (parte de la iniciativa más grande, specs
separados):
- Modales full-screen/bottom-sheet en mobile.
- Auditoría de touch targets (`min-height:44px`).
- Tema claro/oscuro.
- Simplificar Customers/Payments/Proposals (mismo problema de scroll
  horizontal, pero Luis solo pidió Jobs por ahora).
- Rediseño de Week/Day/Month view del Calendar (Month ya es similar a
  Urable; Week/Day no se tocan).

## Decisiones de arquitectura — 2 enfoques considerados

**A (recomendado): reusar y extender lo que ya existe.** Nueva función
`buildJobCardCompactHtml()` hermana de `buildJobCardHtml()` (mismo patrón
`data-status`, mismo `STATUS_SLUG`, mismo modal de detalle al hacer tap —
`openJobModal(j.id)` ya existe). Filtro de status como tabs nuevas sobre el
array `JOBS` ya cargado en memoria, sin queries nuevas. Selector de fecha
como un `<input type="date">` nativo simple que llama a la navegación de
calendario que ya existe (`state.selectedDate` + `renderCalendarViews()`).

**B (descartado): lista virtualizada / framework de renderizado compartido
para Jobs y Agenda.** Pensado para escala tipo Urable (653 jobs). AltaLux
hoy tiene un puñado de jobs reales — virtualización es trabajo real
(windowing, manejo de scroll position) para un problema que no existe
todavía. Se puede revisitar si el volumen de jobs crece mucho.

Se sigue el enfoque A — es una extensión directa de patrones ya probados
en este archivo (Agenda ya usa `buildJobCardHtml`, el modal de detalle ya
existe, `STATUS_SLUG` ya existe), no una reconstrucción.

## Modelo de datos

### `jobs.source` (columna nueva)

```sql
alter table public.jobs
  add column if not exists source text not null default 'manual'
  check (source in ('manual', 'online_booking'));
```

Se marca `'online_booking'` en el único punto donde un booking se convierte
a job (`admin/index.html`, el insert a `jobs` dentro del flujo de conversión
de booking — mismo lugar donde hoy se manda `notes: ''`). El "+ Job" manual
del FAB no cambia — su insert no manda `source`, así que usa el default
`'manual'` de la columna.

## Componente: `buildJobCardCompactHtml(j)`

Hermano de `buildJobCardHtml()`, mismo archivo, cerca de él. Campos (todos
ya disponibles en el objeto `j` que ya arma `mapJobRow`/`loadAllDataFromSupabase`,
ningún dato nuevo que cargar):

```html
<div class="job-card-compact" data-status="${STATUS_SLUG[j.status]}" data-job-id="${j.id}">
  <div class="job-card-compact-main">
    <div class="job-card-compact-title">
      JOB #${j.jobNumber} — ${j.service}
      ${j.address ? '<span class="job-card-compact-pin">📍</span>' : ''}
    </div>
    <div class="job-card-compact-customer">${j.customer.name}</div>
  </div>
  <div class="job-card-compact-right">
    <div class="job-card-compact-amount">${formatCurrency(balanceDue(j))} due</div>
    ${renderStatusBadge(j)}
  </div>
  <span class="job-card-compact-chevron">›</span>
</div>
```

Barra de color izquierda vía `border-left` en CSS, mismo color por status
que ya define `.job-card[data-status="..."]` hoy (reusa esas reglas, no
inventa una paleta nueva). El bloque completo es clickeable — un solo
listener delegado en el contenedor (`click` → `openJobModal(j.id)`, mismo
modal de detalle que ya existe con toda la info completa: dirección,
depósito, balance, vehículo — nada de eso se pierde, solo se mueve detrás
del tap, igual que en Urable).

## Vista de Jobs

`admin/index.html` — la sección `<section class="view" id="view-jobs">`
(hoy `<table class="data-table">`) se reemplaza por:

- Fila de tabs de filtro por status, con conteo por status calculado sobre
  `JOBS` en memoria — `All (N) | Pending (N) | Confirmed (N) | In Progress (N)
  | Completed (N) | Cancelled (N)`.
- Toggle "Online Bookings" — botón tipo pill, mismo estilo visual que los
  tabs de status pero separado de ellos (no es un status más, es un filtro
  independiente que se combina con el tab activo) — filtra
  `j.source === 'online_booking'` además del tab de status activo.
- Contenedor `<div id="jobs-cards-list">` que renderiza
  `filteredJobs.map(buildJobCardCompactHtml).join('')`.

Mismo componente para escritorio y mobile — el único cambio entre tamaños
de pantalla es CSS de layout (más aire/columnas más anchas en escritorio
vía el `.job-card-compact` normal de flexbox, sin grid especial), no un
componente distinto.

## Calendar — selector de fecha rápido

Un `<input type="date">` nativo junto al label "September 2026" existente
del Calendar — al cambiar, llama `state.selectedDate = new Date(input.value)`
+ `renderCalendarViews()` (la misma función que ya usan los clicks de
celda de Week/Month). No es un date-picker custom — el nativo del
navegador/iOS ya resuelve bien la interacción de "saltar a una fecha
lejana" sin construir un componente nuevo.

## Manejo de errores

- `jobs.source` con `default 'manual'` — ningún insert existente se rompe
  aunque no mande la columna (ni el manual, ni cualquier otro insert de
  `jobs` que exista en el código y no se haya tocado en este cambio).
- El filtro "Online Bookings" sobre un negocio con cero jobs de ese origen
  simplemente muestra el estado vacío ya existente ("No jobs match this
  filter" — mismo patrón que ya usa `jobs-filter-banner`/Agenda cuando no
  hay resultados).

## Testing

- Migración: `supabase db push` + verificar con
  `supabase db query --linked` que la columna existe con el default
  correcto, y que un insert de prueba a `jobs` sin `source` cae en
  `'manual'`.
- `buildJobCardCompactHtml`/vista de Jobs: Playwright headless contra el
  archivo real (mismo patrón de origen falso + hook de test ya usado en
  esta sesión) — sembrar `JOBS` con jobs de ambos `source`, confirmar que
  los tabs de status filtran bien, que el toggle "Online Bookings" filtra
  bien, que tocar una tarjeta abre el modal de detalle correcto, y que no
  hay overflow horizontal en un viewport de 375px (`document.documentElement.scrollWidth`
  no debe superar el viewport).
- Selector de fecha: Playwright — cambiar el `<input type="date">` y
  confirmar que `state.selectedDate` y la vista de calendario activa
  reflejan la fecha elegida.
