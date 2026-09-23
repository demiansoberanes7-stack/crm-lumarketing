# Tareas

- [x] Confirmar hallazgos e imprecisiones de auditoría.
- [x] Recuperación UI.
- [x] Timeout de Meta y regresiones.
- [x] Migración y prueba de conservación de reservas.
- [x] Agregados dashboard y equivalencia con referencia.
- [x] Gate técnico y self-test de navegador.

## Verificación ejecutada
- `pnpm typecheck && pnpm lint && pnpm build && pnpm test`: verde; 58 archivos,
  484 tests. Advertencias preexistentes de imports dinámicos en version.test.ts.
- `scripts/e2e-critical-audit.mjs`: PostgreSQL efímero, servidor local con build
  de producción, Playwright y proveedor HTTP local. Todo verde.
- Meta: éxito, bloqueo de headers y de cuerpo con cancelación real a 20 segundos;
  tres peticiones totales, sin reintentos automáticos.
- Dashboard: comparación SQL/referencia en 7d/30d/90d/1y, tenant vacío y segundo
  tenant, archivados, moneda extranjera, pagos futuros y etapas sin transición.
- Carga de 10.000 contactos adicionales: respuesta agregada de 2.561 bytes;
  última medición local 46 ms (no benchmark de producción).
- Migración: upgrade desde FK CASCADE, ejecución doble y reserva conservada.
- Navegador: dashboard visible; respuesta malformada provoca fallback; Reintentar
  recupera la pantalla. API: sin sesión 401, período inválido 422.
- La base efímera y procesos de prueba se eliminan al terminar.

## Pendientes fuera del alcance
- Despliegue y aplicación de 0017 en producción.
- Reparación/verificación integral del historial Drizzle. La prueba también
  confirmó que baseline exige contact.name NOT NULL mientras schema.ts lo permite
  nulo; registrar esta divergencia para el siguiente bloque de integridad.
- Rate limiting, paginación de conversaciones, auditoría de cambios y UX de carga.
