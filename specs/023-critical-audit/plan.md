# Plan

1. Verificar código, historial de migraciones y estado Git.
2. Añadir boundaries raíz/aplicación/autenticación y fallback global independiente.
3. Acotar Graph API tanto en headers como lectura del cuerpo; probar errores tipados.
4. Migración 0017: cambiar solo FK booking_contact_id_contact_id_fk a SET NULL.
   Mantener baseline; SQL manual por snapshots históricos incompletos.
5. Agregar dashboard en SQL dentro de la misma transacción REPEATABLE READ, con
   statement_timeout local; comparar resultados con buildDashboard como referencia.
6. Ejecutar gate y self-test contra DB efímera y proveedores simulados.

## Constitution check
Consultas scoped por organización, sin terceros nuevos; sin secretos en UI/logs.
No hay reintentos de envío que dupliquen mensajes. Conservación de datos e
idempotencia de migración; pruebas locales sin proveedores reales. Contrato público
del dashboard se conserva y el schema ya declara la regla SET NULL deseada.
