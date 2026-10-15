# MCP del CRM

## Estado actual

El endpoint MCP local es:

```text
/mcp
```

El servidor expone una comprobación pública `health_check` y herramientas CRM
protegidas por OAuth. Las herramientas CRM disponibles son `get_profile`,
`list_contacts`, `get_contact`, `get_pipeline`, `list_quotes`, `list_catalog` y
`get_commercial_metrics`.

Las herramientas de escritura (`update_contact`, `move_lead` y
`set_quote_status`) solo se anuncian cuando `MCP_WRITE_ENABLED=true` y además
requieren que el usuario OAuth sea propietario de la organización.

No se debe publicar este endpoint en producción todavía. Antes de exponer
datos del CRM se añadirá OAuth 2.1 y aislamiento por organización.

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

En MCP Inspector se selecciona `Streamable HTTP` y se introduce una de las
URLs anteriores. Se debe comprobar que:

1. La inicialización termina correctamente.
2. Aparece `health_check`.
3. La herramienta devuelve `status: "ok"`.
4. La respuesta indica `readOnly: true`.

## Conexión temporal con ChatGPT

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
```

En una instalación detrás de túnel, `MCP_RESOURCE_URL` debe ser el recurso MCP
que OpenAI presenta al cliente. La URL de autorización OAuth debe seguir siendo
alcanzable por el navegador que inicia sesión; Secure MCP Tunnel no convierte
automáticamente el servidor OAuth en público.

## Próxima fase

Antes de añadir `list_contacts` o cualquier otra consulta real se implementará:

- OAuth 2.1 compatible con la autorización MCP.
- Scopes de solo lectura.
- Resolución de usuario y `organizationId` desde el token.
- Validación de issuer, audience, expiración y scopes.
- Pruebas de aislamiento entre organizaciones.

Cuando lectura y aislamiento estén probados, se puede activar `MCP_WRITE_ENABLED`
en un entorno controlado. El servidor entonces anuncia las tres herramientas
de escritura, pero cada llamada sigue exigiendo token, scope y rol `owner`.
