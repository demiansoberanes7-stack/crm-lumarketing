# Auditoría de frontend y publicación

## Alcance y hallazgos (2026-09-22)
Restituir lo solicitado: Calendario con lista, vista día/semana y configuración
persistente; Meta Business, WAHA y Zernio en páginas independientes; configuración
avanzada WAHA visible. Carril completo para corregir el índice de configuración
por usuario sin perder los datos existentes.

- EasyPanel solo conservaba WHATSAPP_ZERNIO_ENABLED. Los nuevos contenedores
  morían sin DATABASE_URL y Swarm mantenía la versión anterior.
- PATCH de configuración y POST de reordenamiento recibían objetos en lugar de
  esquemas Zod y leían dos veces el body. Devolvían 500.
- Lista y calendario tenían estados independientes; cambios desaparecían al
  cambiar de pestaña. El formulario anunciaba éxito incluso con respuesta 500.
- El planificador ignoraba la zona horaria y la reprogramación usaba horarios
  obsoletos como obstáculos. Configuración tenía UNIQUE por organización y por
  usuario separados en vez de por pareja.

## Criterios de aceptación
- Las tres páginas de proveedores son accesibles desde Ajustes, sin selector.
- WAHA muestra sus campos avanzados sin abrir un desplegable.
- Crear, completar, reordenar y reprogramar tareas se refleja al cambiar de vista
  y tras recargar. Errores visibles y botones recuperables ante fallo de red.
- Configuración validada (horario creciente, zona IANA, duración que cabe en la
  jornada), persistente y aislada por usuario/organización.
- Planificación y presentación respetan la zona elegida, sin solapamientos ni
  desbordar el final de jornada. Pantallas utilizables a 390 px.
- Verificación: typecheck, lint, build, unitarios y Playwright con PostgreSQL;
  producción autenticada, páginas visibles, contenedor saludable e identidad
  del build comprobada. No usar la versión 1.3.0 como prueba de antigüedad.
