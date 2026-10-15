# Documentación técnica del CRM LUMARK

**Fecha de auditoría:** 15 de octubre de 2026  
**Rama de referencia:** `main`  
**Commit revisado:** `d2a9629b40fb6720e46b0d37e369a8a4bec3053e`  
**Tipo de revisión:** estática de código, configuración y documentos; no se accedió a la VM en vivo.

## Guía de lectura

1. [Manual general del sistema](01_manual_general.md)
2. [Diagramas de arquitectura](02_diagramas_arquitectura.md)
3. [Bases de datos y esquema](03_manual_bases_de_datos.md)
4. [Frontend](04_manual_frontend.md)
5. [Backend y API](05_manual_backend_api.md)
6. [Máquina virtual e infraestructura](06_manual_maquina_virtual.md)
7. [Flujos funcionales](07_manual_flujos_funcionales.md)
8. [Seguridad y mantenimiento](08_seguridad_mantenimiento.md)
9. [Inventario y pendientes](09_inventario_pendientes.md)
10. [Diccionario de datos CSV](03b_diccionario_datos.csv)

## Cómo interpretar la evidencia

- **Verificado en repositorio:** aparece en código, configuración o migraciones consultadas.
- **Documentado, no revalidado:** aparece en los manuales aportados o en comentarios de configuración, pero no se consultó el entorno vivo.
- **Inferido:** conclusión basada en varios archivos, todavía no es una prueba funcional.
- **Pendiente:** requiere acceso a la VM, base activa, credenciales, ejecución de pruebas o evidencia adicional.

Este paquete se agregó en una carpeta nueva; no sustituye los documentos existentes ni altera el código de aplicación. No se ejecutaron migraciones, pruebas ni cambios de infraestructura. Los diagramas representan la arquitectura encontrada, no certifican que cada integración esté conectada o saludable en producción.
