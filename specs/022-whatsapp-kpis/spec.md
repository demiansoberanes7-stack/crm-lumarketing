# WhatsApp Zernio, configuración WAHA y auditoría del dashboard

Carril completo: nuevo almacenamiento de conexión y webhook público.

## Comportamiento y aceptación
- WhatsApp permite conectar una cuenta Zernio con accountId, API key y secreto de firma. Se valida el número vía `/whatsapp/number-info` antes de guardar; secretos cifrados y nunca devueltos al navegador.
- Zernio es opcional mediante WHATSAPP_ZERNIO_ENABLED; se conserva Meta como transporte predeterminado para instalaciones sin bandera. El proveedor activo controla recepción y envío.
- Webhook firmado por organización, ingesta idempotente, identidad teléfono/BSUID, texto, adjuntos y acuses. El sandbox no puede enviar. Errores externos son visibles y acotados por timeout.
- WAHA permite editar nombre de dispositivo, navegador, filtros de eventos, almacenamiento NOWEB, acuses WEBJS, proxy y reintentos. Aplicar conserva opciones ajenas y webhooks de terceros. Contraseñas se conservan si se dejan vacías y nunca se devuelven.
- Dashboard: importes en centavos, caja por fecha efectiva, sin futuros, ventanas UTC explícitas. Cotizaciones por cohorte de creación y moneda seleccionada. Cartera actual por saldo positivo, mora sobre importe pendiente. Proyectos/tareas son estado actual, excluyendo archivados de la operación activa. Bandeja excluye laboratorio y usa el período elegido.
- Tiempo por etapa = suma de estancias terminadas / número de estancias; se atribuye a la etapa abandonada. No se inventa fecha de terminación de tareas: updatedAt solo permite etiquetar terminadas actualizadas.
- El porcentaje de contactos con proyecto se llama actividad, no retención. Ratios sin denominador se muestran N/D.

## Verificación
Pruebas de límites temporales, saldo sobrepagado, rechazadas, moneda, promedios de tres o más estancias, exclusión sandbox, firma y transporte; tipos, lint, build, tests y self-test local con mocks.

## Límites
No se convierte moneda sin tipo de cambio; ingresos/gastos existentes son MXN. No se presenta utilidad contable devengada: es resultado de caja. Credenciales productivas y vinculación QR requieren la cuenta del propietario.

## Constitution check
Adaptadores opcionales, consultas por organización, cifrado, deduplicación y sandbox conservados. Sin servicios adicionales obligatorios.
