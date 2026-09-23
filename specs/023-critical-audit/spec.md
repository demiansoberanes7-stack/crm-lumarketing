# Correcciones críticas de auditoría

Carril: ciclo completo (incluye migración correctiva). Escrito antes del código.

## Problema y alcance
La auditoría detectó consultas del dashboard que trasladan tablas completas a Node,
una diferencia entre el FK de reservas declarado y las migraciones, llamadas a Meta
sin plazo máximo y ausencia de pantallas de recuperación propias.

## Criterios de aceptación
- Un fallo de render ofrece reintentar y volver al inicio sin mostrar detalles internos.
- Un fallo del layout raíz tiene una pantalla independiente de BD/branding.
- Meta termina llamadas bloqueadas (incluido el cuerpo) en 20 segundos con MetaApiError;
  no reenvía automáticamente operaciones que pudieran haberse ejecutado.
- Eliminar un contacto conserva su reserva y deja contact_id nulo. La migración
  funciona sobre instalaciones existentes y nuevas, y es reejecutable.
- Dashboard conserva contrato, períodos UTC, centavos, exclusión de pruebas y moneda,
  saldos ajustados por pagos futuros, y aislamiento de organización.
- PostgreSQL agrega los indicadores; Node recibe agregados, no entidades completas.
- Verificación: gate técnico, PostgreSQL aislado, comparación con calculador de
  referencia y navegador (camino feliz y recuperación de fallo).

## Correcciones de la auditoría
- .env y .env.local están ignorados, no versionados y no aparecen en el historial
  Git local consultado. No se ha demostrado una exposición en Git.
- La divergencia de reservas está confirmada en las migraciones, no inspeccionada
  en producción; no se afirma que ya se haya producido pérdida de datos.
- Next.js ya divide bundles por ruta; no usar next/dynamic no significa que todas
  las bibliotecas se carguen en todas las páginas.

## Fuera de esta entrega
Despliegue, reparación global de snapshots Drizzle, rediseño, colas, rate limiting,
auditoría de cambios y paginación del inbox se gestionan aparte. No cambiar las
fórmulas de negocio para ocultar el coste mediante límites arbitrarios de filas.
