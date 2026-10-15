# 04. Manual técnico del frontend

## 1. Arquitectura

La interfaz está dentro de Next.js App Router; no aparece un frontend separado en otro proyecto raíz. Las páginas están bajo `src/app`, los componentes reutilizables bajo `src/components`, y la configuración de navegación principal se centraliza en `src/config/nav.ts`.

Tecnologías declaradas: React 19, TypeScript, Tailwind CSS 3; Recharts para gráficas, lucide-react para iconografía y bibliotecas de arrastre para elementos interactivos.

## 2. Navegación principal

`src/config/nav.ts` define estas entradas:

| Ruta | Etiqueta |
|---|---|
| /dashboard | Dashboard |
| /inbox | Bandeja |
| /pipeline | Pipeline |
| /contacts | Contactos |
| /balance | Balance |
| /quotes | Cotizador |
| /catalog | Inventario |
| /projects | Proyectos |
| /broadcasts | Envíos masivos |
| /suppliers | Proveedores |
| /todo | Pendientes |
| /lab | Laboratorio |
| /inteligencia | Inteligencia |
| /copiloto | Copiloto |
| /settings | Ajustes |

Puede haber páginas secundarias, accesibles desde ajustes o subrutas, que no figuran en la navegación principal.

## 3. Mapa de archivos de página

Los grupos entre paréntesis son grupos de rutas de Next.js, no segmentos de URL. Las rutas marcadas con `[id]` representan identificadores dinámicos.

| Ruta estimada | Archivo |
|---|---|
| / | `src/app/page.tsx` |
| /agent | `src/app/(app)/agent/page.tsx` |
| /analytics | `src/app/(app)/analytics/page.tsx` |
| /automations | `src/app/(app)/automations/page.tsx` |
| /balance | `src/app/(app)/balance/page.tsx` |
| /bookings | `src/app/(app)/bookings/page.tsx` |
| /broadcasts | `src/app/(app)/broadcasts/page.tsx` |
| /catalog | `src/app/(app)/catalog/page.tsx` |
| /commercial | `src/app/(app)/commercial/page.tsx` |
| /contacts | `src/app/(app)/contacts/page.tsx` |
| /copiloto | `src/app/(app)/copiloto/page.tsx` |
| /dashboard | `src/app/(app)/dashboard/page.tsx` |
| /email | `src/app/(app)/email/page.tsx` |
| /inbox | `src/app/(app)/inbox/page.tsx` |
| /inteligencia | `src/app/(app)/inteligencia/page.tsx` |
| /lab | `src/app/(app)/lab/page.tsx` |
| /pipeline | `src/app/(app)/pipeline/page.tsx` |
| /projects | `src/app/(app)/projects/page.tsx` |
| /quotes | `src/app/(app)/quotes/page.tsx` |
| /settings | `src/app/(app)/settings/page.tsx` |
| /settings/ads | `src/app/(app)/settings/ads/page.tsx` |
| /settings/agent | `src/app/(app)/settings/agent/page.tsx` |
| /settings/branding | `src/app/(app)/settings/branding/page.tsx` |
| /settings/business | `src/app/(app)/settings/business/page.tsx` |
| /settings/calendar | `src/app/(app)/settings/calendar/page.tsx` |
| /settings/connections | `src/app/(app)/settings/connections/page.tsx` |
| /settings/copiloto | `src/app/(app)/settings/copiloto/page.tsx` |
| /settings/data-cleanup | `src/app/(app)/settings/data-cleanup/page.tsx` |
| /settings/diagnostics | `src/app/(app)/settings/diagnostics/page.tsx` |
| /settings/email | `src/app/(app)/settings/email/page.tsx` |
| /settings/google-business | `src/app/(app)/settings/google-business/page.tsx` |
| /settings/google | `src/app/(app)/settings/google/page.tsx` |
| /settings/instagram | `src/app/(app)/settings/instagram/page.tsx` |
| /settings/intel | `src/app/(app)/settings/intel/page.tsx` |
| /settings/marketing | `src/app/(app)/settings/marketing/page.tsx` |
| /settings/mercado-libre | `src/app/(app)/settings/mercado-libre/page.tsx` |
| /settings/messenger | `src/app/(app)/settings/messenger/page.tsx` |
| /settings/team | `src/app/(app)/settings/team/page.tsx` |
| /settings/tiktok | `src/app/(app)/settings/tiktok/page.tsx` |
| /settings/waha | `src/app/(app)/settings/waha/page.tsx` |
| /settings/webhooks | `src/app/(app)/settings/webhooks/page.tsx` |
| /settings/whatsapp | `src/app/(app)/settings/whatsapp/page.tsx` |
| /settings/zernio | `src/app/(app)/settings/zernio/page.tsx` |
| /suppliers | `src/app/(app)/suppliers/page.tsx` |
| /tareas | `src/app/(app)/tareas/page.tsx` |
| /todo | `src/app/(app)/todo/page.tsx` |
| /watsi | `src/app/(app)/watsi/page.tsx` |
| /login | `src/app/(auth)/login/page.tsx` |
| /register | `src/app/(auth)/register/page.tsx` |

## 4. Cómo viajan los datos

1. La página monta componentes de un dominio, por ejemplo `src/components/pipeline`.
2. El componente solicita o modifica datos usando la API/acción asociada.
3. Un Route Handler en `src/app/api` procesa la solicitud.
4. El handler valida sesión y entrada según corresponda y delega en `src/server`.
5. La respuesta vuelve como JSON y la UI actualiza su estado.

Para evitar inconsistencias, las reglas de negocio y acceso a datos deben permanecer en el servidor, no duplicarse como lógica exclusiva en el navegador.

## 5. Estados que hay que verificar al mantener una pantalla

- Cargando, datos presentes y estado vacío.
- Error HTTP, pérdida de conexión y reintento.
- Sesión caducada y acceso denegado.
- Validación de formulario antes y después de enviar.
- Actualización concurrente o registro ya cambiado.
- Vista responsiva y navegación por teclado.

El repo contiene componentes comunes de shell/navegación, recuperación de errores, hooks de eventos y carpetas de componentes por dominio. No debe asumirse que todas las páginas implementan todos los estados de manera idéntica.

## 6. Eventos y tiempo real

El código incluye eventos SSE, y `Caddyfile` establece `flush_interval -1` para no acumular el flujo de eventos en el proxy. SSE transmite del servidor hacia el navegador; la UI necesita manejar reconexión y volver a consultar el estado cuando se pierde el stream.

## 7. Checklist de cambios de frontend

1. Identifica page.tsx y componentes importados.
2. Localiza el contrato de API consumido.
3. Verifica el handler y servicio backend relacionado.
4. Comprueba la tabla/entidad involucrada.
5. Añade o actualiza una prueba.
6. Ejecuta `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` en desarrollo.
7. Prueba la pantalla en navegador con datos de prueba.

Los comandos están definidos por `package.json`; esta auditoría no los ejecutó.
