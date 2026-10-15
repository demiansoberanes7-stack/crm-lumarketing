# 06. Manual de máquina virtual e infraestructura

## 1. Lo que sí sabemos

El repositorio define un despliegue con Docker Compose y tres servicios: `app`, `postgres` y `caddy`. El manual proporcionado registra una VM Ubuntu en Azure y un dominio, pero esos datos son inventario histórico. En esta auditoría no se abrió SSH ni se consultó el portal Azure; no se puede certificar el tamaño, estado, IP, firewall, DNS ni recursos actuales.

## 2. Contenedores configurados

| Componente | Configuración del repositorio | Papel |
|---|---|---|
| app | `ghostbreakfast69/lumark-crm:latest`; puerto interno 3000; límite 512 MB | Next.js standalone y handlers de API. |
| postgres | `postgres:16-alpine`; base `lumark`; límite 384 MB | Datos del CRM. |
| caddy | `caddy:2-alpine`; publica 80/443; límite 96 MB | Proxy inverso y TLS. |
| `media_data` | Montado en `/data/media` | Medios/archivos persistentes. |
| `postgres_data` | Volumen de PostgreSQL | Datos relacionales persistentes. |
| `caddy_data`, `caddy_config` | Volúmenes de Caddy | Estado/configuración del proxy. |

Los límites de memoria declarados suman **992 MB** (512 + 384 + 96). El Compose comenta un objetivo histórico de VM de 1 GiB y swap; si ese tamaño aún se usa, el margen para sistema operativo y Docker sería muy limitado. Verificar el SKU y medir memoria real antes de decidir una ampliación.

## 3. Red

~~~mermaid
flowchart LR
  Internet -->|80/443| Caddy
  Caddy -->|app:3000| App[Next.js]
  App -->|postgres:5432 en red Compose| DB[(PostgreSQL)]
  App -->|HTTPS saliente| Ext[Proveedores externos]
~~~

El Compose revisado no publica el puerto 5432 de PostgreSQL al host. Esto describe el Compose, no todas las reglas de red/firewall externas.

## 4. Arranque del contenedor

El Dockerfile usa Node 22 Alpine y una compilación multietapa de Next.js standalone. Al iniciar, el contenedor ejecuta `node migrate.mjs && node server.js`; por tanto, un despliegue puede aplicar migraciones antes de levantar la app. El healthcheck del contenedor consulta `/api/health`, ruta que ejecuta `SELECT 1` contra la base y devuelve 503 si no está disponible.

Antes de publicar una versión nueva, respalda datos, prueba las migraciones sobre una copia y revisa compatibilidad con la versión anterior.

## 5. Variables principales

El archivo `.env.example` usa valores marcador, no credenciales operativas.

| Grupo | Variables representativas |
|---|---|
| Dominio | `APP_BASE_URL`, `DOMAIN` |
| PostgreSQL | `DATABASE_URL`, `POSTGRES_PASSWORD` |
| Sesiones/cifrado | `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` |
| Meta/webhooks | `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `META_GRAPH_API_VERSION` |
| WAHA | `WAHA_BASE_URL`, `WAHA_API_KEY` |
| Proveedor LLM | `OPENROUTER_API_TOKEN`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL` |
| Canales/flags | `CHANNELS`, `WHATSAPP_ZERNIO_ENABLED`, `AGENDA`, `GOOGLE_BUSINESS`, `ATRIBUCION`, `INTEL` |
| Archivos | `MEDIA_DIR` |
| Bot/hosts | `BOT_API_KEY`, `WAHA_TRUSTED_HOSTS`, `WEBHOOK_TRUSTED_HOSTS` |
| Agenda auxiliar | `TEMPORAL_ADDRESS` |

Verifica siempre las variables que consume el código actual; añadir un valor al archivo local no garantiza que Compose lo transmita al contenedor.

## 6. Diagnóstico de solo lectura

Ejecutar en el VPS, desde la carpeta que contiene el Compose. No se ejecutó durante la auditoría.

~~~bash
docker compose ps
docker stats --no-stream
free -h
df -h
ss -lntup
systemctl --type=service --state=running
docker compose logs --tail=100 app
docker compose logs --tail=100 postgres
docker compose logs --tail=100 caddy
docker compose exec -T app wget -q -O- http://127.0.0.1:3000/api/health
docker compose exec -T postgres pg_isready -U postgres
~~~

Evita compartir la salida completa de `docker compose config`, porque puede expandir variables que contengan secretos.

## 7. Workflow de build/deploy

`.github/workflows/docker.yml` construye y publica la imagen `ghostbreakfast69/lumark-crm` y contiene un paso SSH que modifica ajustes de IA en el `.env` del VPS, hace `docker compose pull app`, recrea el servicio `app` y espera `/api/health`. La ejecución depende de que los secretos de GitHub Actions existan y funcionen. El YAML no prueba que el último despliegue haya sido exitoso.

Se deben comprobar los runs de CI y Docker para el commit exacto, el tag/digest desplegado, y los secretos `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_PATH` y las variables de IA sin mostrar sus valores.

## 8. Backup y rollback

Una recuperación completa debe cubrir por separado:
- PostgreSQL.
- `/data/media`.
- Compose/Caddyfile y la configuración necesaria almacenada de forma segura.
- Imagen o tag anterior y SHA del commit.
- Compatibilidad de la base con la versión a restaurar.

No se debe asumir rollback seguro de aplicación cuando ya se aplicó una migración incompatible. Ensaya restauraciones en entorno aislado; una copia no verificada no demuestra recuperación.
