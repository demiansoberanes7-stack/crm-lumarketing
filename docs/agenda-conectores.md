# Conectores de agenda

Un **conector** es la forma en que una cita del CRM se convierte en una reunión
de verdad. El motor de agenda no sabe de proveedores: sabe *cuándo* atiende el
negocio y *quién* reservó. Entregar la reunión es trabajo del conector.

Esa separación es lo que hace que agregar Teams, Outlook, CalDAV o Cal.com en
tu fork sea escribir un archivo y una tabla — no pelearte con el motor.

> Los conectores que hablan con un servicio externo existen bajo cinco
> condiciones constitucionales (Principio II, v1.4.0): apagados por defecto,
> aislados tras su adaptador, con un camino sin dependencia que funcione igual,
> credenciales cifradas del propio negocio, y probados en CI encendidos y
> apagados. Un conector que no las cumpla no entra al core.

## Los que vienen incluidos

### Enlace fijo (`enlace-fijo`) — el default

Tu sala de siempre. Pegas la URL una vez en Ajustes → Agenda y cada cita la
reparte. No habla con nadie, no pide credenciales y no puede fallar. Si lo
dejas vacío, las citas se agendan igual y sin enlace: nadie promete lo que no
tiene.

Es también la razón de que encender la agenda no te obligue a conectar nada.

### Zoom (`zoom`)

Cada cita crea su propia reunión de Zoom. Reprogramar la mueve conservando el
mismo enlace; cancelar la borra.

**Qué necesitas**: una app **Server-to-Server OAuth** en el Marketplace de Zoom
(la crea el negocio, en su propia cuenta). De ahí salen los tres datos que se
pegan en Ajustes → Agenda: *Account ID*, *Client ID* y *Client Secret*.

**Los cuatro permisos (scopes)**:

```text
meeting:write:meeting     crear la reunión
meeting:update:meeting    moverla al reprogramar
meeting:delete:meeting    borrarla al cancelar
user:read:user            leer tu usuario
```

> ⚠️ El cuarto se olvida siempre. Es el que usa el botón **Probar**: sin él, la
> conexión falla aunque tus credenciales sirvan perfectamente para crear
> reuniones, y el mensaje de error no lo dice.

### Google Calendar + Meet (`google`)

Cada cita crea un evento en tu calendario con su enlace de Meet. Su
diferencial: la cita aparece donde ya miras tu día.

**Qué necesitas**: un proyecto en Google Cloud **del propio negocio** con la
API de Calendar activada, y de ahí *Client ID*, *Client Secret* y un *refresh
token* con el permiso `calendar.events`. El calendario destino es `primary`
salvo que pongas otro.

> ⚠️ **Publica tu app OAuth "en producción".** Si la dejas en modo prueba,
> Google **revoca el refresh token a los 7 días** y tus citas dejarán de generar
> enlace sin previo aviso. Cuando pasa, el CRM marca la conexión como rota y te
> lo muestra en Ajustes — pero la semana perdida no se recupera.

Dos detalles que este conector resuelve por dentro, y que conviene conocer si
escribes uno parecido: la conferencia de Meet se crea **de forma asíncrona** (la
respuesta de crear el evento puede venir sin enlace), así que el conector
re-lee el evento; y si aun así no llegó, la cita se entrega con el evento
creado y el enlace pendiente — reintentarlo **re-lee ese mismo evento**, nunca
crea uno duplicado en tu calendario.

### Los dos calendarios: el del negocio y el de cada persona

`google_credentials` tiene `user_id`. La fila con `user_id IS NULL` es **la del
negocio**: la que se pega a mano o se autoriza en **Ajustes → Google Calendar**,
y la única que recibe las **citas**. Una fila con `user_id` es el calendario
**personal** de un miembro, y solo recibe **sus tareas**.

- **Por qué las citas no van al calendario de quien las atiende.** Una cita la
  reserva un cliente contra la agenda de la empresa. Repartirla por personas
  haría que dos negocios distintos vieran dos mitades del mismo día.
- **Cascada al escribir tareas** (`getPersonalGoogleCredentials`): si el miembro
  conectó el suyo, sus tareas van ahí; si no, al del negocio. Así la función
  sirve aunque nadie más que el dueño haya autorizado nada.
- **Sin cascada al mostrar** (`peekGoogleCredentials`): la tarjeta de *Mi
  calendario* lee la fila exacta de esa persona. Decirle «conectado» porque el
  del negocio sí lo está sería mentirle sobre sus propias tareas.
- El `Client ID` y el `Client Secret` **son del negocio** (un proyecto de Google
  Cloud por instancia). Lo personal es el *consentimiento* —y por tanto el
  calendario—, no la app: por eso un miembro no tiene nada que pegar y por eso
  el flujo empieza con la credencial de la empresa y guarda su `user_id` en el
  estado de un solo uso. Si el negocio no está conectado, la tarjeta personal
  lo dice en vez de ofrecer un botón que fallaría.
- El relleno posterior respeta la misma frontera: quien autoriza su calendario
  personal sube **solo sus tareas** (`syncPendingTasks(org, 100, userId)`); el
  histórico de un compañero no acaba en su calendario por culpa de un OAuth ajeno.

### Una cita, un evento

El CRM guarda dos cosas que parecen lo mismo y no lo son:

| columna | qué es | quién la escribe |
| --- | --- | --- |
| `external_ref` | la referencia del **conector** (reunión de Zoom, evento de Meet…) | `createMeeting` al entregar el enlace |
| `google_event_id` | el **evento de calendario** | `bookings-sync` |

Con el conector `google` son **el mismo evento**: la sincronización *adopta* el
`external_ref` en `google_event_id` y **no llama a Google**. Con Zoom, enlace
fijo o sin conector, el CRM crea su propio evento y le escribe el enlace en la
descripción. Un tercer camino —crear un evento aparte encima de uno de Meet—
dejaría **dos citas** en el calendario del dueño por cada reserva, que es el
único fallo de este módulo que el usuario vería.

Reglas que le acompañan:

- **Cancelada ⇒ sin evento.** Con el conector Google ya lo retiró `deleteMeeting`;
  aquí se olvida la marca. Si aquel borrado falló, el evento queda en Google y el
  dueño lo quita a mano: el CRM no sigue afirmando que es suyo.
- **Laboratorio y bloques fuera.** `is_test` y `kind = "block"` jamás llegan al
  calendario de nadie.
- **El `PATCH` no menciona `conferenceData`.** En Google PATCH es *merge*: lo que
  no se manda se conserva, y eso es lo que protege el enlace de Meet que ya se le
  envió al cliente.

## El relleno y el poller

La sincronización corre **después** de escribir la cita y dentro de un
`try/catch`, así que Google no puede tumbar una operación del CRM. Eso deja un
hueco: lo que se quedó sin evento porque el proveedor estuvo caído, porque el
token caducó a los 7 días (modo prueba), o porque la fila ya existía cuando se
conectó el calendario. Lo cierra `runAgendaWorkerOnce()` cada **5 minutos**, en
el mismo patrón `globalThis` que el poller de correo:

- Solo barre organizaciones con Google `connected`; las citas de las que tienen
  calendario de negocio, las tareas de las que tienen el interruptor encendido.
- El relleno mira filas **sin** `google_event_id`, así que **nunca duplica** un
  evento. Las adopciones alcanzan a citas pasadas (es un escribir local); crear
  eventos propios se limita a citas **futuras** — reconectar no debe inundar el
  calendario con el histórico de meses.
- Se corta con el primer `invalid_grant`: un token muerto no se martilla.
- Anota el resultado en `sync_state` (`provider = "google_calendar"`) por
  negocio: es lo que responde «¿por qué esta cita no está en mi calendario?» sin
  leer logs.
- **Lo que deliberadamente no reintenta:** el enlace de Meet de una cita en
  `link_pending`. Eso cambia lo que recibió el cliente, y sigue siendo decisión
  del dueño con su botón *Reintentar enlace*.

Si borras el evento **a mano en Google**, Calendar entrega una cancelación y el
poller la refleja como cita cancelada en el CRM. La marca local conserva el id
externo para no volver a importar ni recrear ese evento.

## Sincronización en dos direcciones

La pantalla **Citas** ya permite alta manual. `POST /api/bookings` guarda la
cita en el CRM y `syncBookingEvent()` crea o adopta el evento de Google. En el
sentido de vuelta, el poller lee los cambios de Google y los incorpora al mismo
calendario del CRM.

### Google Calendar → CRM

`syncGoogleCalendarEvents()` corre desde el mismo poller de cinco minutos, una
vez por calendario de negocio conectado. La carga inicial pagina los eventos del
calendario; después usa el `syncToken` de Google, guardado en `sync_state` con
`provider = "google_calendar_import"`. Cada página conserva su `pageToken`, y
un token vencido provoca una carga completa segura, sin duplicados.

`google_event_id` es la llave de idempotencia. Los eventos con hora de inicio y
fin se reflejan en Citas como registros con origen «Google Calendar»; mover o
editar el evento actualiza esa fila, y cancelarlo cancela la cita del CRM. Los
eventos de día completo, transparentes y de tipos distintos al evento normal no
se convierten en citas. La vista se refresca por SSE al importar cambios.

### CRM → Google Calendar y conflictos

La sincronización de escritura existente sigue activa. Al editar o reprogramar
una cita importada, el CRM actualiza el mismo evento por `google_event_id`; no
crea uno adicional. Los eventos creados en el CRM se adoptan por id y se
actualizan en la misma fila cuando Google devuelve sus cambios.

Una cita cancelada explícitamente en el CRM no se reactiva por un evento de
Google que aún aparezca activo. Si un evento se mueve a la hora exacta de otra
cita activa, el CRM no duplica ni desplaza la cita existente: conserva el
registro actual y anota el conflicto en Diagnóstico para revisión. El resto de
los cambios se reflejan en ambos sentidos.

La importación no asigna contacto automáticamente: el modelo de contactos no
guarda correo para empatar con asistentes de Google. El evento queda sin contacto
y aparece con su asunto, lugar, notas y enlace.

## Qué pasa cuando el proveedor falla

Nada que te cueste una cita. El orden es deliberado: **primero se escribe la
verdad en el CRM, después se habla con el proveedor**. Si el proveedor está
caído, rechaza las credenciales o simplemente tarda:

1. La cita **se crea igual** y se responde `201`, con `linkPending: true` y sin
   enlace.
2. Quien confirma al cliente dice que el enlace llega en un momento, en vez de
   prometer uno que no existe.
3. La cita aparece en **Citas** marcada "sin enlace", con un botón para
   **reintentar**.
4. Si el fallo fue de autenticación, la conexión queda marcada como rota en
   Ajustes, con su tarjeta de reconexión.

## Escribe tu conector

El contrato son **cuatro operaciones** (más una opcional). No es un mínimo
prudente: es exactamente lo que el uso real necesitó en un CRM en producción
durante meses.

```ts
// src/server/agenda/connectors/types.ts
createMeeting(creds, { topic, startUtc, durationMinutes, timezone, notes? })
  → { externalId, joinUrl }
updateMeeting(creds, externalId, { startUtc, durationMinutes, timezone })
  → void                      // al reprogramar; conserva el enlace
deleteMeeting(creds, externalId) → void   // al cancelar; un 404 es ÉXITO
testConnection(creds) → { ok: true } | { ok: false, error }

// Opcional, solo si tu proveedor genera el enlace de forma asíncrona:
refreshMeeting?(creds, externalId) → { externalId, joinUrl }
```

Reglas que hace cumplir el motor, no tú:

- **Best-effort.** Una excepción tuya jamás revierte ni bloquea la cita.
- **Sandbox.** Una cita del Laboratorio nunca llega a un conector: la aserción
  vive antes de elegir cuál. No compruebes `is_test`; no te toca.
- **Idempotencia.** Borrar algo que ya no está es objetivo cumplido.
- **Sin free/busy.** El contrato no lee disponibilidad ajena, a propósito: la
  disponibilidad se calcula local, en una query, y meter al proveedor ahí
  acoplaría su latencia a la pantalla que más se usa. Si tu fork lo necesita,
  es una extensión — no un hueco.

### Los seis archivos que tocas

1. `src/lib/agenda-connectors.ts` — tu id y tu ficha (etiqueta, descripción,
   capacidades). Es lo que la pantalla de Ajustes muestra.
2. `src/server/agenda/connectors/<id>.ts` — el adaptador.
3. `src/server/agenda/connectors/<id>-credentials.ts` + `src/lib/db/schema.ts`
   y una migración aditiva — TU tabla, con TU forma. Tabla explícita, no un
   jsonb genérico: unas credenciales tienen forma fija y así conservan tipado e
   índices. Cifra con `@/lib/crypto`, como todos.
4. `src/server/agenda/connectors/index.ts` — una rama en el `switch`.
5. `src/app/api/settings/<id>/route.ts` (+ `test/`) — pegar credenciales,
   **validar contra el proveedor antes de guardar**, exponer solo los últimos 4.
6. `src/app/api/dev/<id>-mock/` — tu mock, con `_state`, `_reset` y un camino
   infeliz determinista.

Cero archivos del motor. Si te encuentras editando `service.ts` o
`availability.ts` para que tu conector funcione, algo se salió del contrato:
levanta un issue antes de forzarlo.

### Cómo sabes que funciona

`tests/unit/connectors.test.ts` es una suite de contrato **compartida**: la
misma para todos. Agrega tu conector ahí y haz que pase — es la definición de
"está bien escrito", y evita descubrir en producción que tu `deleteMeeting`
revienta con un 404 o que tu enlace no sobrevive a un reprogramado.
