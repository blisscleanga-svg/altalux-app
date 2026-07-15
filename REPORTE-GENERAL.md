# AltaLux App — Reporte General de lo Hecho
> Última actualización: 2026-07-15
> Rama: `main`, commit actual: `854309a`

---

## Resumen ejecutivo

En esta sesión se llevó la app de "cada archivo con datos hardcodeados por separado" a "un solo negocio configurado en Supabase que alimenta booking, admin y technician" (Fase A), luego se agregó un sistema de facturación/pagos/reembolsos real con Square y un rediseño de UI (Fase B), y finalmente se conectó el último archivo que faltaba (`booking/index.html`) para que los cambios de precios en Settings realmente se reflejen en el sitio público.

**El código de pago de Square (inicialización, formulario, tokenización) nunca fue tocado en ninguna de las tres fases** — verificado con `git diff` antes de cada commit.

---

## FASE A — Fundación Multi-Tenant

**Objetivo:** que un solo código sirva a AltaLux y (más adelante) BlissClean sin tocar código, solo agregando una fila de datos.

### Base de datos
- Tablas nuevas: `business_settings`, `business_services` (21 filas, catálogo real), `business_addons` (10 filas).
- Columna `business_id` agregada a `jobs`, `customers`, `vehicles`, `bookings`, `payments`, `invoices`, `employees`.

### 🔴 Hallazgo de seguridad crítico (encontrado y corregido en esta fase)
El esquema original iba a dejar `square_access_token`/`stripe_secret_key` legibles públicamente vía la `anon key`. Se probó con un valor real plantado en la tabla, se confirmó la fuga, y se corrigió con una vista `business_settings_public` que excluye esas columnas — vuelto a probar y confirmado bloqueado.

### `shared/config.js` (archivo nuevo)
Detecta el negocio por dominio, carga settings/servicios/addons desde Supabase, aplica branding dinámico (colores), con fallback hardcodeado si Supabase no responde.

### `admin/index.html` — página Settings nueva
7 pestañas conectadas de verdad a Supabase: Business Info, Branding, Servicios y Precios, Add-ons, Booking Settings, Payments, Notifications.

### Edge Function `send-email` (Resend)
5 tipos de correo (confirmación, cita confirmada, recordatorio 24h, factura, notificación interna), conectados a los flujos reales de booking/admin/technician.

### Bug de producción encontrado y corregido
El `SQUARE_APP_ID` en este repo de git tenía una `z` minúscula — el fix real (`Z` mayúscula) vivía solo en la carpeta de despliegue de Windows y nunca se había subido a git. Corregido en los 6 lugares donde vivía el valor (3 HTML, `config.js`, Supabase, SQL de seed).

---

## FASE B — Invoicing, Pagos, Bug Fix, UI/UX

### Análisis previo (antes de tocar nada)
Se leyeron completos `shared/config.js`, `technician/index.html`, `admin/index.html`, `square-payment/index.ts`, y las 8 migraciones. Hallazgos clave:
- El botón "Collect Payment" en **technician** ya funcionaba bien con Square — Stripe solo aparecía como opción bloqueada/"Coming Soon".
- El bug real estaba en **admin**: un botón "Collect Payment" duplicado y muerto que solo mostraba un `alert()` falso mencionando Stripe.
- La tabla `invoices` ya existía en Supabase (creada fuera de este repo) pero vacía y sin usar — se decidió hacer `ALTER TABLE` sobre ella en vez de crear una tabla paralela.
- No existía ningún vínculo relacional (`service_id`) entre `jobs` y `business_services`.
- El cambio de estado de un job usaba `<select>` nativo en admin, y botones dedicados en technician (sin opción de "Cancelled" en ninguno de los dos).

### Base de datos
- `phase_b_invoicing.sql`: `ALTER` sobre `invoices` (agrega `service_id`, `original_amount`, `adjustments`, `final_amount`, `amount_paid`), tablas nuevas `invoice_payments`/`invoice_refunds`, columna `service_id` en `jobs`, RLS verificada con una fila de prueba real (plantada y confirmada bloqueada para `anon`).

### Edge Function `square-refund` (nueva)
Recibe `payment_id` + monto + razón, llama a la API de refunds de Square, registra el resultado en `invoice_refunds`. Desplegada y probada.

### Bug fix Stripe → Square
- Botón "Collect Payment" en **admin**: ya no es un alert falso — redirige al modal real (`+ Record Payment`) que sí cobra con Square.
- Labels `'Stripe'` obsoletos en datos de muestra (admin y technician) corregidos a `'Square'` — incluyendo un caso real (no solo de muestra): la conversión de un booking a job en admin etiquetaba el depósito como "Stripe" cuando en realidad siempre viene de Square.

### Panel de Invoice/Pago en technician
Dentro del modal "Collect Payment": cambiar el servicio (contra el catálogo real de `business_services`), agregar cargos adicionales con descripción y monto, resumen en vivo, el total ajustado es el que se cobra de verdad con Square, se registra en `invoices` + `invoice_payments`.
**Probado en vivo:** agregar un cargo de $45 recalculó correctamente el total; cambiar de servicio recalculó el precio base y el total combinado.

### Refund — en technician y en admin
Modal con monto original, monto a reembolsar editable, razón requerida → llama a `square-refund` → actualiza estado. Construido primero en technician (aprobado), y luego también en admin cuando se detectó que ahí seguía el alert falso.

### Componente de dropdown custom
`createDropdown()` — reemplaza los `<select>` nativos con un componente con el diseño de marca (fondo oscuro, borde naranja al activar, checkmark dorado), manteniendo el `<select>` real oculto como fuente de verdad (así todo el código existente que lee `.value` sigue funcionando sin cambios). **32 dropdowns convertidos** (6 en technician, 26 en admin), verificados en vivo — seleccionar una opción sincroniza el select real y dispara el evento `change` correctamente.

### Rediseño de cambio de estado
- **Admin:** los 2 `<select>` de status reemplazados por un modal con cards grandes (ícono + descripción), probado en vivo end-to-end (clic → toast "Status updated to Cancelled" → badge actualizado en la tabla).
- **Technician:** nuevos colores de badge, y se agregó la capacidad de cancelar un job (no existía antes en ninguno de los dos).
- Nuevo estado "Cancelled" con su propio color en ambas apps.

### Polish general de UI
Botones (hover + transform), inputs (fondo sólido, anillo de foco naranja), sombras en cards, toasts — aplicado según la paleta de marca.

---

## Fix posterior: booking widget no reflejaba cambios de Settings

**El problema:** `booking/index.html` era el único archivo que nunca se conectó a Supabase — seguía usando su propio catálogo de precios hardcodeado por dentro, así que cambiar un precio en Settings no tenía ningún efecto en el sitio público.

**El fix:** el catálogo, add-ons, porcentaje de depósito, política de cancelación y teléfono ahora se reconstruyen desde `APP_CONFIG` en cuanto carga, preservando el mismo fallback hardcodeado para que la página nunca se rompa si Supabase está lento.

**Probado en vivo, no solo en teoría:** se cambió un precio real en Supabase (simulando lo que harías en Settings), se recargó la página, se confirmó que el nuevo precio aparecía con el depósito recalculado, y se revirtió el valor de prueba.

---

## Todo lo verificado en vivo (no solo código — comportamiento real probado con Playwright)

- Booking, admin y technician cargan sin errores de consola en las 3 apps
- Panel de ajuste de servicio/cargos en technician: matemática correcta confirmada
- Dropdown custom: sincronización bidireccional confirmada en ambas apps
- Status picker: flujo completo (clic → cambio → toast → persistencia) confirmado
- Refund en admin: guard correcto quando no hay pago real vinculado
- Booking widget: cambio de precio real en Supabase reflejado correctamente en la página

---

## Commits de esta sesión (orden cronológico)

```
e2f45b8  fix: correct Square Application ID typo (lowercase z -> Z)         [ya estaba en GitHub, no en este clon]
402c493  docs: update CONTEXT.md to match actual project state              [ya estaba en GitHub, no en este clon]
a134740  feat: phase A — multi-tenant foundation, business_settings...
f25b8af  Merge remote-tracking branch 'refs/remotes/origin-temp/main'
866a612  docs: add Phase A summary report
089fdb3  fix: use absolute app.altaluxdetail.com URLs for booking/admin/technician_url
164a215  feat: invoice system, payment adjustments, refund, Square fix, UI/UX overhaul
b2341d9  feat: real refund modal in admin, wired to square-refund
854309a  fix: connect booking widget to real Supabase pricing/services
```

---

## Estado real por archivo

| Archivo | Conectado a Supabase | Tocado esta sesión |
|---|---|---|
| `booking/index.html` | ✅ Sí (servicios/precios/addons/depósito/política/teléfono) | Sí — Square intacto (verificado) |
| `admin/index.html` | ✅ Sí (ya lo estaba desde Fase A) | Sí — Settings, dropdowns, status picker, refund |
| `technician/index.html` | ✅ Sí (branding desde Fase A; catálogo real en el panel de ajuste) | Sí — dropdowns, status/cancel, panel de invoice, refund |
| `shared/config.js` | — (es la fuente) | Sí — fallback ampliado |
| `square-payment` Edge Function | N/A | **No tocado en ninguna fase** |

---

## Pendiente / deuda técnica conocida

- [ ] `square-payment` Edge Function sigue leyendo credenciales de variable de entorno fija, no de `business_settings` — necesario para que BlissClean use su propia cuenta de Square en el futuro (Fase 6).
- [ ] Configurar `resend_from_email` real en Settings → Notifications para que los correos salgan de verdad (sigue devolviendo error claro en vez de enviar, por diseño).
- [ ] Probar el flujo de Settings/dropdowns/refund con un login real de Owner (las pruebas de esta sesión usaron bypass de login o mocks de auth, no credenciales reales).
- [ ] Auditoría línea por línea del spacing de 8px no se hizo de forma exhaustiva en las ~9000 líneas combinadas de admin+technician.
- [ ] Fase 6 (BlissClean multi-tenant) — la fundación técnica ya está lista, falta la fila de datos.

---

## Nota aparte — trabajo en blisscleandetail.com (proyecto separado)

En una sesión anterior también se corrigieron temas de GTM/Google Ads (fix de CSP bloqueando el trigger de conversión, corrección de un trigger con slash mal configurado) y una auditoría SEO completa (dominio equivocado en canonical/schema, imágenes sin comprimir, precios desincronizados) en el sitio de marketing de BlissClean — proyecto distinto a AltaLux, documentado por separado en esa conversación.
