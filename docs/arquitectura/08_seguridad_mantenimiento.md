# 08. Seguridad, operación y mantenimiento

## 1. Alcance

Este documento resume controles visibles en código/configuración y riesgos que requieren validación. Es una revisión estática, no una prueba de penetración. No se certifica la seguridad del sistema ni del servidor activo.

## 2. Controles visibles

| Área | Evidencia | Límite de comprobación |
|---|---|---|
| Autenticación | Better Auth y ruta catch-all de auth | Revisar cada ruta, roles, sesiones y expiración. |
| Aislamiento por organización | `organizationId` en el esquema y helper `scoped()` | No prueba que todas las consultas/jobs/exportaciones estén delimitados. |
| Validación de entradas | Uso de Zod en handlers revisados | No se inspeccionaron exhaustivamente los 181 handlers. |
| Cifrado de credenciales | `ENCRYPTION_KEY`, módulos crypto y migración de credenciales cifradas | No se probó configuración real, rotación ni descifrado en producción. |
| Secretos de despliegue | `.env.example` con marcadores y referencias a GitHub Secrets | No se inspeccionó el valor ni existencia actual de los secretos. |
| Usuario de contenedor | Dockerfile crea usuario `lumark` y usa `USER lumark` | Verificar permisos reales de volúmenes y la imagen desplegada. |
| Base de datos interna | Compose no publica puerto del servicio PostgreSQL al host | Verificar reglas externas, procesos y firewall real. |
| Healthcheck | `/api/health` ejecuta `SELECT 1` | No valida proveedores, IA, mensajería, pollers ni todos los módulos. |
| Redacción de logs | Existe `src/server/diagnostics/redact.ts` | Confirmar que los nuevos campos se redacten correctamente. |
| CI | `ci.yml` declara permiso `contents: read` | El workflow de publicación tiene acceso a secretos de deploy. |

## 3. Riesgos y acciones recomendadas

| Prioridad | Evidencia/riesgo | Impacto posible | Acción recomendada |
|---|---|---|---|
| Alta | Dockerfile ejecuta `node migrate.mjs` antes de arrancar el servidor. | Una migración fallida o incompatible puede impedir el inicio o dificultar el rollback. | Probar migraciones en copia de datos, respaldar antes del despliegue y documentar migraciones destructivas. |
| Alta | Workflow Docker despliega por SSH y escribe variables en el `.env` remoto. | Secretos/configuración defectuosos pueden interrumpir el servicio; una llave SSH excesiva amplía el impacto. | Limitar cuenta/llave al mínimo, revisar runs, mantener acceso de emergencia y no imprimir secretos. |
| Alta | Límites de memoria Compose suman 992 MB y los comentarios señalan objetivo de VM de 1 GiB. | Poca memoria libre para SO, Docker y picos; riesgo de OOM/reinicio. | Medir RAM/swap en vivo; evaluar ajuste o ampliación según métricas, no por intuición. |
| Media | El Dockerfile usa `pnpm install --no-frozen-lockfile`, mientras el workflow CI usa `--frozen-lockfile`. | Imagen construida con dependencias potencialmente distintas de las probadas. | Evaluar reproducibilidad y alinear instalación solo después de probarlo en rama separada. |
| Media | Journal/archivos visibles tienen salto en numeración de migraciones después de 0061. | Confusión operativa al comparar versiones de esquema. | Revisar historial Git y tabla de migraciones; no renombrar archivos como arreglo cosmético. |
| Media | Código/dependencias contienen módulos de Temporal, pero Compose raíz no define servicio Temporal. | Una funcionalidad configurada puede depender de infraestructura externa no identificada. | Confirmar dirección del servicio, dónde ejecutan workers y responsabilidades operativas. |
| Media | Salud HTTP comprueba conexión a PostgreSQL nada más. | La instancia puede figurar saludable mientras falla un proveedor externo. | Monitorear por separado integraciones críticas, frescura de datos, colas y webhooks. |
| Media | 181 Route Handlers suponen superficie amplia. | Diferencias de validación/autorización o aislamiento podrían pasar inadvertidas. | Crear matriz de permisos por familia, pruebas de tenant y revisión de métodos/rate limits. |

La prioridad es una clasificación de ingeniería basada en el tipo de impacto; no es una puntuación cuantitativa de explotación.

## 4. Operación rutinaria

### Antes y después de cada despliegue
- Revisar el run CI/build/deploy del commit esperado.
- Confirmar la imagen/tag/digest que se descargará.
- Verificar espacio y memoria.
- Confirmar respaldo reciente de PostgreSQL y medios.
- Revisar estado de servicios y `/api/health`.
- Comprobar logs recientes y errores de integraciones sin revelar datos sensibles.

### Mantenimiento periódico
- Ensayar una restauración en entorno aislado.
- Revisar dependencias y avisos de seguridad.
- Revisar permisos de GitHub Actions, tokens y llaves SSH.
- Validar separación por organización en endpoints, exports y jobs.
- Confirmar retención/borrado de datos personales y políticas de logs.
- Documentar cambios en variables, proveedores y tamaño de VM.

## 5. Comandos de inspección

Ejecutar en el VPS, sin alterar servicios:

~~~bash
docker compose ps
docker stats --no-stream
free -h
df -h
docker compose logs --tail=100 app
docker compose logs --tail=100 postgres
docker compose logs --tail=100 caddy
docker compose exec -T app wget -q -O- http://127.0.0.1:3000/api/health
~~~

No publiques la salida de comandos que revelen variables, tokens, teléfonos, emails o contenido de conversaciones.

## 6. Política de respaldo/recuperación

El plan debe cubrir por separado PostgreSQL, `/data/media`, la configuración necesaria almacenada en secreto y el tag/commit de la aplicación. Definir RPO/RTO, retención, cifrado, responsable operativo y calendario de pruebas. Solo una restauración demostrada permite afirmar que los respaldos son recuperables.

Antes de restaurar:
1. Confirmar entorno y destino exacto.
2. Conservar el estado actual y evidencia del incidente.
3. Comprobar compatibilidad del esquema con la aplicación.
4. Evitar que un procedimiento de prueba sobrescriba producción.
5. Ejecutar pruebas funcionales antes de cambiar el tráfico.

## 7. Reglas para registros y evidencias

No almacenar tokens, claves privadas, cookies, contraseñas, DATABASE_URL completa, contenido entero de conversaciones o datos personales innecesarios. En tickets y capturas utiliza IDs de prueba o información anonimizada.
