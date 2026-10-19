# MCP del CRM

## Estado actual

El endpoint MCP local es:

```text
/mcp
```

El servidor expone una comprobación `health_check` y herramientas CRM
protegidas por OAuth 2.1. Las herramientas CRM de lectura son `get_profile`,
`list_contacts`, `get_contact`, `get_pipeline`, `list_quotes`, `list_catalog` y
`get_commercial_metrics`.
### Registro de acciones y meta-herramientas

Además de las herramientas nativas, el servidor publica tres meta-herramientas
que operan sobre un **registro de acciones** (`src/server/mcp/registry.ts`):

| Herramienta | Qué hace |
|---|---|
| `actions_list` | Lista las acciones disponibles para el token (filtro por texto o dominio) |
| `actions_describe` | Devuelve descripción y esquema JSON de argumentos de una acción |
| `actions_run` | Ejecuta una acción por nombre (`{ name, args }`) |

Cada acción declara `domain`, `kind` (`read`/`write`/`delete`/`send`/`admin`),
`scope`, bandera `destructive` y su handler sobre un servicio ya existente del
CRM (`src/server/mcp/actions/`). Así el LLM ve pocas herramientas nativas pero
puede operar todo el sistema. Dominios registrados:

| Dominio | Acciones |
|---|---|
| contactos | `contacts.create`, `contacts.update`, `contacts.add_note`, `contacts.delete`, `contacts.get` |
| pipeline | `pipeline.update_lead` (mover etapa + monto + prioridad) |
| cotizaciones | `quotes.create`, `quotes.update`, `quotes.set_status`, `quotes.archive`, `quotes.unarchive`, `quotes.delete`, `quotes.list`, `quotes.get`, `quotes.send` |
| catálogo | `catalog.list`, `catalog.get`, `catalog.create`, `catalog.update` |
| bandeja | `conversations.list`, `messages.list`, `messages.send` |
| correo | `email.accounts`, `email.send` |
| ajustes | `settings.get`, `members.list`, `connections.status` |
| admin | `admin.audit_list` |

Las herramientas nativas de escritura (`create_contact`, `update_contact`,
`create_quote`, `move_lead`, `set_quote_status`), de borrado
(`delete_contact`), de envío (`send_message`, `send_quote`, `send_email`) y la
de administración (`list_audit`, bitácora MCP) ejecutan el mismo registro:
mismo gate, misma auditoría, misma lógica que la API interna (servicios
compartidos en `server/contacts.ts`, `server/leads/service.ts`,
`server/quotes/service.ts`, `server/catalog/service.ts`, `server/inbox/send.ts`,
`server/email/service.ts`, `server/connections/status.ts`,
`server/business-settings.ts`)
— sin datos huérfanos: todo contacto creado desde ChatGPT nace con su lead,
nota y webhook, igual que la UI, y todo envío respeta sandbox del Laboratorio
(las conversaciones de prueba jamás tocan la API real) y la ventana de
respuesta de cada canal.

### Tiers y auditoría

| Tier | Bandera | Scopes | Efecto |
|---|---|---|---|
| lectura | *(siempre)* | `crm.*.read` (incl. `crm.settings.read`) | herramientas de consulta |
| escritura | `MCP_WRITE_ENABLED=true` | `crm.contacts.write`, `crm.pipeline.write`, `crm.quotes.write`, `crm.catalog.write` | `create_contact`, `update_contact`, `create_quote`, `move_lead`, `set_quote_status` |
| borrado | `MCP_DELETE_ENABLED=true` | `crm.contacts.delete`, `crm.quotes.delete` | `delete_contact`, `contacts.delete`, `quotes.delete` |
| envío | `MCP_SEND_ENABLED=true` | `crm.messages.send`, `crm.quotes.send`, `crm.email.send` | `send_message`, `send_quote`, `send_email` |
| admin | `MCP_ADMIN_ENABLED=true` | `crm.audit.read` | `list_audit`, `admin.audit_list` (bitácora de acciones MCP) |

Toda acción no-lectura exige además rol `owner` en la organización y queda
auditada en la tabla `mcp_action_audit` (organización, usuario, cliente OAuth,
acción, entrada y resultado, truncados). La retención se controla con
`MCP_AUDIT_RETENTION_DAYS` (180 por defecto). El mantenimiento in-process
(`src/server/mcp/maintenance.ts`) poda cada hora códigos, tokens caducados,
auditoría vieja y clientes DCR muertos; se desactiva con
`MCP_MAINTENANCE_ENABLED=false`.

**Las credenciales e integraciones nunca son accionables desde MCP**: no hay
acción ni herramienta para leer o escribir secretos; siguen viviendo solo en
la UI del CRM.

El endpoint MCP exige OAuth para toda petición: sin token responde `401` con
`WWW-Authenticate: Bearer resource_metadata="..."`, que es lo que ChatGPT usa
para iniciar el flujo de autorización. La autorización soporta **CIMD** (Client
ID Metadata Document, `client_id_metadata_document_supported: true`) y, como
respaldo, **DCR** (Dynamic Client Registration, apagado por defecto tras
`MCP_DCR_ENABLED=true`). No se implementa OIDC (`id_token`/`userinfo`).

## Prueba local

El proceso Next.js debe estar levantado con la configuración local del CRM y
PostgreSQL disponible. Con `pnpm dev`, la URL es:

```text
http://localhost:3000/mcp
```

Con `docker-compose.local.yml`, la URL desde el equipo anfitrión es:

```text
http://localhost:3100/mcp
```

Para inspeccionar el servidor:

```bash
npx @modelcontextprotocol/inspector@latest
```

En MCP Inspector se selecciona `Streamable HTTP`, se introduce una de las
URLs anteriores y se completa el flujo OAuth (el endpoint exige token). Se debe
comprobar que:

1. Sin token, la petición devuelve `401` con `WWW-Authenticate`.
2. Tras autorizar, la inicialización termina correctamente.
3. Aparecen las herramientas CRM (`health_check`, `list_contacts`, etc.).
4. `health_check` devuelve `status: "ok"` y `readOnly: true`.

## Conexión con ChatGPT (registro manual)

ChatGPT descubre el servidor en `https://crm.lumarketing.digital/mcp` y su OAuth
en `/.well-known/oauth-protected-resource`. Para el alta manual de OAuth usa
estos valores:

| Campo | Valor |
|---|---|
| Método de registro | CIMD (o DCR si el formulario lo exige y `MCP_DCR_ENABLED=true`) |
| Client ID | `https://chatgpt.com/oauth/client.json` |
| Client Secret | *(vacío — cliente público)* |
| Callback / Redirect URL | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Authorization URL | `https://crm.lumarketing.digital/oauth/authorize` |
| Token URL | `https://crm.lumarketing.digital/oauth/token` |
| Registration URL | `https://crm.lumarketing.digital/oauth/register` (solo con DCR) |
| Scopes | `crm.profile.read crm.contacts.read crm.metrics.read` |
| OIDC | No |

## Conexión temporal con ChatGPT (túnel)

Para un servidor local se debe usar un Secure MCP Tunnel. El túnel apunta
internamente al endpoint local, por ejemplo:

```text
http://localhost:3100/mcp
```

En ChatGPT se selecciona `Conexión -> Túnel` y se elige el `tunnel_id`
asociado al workspace. El proceso `tunnel-client` debe permanecer activo
mientras se prueba el plugin.

Una URL pública solo se utilizará después del despliegue HTTPS, por ejemplo:

```text
https://crm.example.com/mcp
```

No se debe introducir `localhost` en la opción `URL del servidor`, porque
ChatGPT no puede acceder directamente al equipo local mediante esa opción.

## Variables de entorno

Configura las variables MCP en el entorno del servidor. No compartas sus
valores por chat. Para lectura deja la escritura apagada:

```text
MCP_RESOURCE_URL=https://crm.example.com/mcp
MCP_AUTH_BASE_URL=https://crm.example.com
MCP_OAUTH_ISSUER=https://crm.example.com/oauth
MCP_WRITE_ENABLED=false
MCP_DELETE_ENABLED=false
MCP_SEND_ENABLED=false
MCP_ADMIN_ENABLED=false
# Auditoría y mantenimiento:
MCP_AUDIT_RETENTION_DAYS=180
MCP_MAINTENANCE_ENABLED=true
# Respaldo opcional si el cliente no usa CIMD:
MCP_DCR_ENABLED=false
MCP_DCR_ALLOWED_HOSTS=chatgpt.com
```

En una instalación detrás de túnel, `MCP_RESOURCE_URL` debe ser el recurso MCP
que OpenAI presenta al cliente. La URL de autorización OAuth debe seguir siendo
alcanzable por el navegador que inicia sesión; Secure MCP Tunnel no convierte
automáticamente el servidor OAuth en público.

## Escritura, borrado, envío y admin (opcionales)

Con `MCP_WRITE_ENABLED=true` se anuncian `create_contact`, `update_contact`,
`create_quote`, `move_lead` y `set_quote_status`; con `MCP_DELETE_ENABLED=true`,
`delete_contact`, `contacts.delete` y `quotes.delete`; con
`MCP_SEND_ENABLED=true`, `send_message`, `send_quote` y `send_email`
(+ `crm.conversations.read`/`crm.email.read` para elegir destino); con
`MCP_ADMIN_ENABLED=true`, `list_audit` (bitácora de acciones MCP, filtrable por
acción y resultado). En todos los casos cada llamada sigue exigiendo token, el
scope del tier y rol `owner`, y la ejecución queda auditada en
`mcp_action_audit` vía `actions_run` o la herramienta nativa. Los tiers apagados
no anuncian herramientas ni aceptan `actions_run` sobre esas acciones.

Las lecturas de ajustes (`settings.get`, `members.list`, `connections.status`)
viven en el tier de lectura con scope `crm.settings.read` (siempre disponible,
como el resto de `crm.*.read`) y cubren datos del negocio, equipo e estado de
integraciones — solo banderas de estado e identificadores públicos, nunca
secretos.

