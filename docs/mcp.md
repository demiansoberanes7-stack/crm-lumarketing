# MCP del CRM

## Estado actual

El endpoint MCP local es:

```text
/mcp
```

El servidor expone una comprobación `health_check` y herramientas CRM
protegidas por OAuth 2.1. Las herramientas CRM disponibles son `get_profile`,
`list_contacts`, `get_contact`, `get_pipeline`, `list_quotes`, `list_catalog` y
`get_commercial_metrics`.

Las herramientas de escritura (`update_contact`, `move_lead` y
`set_quote_status`) solo se anuncian cuando `MCP_WRITE_ENABLED=true` y además
requieren que el usuario OAuth sea propietario de la organización.

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

ChatGPT descubre el servidor en `https://crm.lumarking.digital/mcp` y su OAuth
en `/.well-known/oauth-protected-resource`. Para el alta manual de OAuth usa
estos valores:

| Campo | Valor |
|---|---|
| Método de registro | CIMD (o DCR si el formulario lo exige y `MCP_DCR_ENABLED=true`) |
| Client ID | `https://chatgpt.com/oauth/client.json` |
| Client Secret | *(vacío — cliente público)* |
| Callback / Redirect URL | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Authorization URL | `https://crm.lumarking.digital/oauth/authorize` |
| Token URL | `https://crm.lumarking.digital/oauth/token` |
| Registration URL | `https://crm.lumarking.digital/oauth/register` (solo con DCR) |
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
# Respaldo opcional si el cliente no usa CIMD:
MCP_DCR_ENABLED=false
MCP_DCR_ALLOWED_HOSTS=chatgpt.com
```

En una instalación detrás de túnel, `MCP_RESOURCE_URL` debe ser el recurso MCP
que OpenAI presenta al cliente. La URL de autorización OAuth debe seguir siendo
alcanzable por el navegador que inicia sesión; Secure MCP Tunnel no convierte
automáticamente el servidor OAuth en público.

## Escritura (opcional)

Con `MCP_WRITE_ENABLED=true` el servidor anuncia las tres herramientas de
escritura (`update_contact`, `move_lead`, `set_quote_status`), pero cada
llamada sigue exigiendo token, scope de escritura y rol `owner`.

