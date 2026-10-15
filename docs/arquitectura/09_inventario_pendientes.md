# 09. Inventario técnico, discrepancias y pendientes

## 1. Evidencia disponible

| Estado | Hallazgo | Evidencia |
|---|---|---|
| Verificado en repo | Next.js/React/TypeScript, Drizzle, PostgreSQL 16, Better Auth, Zod, Docker/Caddy | `package.json`, `src/lib/db/schema.ts`, Compose y Dockerfile |
| Verificado en repo | 90 declaraciones `pgTable` | `src/lib/db/schema.ts` |
| Verificado en repo | 63 archivos SQL; 62 entradas del journal | `drizzle/`, `drizzle/meta/_journal.json` |
| Verificado en repo | 181 Route Handlers, 49 páginas, 130 componentes TSX y 164 módulos TS de servidor | Árbol Git de `main` |
| Verificado en repo | CI con typecheck/lint/test/build en una matriz de configuraciones | `.github/workflows/ci.yml` |
| Verificado en repo | Workflow de Docker construye/pública imagen y contiene paso SSH de despliegue | `.github/workflows/docker.yml` |
| Verificado en repo | Compose define app, postgres, caddy y volúmenes persistentes | `docker-compose.yml` |
| Documentado, no revalidado | Se ha utilizado una VM Ubuntu en Azure y dominio de CRM | Manual maestro aportado y comentarios de configuración |
| Pendiente | CPU, RAM, swap, disco, firewall, puertos y estado actual de la VM | No hubo acceso SSH/portal |
| Pendiente | Último run CI/build/deploy y éxito actual | No se consultó el estado de GitHub Actions |
| Pendiente | Credenciales y salud de proveedores, frescura y errores recientes | Requiere sesión de administración/pruebas |
| Pendiente | Último backup y restauración exitosa | No se consultó el sistema de copias |
| Pendiente | Matriz completa de permisos/tenant en los 181 handlers | Revisión por endpoint y pruebas |
| Pendiente | Ubicación del servicio/worker Temporal, si se utiliza | Compose raíz no define servicio Temporal |

## 2. Discrepancias frente a documentación previa

| Tema | Descripción anterior | Repositorio auditado | Conclusión |
|---|---|---|---|
| Tablas | Documento previo habla de 47+ tablas | 90 declaraciones `pgTable` detectadas en `schema.ts` | La cifra anterior quedó desfasada o corresponde a otro snapshot. |
| Migraciones | Documento previo habla de 9 migraciones | 63 archivos SQL y 62 entradas del journal | Usar el estado actual; investigar el salto de numeración antes de cualquier cambio. |
| Despliegue automático | Manual previo indica que CI no despliega al VPS | Workflow actual contiene paso SSH, pull y recreación de app | Documentación anterior desfasada o de otra revisión; el éxito del deploy sigue pendiente. |
| Imagen Docker | Manual previo sugiere nombres de imagen distintos | Workflow y Compose auditados apuntan a `ghostbreakfast69/lumark-crm` | La discrepancia no aparece en el estado actual revisado. |
| MEDIA_DIR | Manual previo dice que Compose no pasa la variable | Compose actual define `MEDIA_DIR` por defecto a `/data/media` y monta el volumen | La nota anterior no coincide con el archivo actual. |
| Supabase | Se consideró previamente como alternativa de almacenamiento | Compose declara PostgreSQL 16 propio con DB `lumark` | No describir Supabase como base actual sin evidencia de otra instancia. |

## 3. Prioridades

### P0 — operación de producción
1. Obtener telemetría en vivo y registrar su fecha.
2. Revisar el último CI/build/deploy y verificar el SHA/tag realmente desplegado.
3. Comprobar backup/restauración de PostgreSQL y el volumen de medios.
4. Medir memoria; los límites de servicio declarados suman 992 MB.
5. Confirmar compatibilidad de migraciones y procedimiento de rollback.

### P1 — seguridad y estabilidad
1. Revisar autorización/tenant en rutas API, exports, webhooks y procesos en segundo plano.
2. Verificar gestión/rotación de secretos y acceso SSH de despliegue.
3. Revisar reproducibilidad del build de Docker frente al lockfile probado por CI.
4. Documentar Temporal si el entorno lo utiliza.
5. Crear healthchecks/alertas por proveedor crítico y sincronizador, además del healthcheck de PostgreSQL.

### P2 — documentación sostenible
1. Automatizar inventario de rutas y métodos HTTP.
2. Ampliar las descripciones de negocio de campos con comentarios insuficientes.
3. Actualizar el manual en cada cambio relevante de esquema/infraestructura.
4. Vincular flujos a tests unitarios/E2E que realmente los prueben.
5. Documentar retención, privacidad, eliminación y recuperación de datos.

## 4. Evidencia requerida para cerrar pendientes

- Salida redactada de `docker compose ps`, `docker stats --no-stream`, `free -h`, `df -h`.
- Versiones reales de Ubuntu, Docker y Compose.
- Estado de DNS/TLS, puertos y reglas de firewall.
- Respuesta local y pública de `/api/health`.
- Resultado del último workflow de CI y despliegue.
- Imagen/tag/digest activos y commit que corre.
- Fecha/ubicación del último backup y evidencia de restauración.
- Resultados de pruebas de autorización entre organizaciones.
- Integraciones habilitadas y fecha de última sincronización.

Que un elemento esté pendiente significa que no se obtuvo evidencia suficiente; no significa que esté fallando.
