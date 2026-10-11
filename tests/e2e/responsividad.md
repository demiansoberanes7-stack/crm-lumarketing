# Responsividad — el CRM se usa desde el teléfono

Guion de comportamiento (2026-08-14). Automatizado en
`scripts/e2e-responsive.mjs`.

Origen: la app se diseñó para escritorio (lateral fijo de 224 px + Bandeja de
tres columnas). Debajo de ~1000 px el lateral se comía media pantalla, el hilo
quedaba en una franja de unos 100 px y el compositor caía fuera del área
visible del navegador móvil.

## Preparación

App corriendo con mocks (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` →
wa-mock) y BD con migraciones aplicadas. Un contacto entrante de prueba con
conversación abierta.

Tres tamaños: teléfono 390×844, tableta 820×1180, escritorio 1440×900.

## AC-1 — Ninguna pantalla recorta contenido a lo ancho

Recorre Dashboard, Bandeja, Pipeline, Contactos, Agente, Envíos masivos,
Laboratorio, Ajustes → Conexiones, Buzón y WhatsApp en los tres tamaños.

Esperado: en cada una, el contenido de `main` cabe en su ancho visible
(`scrollWidth == clientWidth`) y el documento no genera scroll horizontal. El
tablero del Pipeline sí se arrastra en horizontal, pero **dentro** de su propio
contenedor, con las columnas ancladas (snap).

## AC-2 — El lateral se vuelve cajón en el teléfono

1. Abre cualquier pantalla en 390×844.

Esperado: se ve la barra superior con la hamburguesa y la marca; los enlaces
del lateral **no** son alcanzables (están fuera del orden de tabulación).

2. Toca la hamburguesa.

Esperado: el cajón entra desde la izquierda **encima** del contenido (no lo
empuja: `main` sigue empezando en x=0), con velo detrás.

3. Toca "Bandeja".

Esperado: navega y el cajón se cierra solo. También cierra con Escape, con el
velo y con su propia ✕.

## AC-3 — La Bandeja es maestro-detalle en el teléfono

1. Abre la Bandeja sin conversación elegida.

Esperado: la lista ocupa el ancho completo (390 px), no una columna de 360 px
con el hilo aplastado al lado.

2. Toca una conversación.

Esperado: el hilo ocupa toda la pantalla, la lista desaparece y aparece un
botón "Volver a las conversaciones" que la regresa.

3. Mira el compositor.

Esperado: queda **dentro** de la pantalla (la altura del cascarón es `100dvh`,
no `100vh`) y su tipografía mide ≥16 px, que es lo que evita que Safari en iOS
haga zoom al enfocar y deje el CRM descuadrado. Lo mismo aplica a todo campo de
texto por debajo de `md`.

## AC-4 — Los detalles del contacto flotan sobre el hilo

1. Con el hilo abierto en el teléfono, toca "Mostrar detalles".

Esperado: el panel arranca **cerrado** (la preferencia guardada solo manda en
escritorio) y entra como cajón pegado al borde derecho, encima del hilo, sin
robarle ancho ni provocar scroll horizontal. Cierra con su ✕ o con el velo.

Debajo de `xl` (1280 px) el panel siempre es cajón; a partir de ahí vuelve a ser
la tercera columna.

## AC-5 — En tableta conviven lista e hilo

En 820×1180 la Bandeja muestra dos columnas (lista ~300 px + hilo), y el panel
de detalles sigue siendo cajón.

## AC-6 — En escritorio nada cambió

En 1440×900: lateral fijo de 224 px sin hamburguesa, Bandeja de tres columnas
(lista 360 px + hilo + detalles 320 px) y la preferencia de "panel abierto"
persistida como siempre.

## AC-7 — Vistas largas y formularios mantienen un scroll alcanzable

En 390×844:

1. Abre **Envíos masivos** y baja hasta el listado de campañas y las acciones al final.
2. Abre **Configuración → Agente**; el contenido utiliza el scroll de Ajustes,
   sin encadenar un segundo scroll vertical dentro de la página.
3. Abre el diálogo de nuevo contacto y un diálogo de finanzas con el teclado
   abierto. El formulario se puede desplazar y el botón de guardar sigue accesible.
4. En Agenda abre un día y edita sus horas. La página no genera scroll horizontal.

Esperado: las vistas bajo el shell `overflow-hidden` habilitan scroll interno
cuando el contenido lo requiere. El composer de Bandeja y correo queda por
encima del teclado virtual y separado del safe area inferior.

## AC-8 — Gráficas y conexiones se pueden usar con toque

En 390×844:

1. Recorre las gráficas del Dashboard: las tarjetas se apilan, las cifras largas
   no empujan el ancho y los donuts usan leyenda en lugar de etiquetas cruzadas.
2. Desliza las secciones de Ajustes hasta la pestaña activa.
3. En Conexiones, cada canal activo tiene **Configurar**; los apagados explican
   qué variable de despliegue hace falta. La API key se captura desde el
   formulario del canal dentro del CRM.

Esperado: no hay acciones importantes que dependan solo de hover y las tablas
anchas se desplazan dentro de su propia tarjeta.

## AC-9 — Teclado virtual en dispositivo real

En Safari iOS y Chrome Android, toca el compositor de WhatsApp y el de correo.

Esperado: el shell se ajusta al `visualViewport`, el compositor permanece
visible por encima del teclado y el área de envío no queda bajo la home
indicator. Playwright no simula el teclado nativo; este caso se confirma en un
teléfono real.
