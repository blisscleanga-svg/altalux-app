# Fase 5 — SMS vía Twilio, Sub-fase 1+2 (envío + conversación bidireccional) — Diseño

> Fecha: 2026-09-02
> Estado: aprobado por Luis, listo para plan de implementación

## Contexto

Fase 5 del proyecto (`CONTEXT.md` → Fases del Proyecto) es "SMS/Notificaciones
automáticas" vía Twilio, hasta ahora no iniciada (`twilio_enabled: false` en
`shared/config.js`, columnas `twilio_phone`/`twilio_enabled` en
`business_settings` sin usar desde `phase_a_multitenant.sql`).

El modelo de referencia es Urable (el software que este proyecto ya replica
para el resto de sus funciones — ver `CONTEXT.md` → ¿Qué es esto?): un número
Twilio dedicado por negocio, un "Message Center" en el admin con conversación
bidireccional por cliente (mezclando mensajes automáticos, manuales, y
respuestas reales del cliente en un solo hilo), y un botón "On My Way" que
geolocaliza al técnico y calcula ETA. Se decidió con Luis descomponer esto en
5 piezas y trabajar solo las 2 primeras en esta entrega:

1. **Sub-fase 1+2 (este spec):** infra de envío saliente + conversación
   bidireccional (webhook entrante, tabla de mensajes, Message Center en el
   nav del admin).
2. Chat por job/cliente (deep-link al hilo desde el detalle del job) — casi
   gratis una vez esté 1+2, queda para después.
3. "On My Way" (geolocalización + ETA vía Google Maps) — después.
4. Composer manual / campañas masivas (dynamic fields, scheduling,
   Queued/Undelivered) — después.

Número Twilio: toll-free comprado directo en la consola de Twilio (no vía
LeadConnector/GHL — se descartó esa ruta porque un número nativo de GHL no
expone Account SID/Auth Token propios, y hubiera obligado a integrar contra
la API de LeadConnector en vez de la de Twilio directamente). Verificación
Toll-Free en curso — rechazada una vez por "legal entity type mismatch",
corregida y de nuevo en revisión al momento de escribir este spec. El envío
real no funciona hasta que Twilio apruebe el número; todo lo de este spec se
construye y se deja listo para conectar los secrets el día que llegue la
aprobación.

## Objetivo

Que cualquier mensaje saliente (por ahora: confirmación de booking) y
cualquier respuesta del cliente terminen en el mismo hilo de conversación por
cliente, visible y respondible por el staff desde un Message Center en el
admin — igual que Urable, con el mismo número de teléfono para automatizados
y manuales.

## Alcance

**Incluido:**
1. Migración: tabla `sms_messages`, tabla `sms_opt_outs`, columna
   `business_settings.sms_toggles`.
2. Edge Function `send-sms` — saliente, actions `booking_confirmation` y
   `manual_reply`.
3. Edge Function `twilio-webhook` — pública, entrante, valida firma de
   Twilio, maneja STOP/HELP/START, guarda mensajes inbound.
4. Fix de compliance ya aplicado y desplegado (ver `CONTEXT.md` 2026-09-01):
   checkbox de consentimiento SMS en `booking/index.html` sin pre-marcar, con
   frecuencia/rates/STOP-HELP/links — prerrequisito para que Twilio apruebe
   el número, no parte del código de esta sub-fase pero sí de la misma
   entrega.
5. Message Center: nav item "Messages" en `admin/index.html`, lista de
   hilos por cliente, vista de hilo completo, textarea de respuesta.
6. Invocar `send-sms('booking_confirmation')` desde `booking/index.html`,
   junto al `sendEmailAction('booking_confirmation')` que ya existe.

**Explícitamente fuera de esta sub-fase** (ver "Pendiente" en `CONTEXT.md`):
botón On My Way, deep-link de chat desde el detalle de job, composer
manual/campañas masivas, Queued/Undelivered, dynamic fields, scheduling.

## Modelo de datos

### `sms_messages` (nueva)

| columna | tipo | notas |
|---|---|---|
| `id` | uuid, PK | `gen_random_uuid()` |
| `business_id` | text | FK `business_settings(business_id)` |
| `customer_id` | uuid, nullable | FK `customers(id)` — null si un inbound no matchea ningún cliente conocido |
| `phone` | text | E.164, siempre presente (el número del cliente, sea saliente o entrante) |
| `direction` | text | `'outbound'` \| `'inbound'`, CHECK |
| `body` | text | contenido del SMS |
| `twilio_sid` | text, nullable | `MessageSid` de Twilio |
| `status` | text | `'queued'`\|`'sent'`\|`'delivered'`\|`'failed'`\|`'received'` |
| `action` | text, nullable | `'booking_confirmation'`, `'manual_reply'`, null en inbound |
| `read` | boolean | default `false`; controla el punto de no-leído del Inbox |
| `created_at` | timestamptz | default `now()` |

Índice en `(business_id, phone, created_at)` para armar el hilo rápido.

### `sms_opt_outs` (nueva)

| columna | tipo | notas |
|---|---|---|
| `business_id` | text | FK `business_settings(business_id)` |
| `phone` | text | E.164 |
| `opted_out_at` | timestamptz | null = nunca opted-out / ya volvió a opt-in (START) |

PK compuesta `(business_id, phone)`. Deliberadamente independiente de
`customers` — un STOP puede llegar de un número que nunca se convirtió en
cliente (un lead). Se consulta antes de **cualquier** envío saliente (tanto
`booking_confirmation` como `manual_reply`).

### `business_settings.sms_toggles` (columna nueva, jsonb)

Análoga a `email_toggles` (`phase_a_settings_extra_columns.sql`). Default
`{"booking_confirmation": true}`. Permite desactivar un tipo de SMS por
negocio sin tocar código, mismo patrón que ya existe para email.

### Matching de inbound → cliente

`customers.phones` es un array jsonb de `{label, number}` en formato libre
US (`(404) 555-0123`), no E.164. El webhook normaliza tanto el `From` de
Twilio como cada `number` guardado a "solo dígitos, últimos 10" antes de
comparar — evita depender de que el formato coincida exactamente. Se hace en
la Edge Function (TypeScript), no en SQL — a la escala actual (un negocio,
cientos de clientes) un scan en memoria del listado de `customers` de ese
`business_id` es más simple que mantener una columna normalizada indexada, y
no vale la pena la complejidad extra todavía.

## Componentes

### `send-sms` (Edge Function nueva, saliente)

Mismo esqueleto que `supabase/functions/send-email` (service role, lee
`business_settings`, respeta toggles): recibe `{ action, businessId, data }`.

- `BUILDERS`: `booking_confirmation` (plantilla de texto plano — nombre,
  servicio, fecha/hora, depósito pagado, balance pendiente, nombre del
  negocio, "Reply STOP to opt out"), `manual_reply` (pasa `data.body` tal
  cual, sin plantilla — lo que el staff escribió en el Message Center).
- Antes de enviar: normaliza el teléfono destino a E.164 (US, 10 dígitos →
  `+1XXXXXXXXXX`; cualquier otra cosa → error sin intentar el envío),
  consulta `sms_opt_outs` (si `opted_out_at` no es null, responde
  `{ skipped: true, reason: 'opted_out' }` sin llamar a Twilio), y consulta
  `sms_toggles[action]` igual que `send-email` hace con `email_toggles`.
- Llama a la API REST de Twilio (`POST /2010-04-01/Accounts/{Sid}/Messages.json`,
  Basic Auth con `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` como Supabase
  secrets globales — mismo patrón de "una cuenta sirve a todos los negocios
  por ahora" que `RESEND_API_KEY`), `From` = `business_settings.twilio_phone`.
- Inserta una fila en `sms_messages` (`direction: 'outbound'`) con el
  `twilio_sid`/`status` que devuelve Twilio, sea éxito o error.

### `twilio-webhook` (Edge Function nueva, pública, entrante)

Único endpoint que Twilio golpea para cualquier SMS recibido (configurado en
la consola de Twilio como el webhook de mensajería del número, una vez
aprobado). Twilio manda `application/x-www-form-urlencoded`, no JSON
(`From`, `To`, `Body`, `MessageSid`, etc.).

1. Valida `X-Twilio-Signature` contra `TWILIO_AUTH_TOKEN` (firma HMAC de
   Twilio sobre la URL + params del POST) — rechaza con 403 si no valida,
   porque es un endpoint público sin auth de Supabase.
2. Resuelve `business_id` buscando `business_settings` por `twilio_phone`
   igual al `To`.
3. Normaliza `From`, intenta matchear contra `customers.phones` de ese
   negocio (ver sección de matching arriba).
4. Si `Body` (trim, case-insensitive) es `STOP`/`STOPALL`/`UNSUBSCRIBE`/
   `CANCEL`/`END`/`QUIT`: upsert `sms_opt_outs` con `opted_out_at = now()`,
   responde con TwiML (`<Response><Message>...</Message></Response>`) el
   texto de baja ("You have been unsubscribed from AltaLux Mobile Detail.
   Reply START to resubscribe.").
5. Si es `START`/`UNSTOP`/`YES`: upsert `sms_opt_outs` con
   `opted_out_at = null`, responde TwiML de confirmación de vuelta.
6. Si es `HELP`: responde TwiML con el mismo texto que ya se declaró en el
   registro Toll-Free de Twilio ("AltaLux Mobile Detail: For help, visit
   https://app.altaluxdetail.com or call (888) 853-0590...").
7. Cualquier otro texto: solo inserta la fila en `sms_messages`
   (`direction: 'inbound'`, `read: false`) — es una respuesta real dentro de
   una conversación, no dispara ningún auto-reply. Responde TwiML vacío
   (`<Response></Response>`) para que Twilio no reintente.

### Message Center (`admin/index.html`)

Nav item nuevo `data-view="messages"` (desktop nav, sidebar, bottom-nav —
mismo patrón que Calendar/Jobs/Proposals/Customers/Payments).

- **Lista de hilos**: un `SELECT DISTINCT` por `phone` sobre `sms_messages`
  del `business_id` actual, ordenado por el `created_at` del último mensaje
  de cada hilo. Cada fila: nombre del cliente (si `customer_id` matcheó,
  si no el número tal cual), preview del último mensaje, hora, punto rojo si
  hay algún `inbound` con `read = false` en ese hilo.
- **Vista de hilo**: todos los mensajes de ese `phone` ordenados
  cronológicamente, burbujas diferenciadas por `direction` (mismo patrón
  visual que el timeline de pagos que ya existe en el modal de detalle de
  job). Al abrir el hilo, marca `read = true` en sus mensajes inbound.
- **Responder**: textarea + botón "Send" → llama `send-sms('manual_reply')`
  con el `phone` del hilo y el texto escrito, sin pasar por ningún toggle
  (es una acción explícita del staff, no un automatizado).

### `booking/index.html`

Junto a las dos llamadas existentes (`sendEmailAction('booking_confirmation')`,
`sendEmailAction('internal_notification')`), agrega
`sendSmsAction('booking_confirmation')` — mismo patrón `fetch` no bloqueante
que ya usa `sendEmailAction`, solo se dispara si `state.smsReminders` es
`true` (el checkbox `#c-sms`, ya corregido para no venir pre-marcado).

## Manejo de errores

- Teléfono no normalizable a E.164 (no es un número US de 10 dígitos):
  `send-sms` responde error sin llamar a Twilio, no rompe el flujo de
  booking (mismo patrón `.catch()` no bloqueante que ya usa
  `sendEmailAction`).
- Cliente opted-out: `send-sms` responde `{ skipped: true }`, no es un error.
- Firma de Twilio inválida en el webhook: 403, no se inserta nada.
- Falla la escritura a `sms_messages` tras un envío exitoso a Twilio: se
  loguea pero no se reintenta — el mensaje ya salió, perder el registro
  local es un problema de visibilidad en el Inbox, no un mensaje perdido
  para el cliente. (Mismo nivel de tolerancia que el resto del proyecto —
  ver `attemptSupabaseWrite` en `admin/index.html`.)

## Testing

- **`send-sms` y `twilio-webhook`**: `deno check` antes de deploy (mismo
  paso que ya es estándar para `send-email` en el flujo de deploy). Para el
  webhook, como no hay número aprobado todavía para recibir un SMS real, se
  simula con `curl` un POST firmado a mano (firma HMAC calculada con el
  `TWILIO_AUTH_TOKEN` real) contra la función ya desplegada, verificando el
  insert en `sms_messages` y la respuesta TwiML.
- **Message Center**: Playwright headless contra `admin/index.html` local
  (mismo setup que el resto del proyecto — ver skill
  `headless-browser-sandbox`), con filas de `sms_messages` sembradas a mano
  vía `supabase db query --linked` para probar la UI sin depender de un
  envío real.
- **Envío real end-to-end**: bloqueado hasta que Twilio apruebe el número
  toll-free. Cuando llegue la aprobación: un booking de prueba real,
  confirmar que llega el SMS, responder desde el celular, confirmar que la
  respuesta aparece en el Message Center.
