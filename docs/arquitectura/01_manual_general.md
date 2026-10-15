# 01. Manual general del proyecto

## 1. Qué es LUMARK CRM

LUMARK CRM es una aplicación web full-stack basada en Next.js. Reúne conversaciones y mensajería multicanal, contactos, oportunidades de venta, pipeline Kanban, cotizaciones, proyectos/tareas, agenda, finanzas, catálogo/inventario, proveedores, integraciones, analítica y módulos de IA. El código incluye separación de datos por organización (*multi-tenancy*).

## 2. Inventario comprobado en el commit auditado

| Elemento | Hallazgo |
|---|---:|
| Declaraciones `pgTable` en `src/lib/db/schema.ts` | 90 |
| Archivos SQL de migración | 63 |
| Entradas del journal de Drizzle | 62 |
| Route Handlers `route.ts` bajo `src/app/api` | 181 |
| Páginas `page.tsx` | 49 |
| Componentes TSX bajo `src/components` | 130 |
| Módulos TypeScript bajo `src/server` | 164 |

Son conteos del repositorio, no pruebas de que todas las funciones estén activas en el servidor. La numeración de migraciones llega a 0063, con un salto visible después de 0061; el journal también debe revisarse antes de tocar esa secuencia.

## 3. Tecnologías

| Tecnología | Uso comprobado en los manifiestos/configuración |
|---|---|
| Next.js 15, React 19, TypeScript | Aplicación web full-stack y UI |
| Tailwind CSS 3 | Estilos |
| Node.js 22 Alpine | Imagen runtime del Dockerfile |
| PostgreSQL 16 Alpine | Servicio principal de datos en Compose |
| Drizzle ORM / Drizzle Kit y postgres.js | Esquema, consultas y migraciones |
| Better Auth | Autenticación y organizaciones |
| Zod | Validación de entradas en handlers |
| Vitest y Playwright | Herramientas de prueba declaradas |
| Docker Compose | Servicios app, postgres y caddy |
| Caddy 2 | Proxy inverso y HTTPS |
| pnpm | Gestor declarado en package.json |
| Recharts, lucide-react y dnd-kit | Gráficas, iconos e interacción |

## 4. Arquitectura lógica

- **Frontend:** páginas en `src/app` y componentes reutilizables en `src/components`.
- **API HTTP:** Route Handlers en `src/app/api`.
- **Lógica de negocio:** módulos en `src/server` para inbox, canales, leads, cotizaciones, finanzas, IA, agenda, campañas e integraciones.
- **Bibliotecas/configuración:** `src/lib` y `src/config`, incluidos esquema de BD, autenticación, cifrado, validación y banderas.
- **Datos:** PostgreSQL mediante Drizzle, con esquema fuente en `src/lib/db/schema.ts`.
- **Infraestructura:** `Dockerfile`, `docker-compose.yml`, `Caddyfile` y workflows de GitHub Actions.

## 5. Módulos principales

| Área | Archivos de referencia |
|---|---|
| Dashboard y analítica | `src/app/(app)/dashboard`, `src/app/(app)/analytics`, `src/server/dashboard`, `src/server/analytics` |
| Inbox y mensajería | `src/server/inbox`, `src/server/whatsapp`, `src/server/instagram`, `src/server/messenger`, `src/server/tiktok`, `src/server/waha` |
| Contactos y pipeline | `src/server/contacts.ts`, `src/server/leads`, `src/lib/acquisition-channel.ts` |
| Cotizaciones | `src/server/quotes`, tablas `quote`, `quote_item`, `quote_event` |
| Comercial/marketing | `src/server/commercial`, `src/server/ads`, `src/server/attribution`, `src/server/metrics` |
| Finanzas | `src/server/finances`, tablas de gastos, pagos y cargos |
| Proyectos/agenda/tareas | `src/server/projects`, `src/server/agenda`, `src/server/caltodo` |
| Agente/Laboratorio | `src/server/ai`, `src/server/lab` |
| Inteligencia | `src/server/intel` |
| Email e integraciones | `src/server/email`, `src/server/integrations.ts` |

La existencia de un módulo no confirma que esté conectado ni habilitado en el entorno de producción.

## 6. Flujo típico de una solicitud

1. El usuario navega o interactúa con la interfaz React.
2. La UI solicita datos a un endpoint o acción del servidor.
3. El Route Handler aplica autenticación y validación según el caso.
4. La operación se delega a `src/server`.
5. La lógica consulta o modifica PostgreSQL por medio de Drizzle.
6. El servidor responde con JSON o un error HTTP.
7. La UI actualiza su estado; para cambios en vivo el proyecto incluye SSE.

## 7. Separación por organización

`src/lib/db/tenant.ts` exporta `scoped()`, que exige un `organizationId` no vacío y añade el filtro a la consulta. Se observa en `src/app/api/pipeline/board/route.ts`. Es un patrón importante, pero no prueba que todas las 181 rutas y todos los procesos de fondo respeten el aislamiento: eso requiere revisar cada consulta.

## 8. Infraestructura y límites

El Compose de producción define `app`, `postgres` y `caddy`; PostgreSQL se usa como servicio interno y Caddy publica 80/443. El workflow Docker construye y publica la imagen y contiene un paso de despliegue remoto por SSH. Su presencia en YAML no garantiza que los secretos estén configurados ni que la última ejecución haya sido exitosa.

No se conectó a la VM ni a PostgreSQL de producción, no se ejecutaron tests y no se verificaron DNS, firewall, recursos, proveedores ni respaldos. Para esos puntos, consulta los manuales 06, 08 y 09.
