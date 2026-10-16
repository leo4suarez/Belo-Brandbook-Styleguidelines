# Belo · Brandbook & Style Guidelines

Catálogo modular de la marca **Belo**. Las categorías y secciones se arman con bloques editables (texto, imagen, video, carrusel, color y SVG), en tres layouts: pantalla completa, ancho completo y dos mitades.

- **Versión compartida:** <https://belo-brandbook.vercel.app>, en Vercel, con el contenido guardado en Supabase. Cualquiera con el link la ve y la gente de Paisanos la edita.
- **Versión anterior (respaldo, congelada):** el artifact de Claude <https://claude.ai/artifact/BTAeownzjZUsJDNfH5bxT5>.

## Cómo funciona

El catálogo es **una sola página HTML** sin dependencias de build: markup, estilos y script viven en `src/catalog.html`. La página elige dónde guardar al arrancar:

- **Supabase (Vercel y local):** el contenido se guarda en Supabase y lo comparten todos los que abren el link. Ver [Guardado compartido](#guardado-compartido-supabase).
- **Dentro de Claude (artifact publicado):**
  - El contenido se guarda en la base compartida del artifact (`db`). Las imágenes y los videos se suben al almacén de archivos (`assets`).
  - Todos los que abren el link ven lo mismo.
  - Solo el dueño puede escribir: la regla de la base es lectura `view`, escritura `admin`. El modo **admin** muestra los "+", el panel de edición y los menús de cada ítem; el modo **viewer** muestra solo el contenido.
- **Vista local:** sin `window.claude` y sin configuración de Supabase, arranca con contenido de demo en memoria y lo indica abajo ("Vista local · los cambios no se guardan"). Es lo que usan las pruebas, para no tocar los datos reales.

### Funciones principales

- **Home:** es la pantalla de inicio cuando se entra con el link (salvo que el link apunte a una sección). Un slider espacial de tarjetas: un anillo continuo visto desde adentro, dibujado con WebGL sin librerías. Las imágenes y los videos se curvan sobre la misma superficie (no son planos girados uno por uno): el borde de arriba y el de abajo de todas las tarjetas son tramos de los mismos dos arcos, con el mismo espacio entre tarjetas, y hacia los bordes de la pantalla el anillo envuelve la vista. Sin WebGL (o si un archivo no se puede usar como textura) se dibujan las tarjetas como planos en CSS 3D, con el mismo comportamiento.
  - Cada tarjeta es la imagen o el video mismo, sin marco y sin texto, con las esquinas redondeadas que se elijan. Todas comparten la altura y el ancho sale de la proporción: la del archivo, salvo que se elija Horizontal (16:9), Vertical (4:5) o Cuadrada. Los elementos se repiten en un loop infinito hasta llenar la curva. Los videos se reproducen (sin sonido, en loop) solo en las tarjetas que se ven.
  - Se mueve sola y sin parar, a la velocidad elegida en la galería (despacio por defecto; en 0 queda quieta). Con el mouse sobre las tarjetas (o sobre los controles) frena suavemente y, al salir, vuelve a arrancar; en pantallas táctiles arranca de nuevo un par de segundos después del último toque. También se pausa con la Home oculta, la pestaña en segundo plano, el lightbox o la galería abiertos.
  - Se navega con dos botones redondos abajo al centro, con flechas finas (**Anterior** / **Siguiente**, sin puntos ni contador), con las flechas del teclado, con la rueda o el trackpad, y arrastrando o deslizando: la fila sigue con inercia y se acomoda en la tarjeta más cercana.
  - Al pasar el mouse, la tarjeta se acerca un poco. Al hacer clic en cualquier tarjeta, se agranda hasta un lightbox centrado (con su proporción original) mientras la tarjeta se desliza al centro detrás; se cierra con la X, Esc o un clic afuera. Debajo de la imagen, centrados, van el **titular** (14 px, semibold) y la **descripción** (14 px, regular, en un tono más suave), si los tiene.
  - En Admin, el botón **Galería** (abajo a la izquierda) abre el panel para sumar imágenes o videos (también soltándolos), quitarlos y ordenarlos arrastrando; para el elemento elegido, su formato (Original / Horizontal / Vertical / Cuadrada), su **Titular** (hasta 60 caracteres) y su **Descripción** (hasta 160), con contador; y para todas, las **Esquinas** (0 a 40) y la **Velocidad** del movimiento (0 a 100; mientras se ajusta, el slider se mueve a esa velocidad aunque la galería esté abierta). Elegir una miniatura lleva su tarjeta al centro y todo se puede deshacer. Sin contenido, el slider muestra tarjetas de muestra en azul Belo, blanco y grises.
  - En la Home, los botones de búsqueda y menú van arriba a la derecha (con el mismo margen que el logo a la izquierda); en las secciones vuelven al lado de la lista, deslizándose al cambiar de vista. El logo (o la palabra "belo" si no hay logo cargado) siempre vuelve a la Home. Con `prefers-reduced-motion` no se mueve sola, el cambio de tarjeta es instantáneo, sin inercia, y los videos no arrancan solos.
  - Cada visita arranca en modo claro. El switch claro/oscuro vale solo para esa visita (esa pestaña).
- Menú de pantalla completa, desde el botón de arriba:
  - Categorías grandes abajo a la izquierda.
  - **Categorías bloqueadas:** en Admin, el menú «…» de una categoría tiene **Bloquear para Viewer**. Sirve para las que se están armando: se ven en el menú con un candado a la derecha del nombre; en Viewer aparecen atenuadas y no se puede entrar (tampoco desde un link, el buscador o la lista del sidebar). La base de datos tampoco entrega sus secciones a quien no es editor.
  - Arriba a la derecha, junto a la X: los selectores del fondo del menú (solo en Admin) y claro/oscuro con íconos.
  - Abajo a la derecha, viewer/admin con íconos (ojo y lápiz) al lado del usuario, o "Iniciar sesión".
- **Viewer / admin en las secciones:** quien puede editar tiene el mismo switch del menú abajo a la izquierda de cada sección. Se oculta en la Home, con el menú o el buscador abiertos y mientras se edita un bloque.
- Buscador. También encuentra SVG y archivos descargables por su nombre, y el texto de los modales.
- Sidebar sin contenedor, con el título de la categoría y las subcategorías. Hace scroll-spy y auto-scroll dentro de la misma página.
  - El título de la categoría usa el mismo cuerpo de texto que las subcategorías, con un chevron que despliega todas las categorías para saltar a otra.
  - **Mover a otra categoría:** el menú «…» de una subcategoría la manda, con todo su contenido, al final de otra categoría.
- Color de texto adaptativo sobre fondos blancos, azules o fotos, para el sidebar, el menú y el texto sobre imágenes.
- Editor de texto con Phudu o Plus Jakarta Sans: tamaño, peso, interlineado, tracking, alineación y mayúsculas exactos.
- Altura de módulo personalizada. Mientras se edita, el resto de la página se atenúa.
- **Organizar bloques:** la barra de cada bloque suma una manija para arrastrar, **Duplicar** y **Mover a…** (cualquier sección de cualquier categoría), además de Editar / Subir / Bajar / Eliminar.
  - Al arrastrar, el bloque queda atenuado en su lugar, una ficha liviana sigue al puntero y una línea azul marca dónde va a caer. Se puede soltar entre bloques, en una sección vacía ("Suelta aquí") o sobre una sección del sidebar. La página se desplaza sola cerca de los bordes y Esc cancela.
  - Duplicar copia todo (contenido, ajustes, estilos, interacciones y archivos) con ids nuevos y lo deja justo abajo.
  - Los archivos se borran del almacén solo cuando ningún bloque, sección ni la Home los usa: un duplicado comparte los archivos del original. Si alguna sección no se puede leer, no se borra nada.
- **Inspector contextual:** cada tipo de módulo muestra solo las secciones que le corresponden (texto, imagen, video, carrusel, color, SVG y sus variantes de pantalla completa). Tiene tres vistas: Diseño, Animación e Interacción.
- **Ancho del bloque:** los bloques de ancho completo y de dos mitades pueden ocupar un % de la columna, alineados a la izquierda, al centro o a la derecha (campo en el panel o la manija del costado). En dos mitades también se reparte el ancho entre los módulos (campo o la manija del medio; doble clic vuelve a mitad y mitad). El texto conserva su tamaño. En el teléfono el bloque usa todo el ancho.
- **Adentro de un módulo de texto** (también el texto sobre pantalla completa):
  - **Contenido:** la lista de elementos del módulo (textos, divisores y grupos). Clic elige uno; Shift + clic elige varios seguidos.
  - **Contenedor** de cada texto: ancho (llenar, ajustar al contenido o fijo), alto fijo (es un mínimo: el texto nunca se recorta), relleno, borde, radio y espaciado interno, en px de diseño que escalan con el módulo.
  - **Auto layout:** **Agrupar** une los elementos elegidos en un grupo vertical u horizontal, con su espacio, alineación, distribución y su propio contenedor. Las flechas en el borde de un grupo sacan o suman un elemento; **Desagrupar** lo deshace.
  - **Divisores:** una línea en el color del texto (suave) o de la paleta, con grosor, largo y margen; en un grupo horizontal queda vertical.
  - **Espacio entre elementos** del módulo, además de la distribución vertical.
- **Borde (stroke)** en cualquier módulo, además del relleno: grosor y color (automático o de la paleta).
- **Espaciado interno** en textos (también el texto sobre pantalla completa) y SVG: arriba, derecha, abajo e izquierda, con o sin el mismo valor en los cuatro lados, y **Restablecer** para volver al automático.
- **Estilos de texto** vinculados para todo el catálogo (Headline, Subheadline, Body y Caption de entrada, y los que se creen con **Guardar como estilo**). Cambiar la tipografía de un texto vinculado lo marca como modificado; **Actualizar estilo** lo lleva a todos los textos vinculados sin modificar, en todas las secciones. También se puede restablecer, desvincular, renombrar y eliminar (los textos conservan sus valores).
- **Paleta de marca** (Azul Belo, Blanco y Negro de entrada, se pueden sumar, renombrar y quitar colores): color de cada bloque de texto ("Automático" sigue la tinta adaptativa) y muestras rápidas en los fondos.
- **Encuadre de imágenes** (también el fondo de pantalla completa): el **Contenedor** (proporción y alto) aparte de la **Imagen** adentro (cubrir o contener, escala de 100 a 400 % y punto focal con matriz de 9 posiciones o X / Y). **Encuadrar** permite mover la imagen arrastrando y acercarla con la rueda, el pellizco o la barra, mostrando lo que queda afuera en transparencia.
- **Módulo SVG:** se sube un `.svg` (hasta 2 MB) y se muestra con `<img>`, nunca incrustado. Contenedor con fondo y espaciado, tamaño en % del ancho, alineación en 9 posiciones y desplazamiento. Con **Descargable**, en viewer muestra un botón «SVG» y un clic descarga el archivo con su nombre original.
- **Módulo de color** también en bloques normales: una muestra (cuadrada por defecto) con el nombre y el HEX en la tinta que contrasta, elegida de la paleta o libre.
- **Interacciones** por módulo, apagadas por defecto: al hacer clic, **Abrir modal** (título, texto e imágenes), **Descargar** o **Copiar valor** (el HEX en los colores, el texto en los textos). Solo se ofrecen las que tienen sentido para cada tipo. El módulo se vuelve un botón accesible con un chip que dice qué hace ("Copiar #002FA7", "Descargar", "Ver detalle"); copiar avisa "#002FA7 copiado".
- **Archivos descargables:** cada módulo puede ofrecer sus originales (SVG, PNG, JPG, PDF, ZIP, EPS o AI, hasta 50 MB) con formato, nombre y peso, y un nombre visible editable. Con un archivo descarga directo; con varios abre un menú; sin ninguno descarga el archivo del propio módulo.
- Barra flotante de tipo de módulo, botón de volver y `Ctrl+Z` / `Ctrl+Shift+Z` para deshacer y rehacer.
- Carrusel con stepper animado (step player), arrastre con física de resorte y autoplay al entrar en pantalla.
  - Formato **Tira**: las imágenes van una al lado de la otra, cada una con su tamaño (verticales, horizontales o libres), su encuadre y un texto opcional debajo. Se recorre deslizando (trackpad, dedo, arrastre con el mouse o flechas). En el editor, un clic elige una imagen: se encuadra arrastrándola y se cambia el tamaño desde su esquina (Shift mantiene la proporción), o con los campos del panel.
  - Su contenedor tiene las mismas esquinas redondeadas que el resto de los módulos y, en los dos formatos, un **Fondo** como los demás contenedores (ninguno, el gris del tema, uno de la paleta u otro color). En la tira, con fondo las imágenes quedan con aire alrededor (regulable en **Espaciado interno**) y los textos de debajo toman la tinta que se lee sobre ese fondo.
- Scroll suave con Lenis.
- Animaciones preset (GSAP + ScrollTrigger + SplitText), en la vista **Animación** del panel de edición (toggle Diseño / Animación):
  - **Módulo** (imagen, video, color o la caja de un texto): entrada (aparecer, desplazar, escalar, desenfoque, cortina, zoom revelado) y con scroll (parallax, alejar, acercar, desvanecer al salir). Solo se ofrecen los presets que tienen efecto en ese tipo de módulo.
  - **Bloque de texto** (cada título o párrafo, por separado): entrada de bloque entero o por partes con SplitText (revelar con máscara, desplazar, aparecer, desenfoque, escalar, girar), y con scroll la lectura palabra por palabra.
  - Controles: desde dónde entra (abajo, arriba, izquierda, derecha), distancia, duración y retraso; en los split, dividir por líneas, palabras o letras, escalonado por parte y orden (inicio, final, centro, bordes, azar).
  - **Curva** de cada animación: familia (sine, power, expo, circ, back, elástica, rebote) e In / Out / In-Out, con un editor bezier de dos manijas. Editar cualquier curva la vuelve personalizada.
  - **Secuencia** del bloque: espera entre módulos y entre textos. Nada se hereda.
  - **Estilos de animación** vinculados, para todo el catálogo: se guarda la animación de un módulo o de un texto con un nombre y se vincula a otros. Editar un elemento vinculado lo marca como modificado, hasta que se actualiza el estilo (cambia en todos lados) o se restablece. **Usar en todos** vincula de una vez los del mismo tipo: el mismo tipo de módulo o, en textos, el mismo rol según el tamaño (títulos de 40 px o más, subtítulos de 24 a 39 px, textos). Al eliminar un estilo, cada elemento conserva su animación.
  - Vista previa automática, con barra para recorrerla, velocidad 1× / ½× / ¼× y Esc para salir. **Ver división** marca en el lienzo las líneas, palabras o letras del texto y las cuenta.
  - Las divisiones conservan los saltos de línea y no cambian el alto del texto.
  - Respetan `prefers-reduced-motion`. Si GSAP no carga, el contenido se ve sin animar.

## Estructura

```
src/catalog.html            Fuente única (HTML + CSS + JS). Contiene el marcador __PHUDU_B64__
assets/fonts/               Phudu variable (TTF original), subset woff2 que se embebe, y su licencia OFL
scripts/build.mjs           Genera dist/ embebiendo la fuente en base64 y, si hay variables de entorno, la configuración de Supabase
scripts/serve.mjs           Servidor estático mínimo para dist/ (sin dependencias)
dist/artifact.html          Lo que se publica como artifact (cuerpo de la página)
dist/index.html             La misma página envuelta en un documento completo, para Vercel y para verla local
supabase/migrations/        Esquema de la base: documentos, editores, permisos, historial, tiempo real y archivos
tests/                      Pruebas end-to-end con Playwright, sus fixtures y un Supabase simulado
```

## Uso

Requiere Node 18 o superior.

```bash
npm install                       # solo hace falta para las pruebas (Playwright)
npm run build                     # genera dist/artifact.html y dist/index.html
npm run serve                     # build + vista local en http://localhost:8765
```

### Pruebas

```bash
npx playwright install chromium   # la primera vez
npm test                          # build + flows, panel, menu, motion, collab, blocks, home, editor, media y layout
node tests/run.cjs layout.cjs     # solo algunas suites
```

- Las pruebas recorren los flujos principales: crear y editar bloques, panel, deshacer y rehacer, menú, buscador, temas y mobile.
- `collab.cjs` prueba el guardado compartido con la librería real de Supabase contra un Supabase simulado (`tests/fake-supabase.cjs`): login con Google, permisos, cambios en vivo entre dos editores, conflictos, presencia, archivos, reintentos e importación.
- `blocks.cjs` prueba duplicar, arrastrar dentro de una sección, a otra y sobre el sidebar, **Mover a…**, Esc para cancelar y que borrar un duplicado no borre los archivos del original.
- `home.cjs` abre Chromium con la GPU habilitada (`--ignore-gpu-blocklist --enable-gpu`) para que el anillo se dibuje con WebGL, y comprueba sobre la captura que los bordes de todas las tarjetas caen sobre una misma curva; también prueba la versión sin WebGL. Prueba la Home: el slider (curva 3D sin tarjetas encimadas, movimiento automático y su pausa con el mouse o el toque, los dos botones redondos, teclado, rueda, arrastre con inercia), hover, lightbox de la tarjeta clickeada, galería (subir, titular y descripción con sus límites, formatos, esquinas, velocidad, ordenar, quitar y deshacer), los botones arriba a la derecha solo en la Home, movimiento reducido, mobile y el switch viewer/admin de las secciones.
- `editor.cjs` prueba el inspector contextual, el espaciado interno, los estilos de texto (también entre secciones y entre dos editores) y la paleta.
- `media.cjs` prueba el encuadre, el módulo SVG, el módulo de color, las interacciones (copiar, modal y descarga) y los archivos descargables, también guardados en el Supabase simulado.
- `layout.cjs` prueba el tema claro por visita, el título del sidebar y su lista de categorías, las categorías bloqueadas (en la página y en la base simulada), mover una subcategoría, los contenedores, grupos y divisores de los textos, los bordes, el ancho de los bloques, la división de dos mitades y la tira del carrusel (con sus esquinas, su fondo y su espaciado interno).
- Las capturas quedan en `tests/output/`, que está ignorado por git.
- Las pruebas bloquean Google Fonts y sirven Lenis desde `tests/fixtures/` y supabase-js desde `node_modules`, así que corren sin red. Por eso en el log aparece `Failed to load resource: net::ERR_FAILED`: es esperado.
- Para cambiar el puerto: `PORT=8790 npm test`.

## Guardado compartido (Supabase)

- **Proyecto:** `belo-brandbook` (id `tdrlxenjgfvnjzmuixhy`, región São Paulo).
- **Base:** una tabla `docs` con un documento JSON por ruta (`catalog/tree` y `pages/{subId}`), el mismo modelo que el artifact. El esquema está en `supabase/migrations/`.
- **Quién ve:** cualquiera con el link, sin login. Las secciones de una categoría bloqueada solo las leen los editores (`private.page_locked`, en la regla de lectura de `docs`).
- **Quién edita:** cuentas con email confirmado de `@paisanoscreando.com` o `@paisanos.io`. Se entra con Google desde el menú ("Iniciar sesión"). Una cuenta de otro dominio entra en "Solo lectura".
  - Para sumar a una persona puntual: `insert into private.editors (email) values ('alguien@belo.app');`
  - Para sumar un dominio entero: `insert into private.editor_domains (domain) values ('belo.app');`
- **Archivos:** bucket público `assets`. Solo los editores suben y borran.
- **Cambios de varias personas a la vez:**
  - Cada guardado lleva la versión sobre la que se armó. Si alguien guardó antes, la página vuelve a cargar el documento, reaplica el cambio encima y guarda de nuevo, así no se pisan.
  - Los cambios de los demás llegan en vivo, sin recargar.
  - Si dos personas confirman el mismo bloque, gana la última. Para evitarlo, en Admin se ve quién está editando: sus iniciales junto a la sección y un contorno con su nombre sobre el bloque.
  - Abajo a la derecha (en Admin) se ve quién editó la sección que estás mirando y cuándo.
- **Historial:** cada versión guardada queda en `doc_revisions`. Para volver atrás una sección, hay que copiar `data` de la revisión que corresponda a `docs` desde el editor SQL de Supabase.
  - El ajuste único de tamaños de texto del 14/10/2026 quedó guardado como «Ajuste de tamaños de texto» (`saved_by_name`): la revisión anterior de cada una de esas 30 secciones es la versión de antes.
- **Sin conexión:** si un guardado falla, el indicador pasa a "Sin guardar" y se reintenta solo. Si cerrás la pestaña con cambios pendientes, el navegador avisa.

### Configuración

- El build inyecta en la página la URL del proyecto y su clave pública (publishable), que están en `supabase/public.json`. Son valores públicos por diseño: terminan en la página igual, y lo que protege los datos son los permisos de la base. La clave secreta (`service_role`) no va nunca en el repo, y el build la rechaza si se la pasan por error.
- Para apuntar a otro proyecto sin tocar el repo, `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno (Vercel o `.env.local`) tienen prioridad.
- `npm run serve` levanta la página contra el Supabase real.
- **Login con Google:** se configura en Supabase, en Authentication → Sign In / Providers → Google, con un cliente OAuth de Google Cloud. En Authentication → URL Configuration van el Site URL (`https://belo-brandbook.vercel.app`) y las URLs de redirección permitidas (producción, previews de Vercel y `http://localhost:8765/**`).

### Importar el contenido del artifact

Es una sola vez. En la página de Vercel, con sesión de editor y en modo Admin, soltá sobre la página `belo-export.json` junto con todas sus imágenes. La página sube los archivos al bucket, reemplaza los ids viejos y guarda las secciones.

## Modelo de datos

Hay dos tipos de documento (en Supabase y en la base del artifact):

- **`catalog/tree`:** el árbol de navegación y la configuración global.
  ```js
  {
    logo: { id, w, h, mono } | null,
    menu: { bg: { kind: 'color', color } | { kind: 'image', asset, w, h, dim } },
    home: { media: [{ id, kind: 'image' | 'video', w, h, title, desc, ratio }], radius, speed },  // la galería del slider, en orden
                                                                      // title (60) y desc (160): textos del lightbox, opcionales (un label viejo pasa a title)
                                                                      // ratio: '16/9' | '4/5' | '1/1' (sin ratio = la del archivo); radius: esquinas (0-40, por defecto 16)
                                                                      // speed: velocidad del movimiento automático (0-100, por defecto 24; 0 = quieto)
    animStyles: [{ id, name, kind: 'mod' | 'text', of, anim }],
    textStyles: [{ id, name, font, size, weight, lh, ls, upper }],    // estilos de texto (ids ts_…)
    palette: [{ id, name, hex }],                                     // paleta de marca (ids pc_…)
    categories: [{ id, name, locked?: true, subs: [{ id, name }] }]   // locked: cerrada para Viewer
  }
  ```
  - `textStyles` y `palette` se crean con los valores de entrada solo si no existen: una lista vacía quiere decir que se borraron todos.
- **`pages/{subId}`:** los bloques de cada sección, en orden.
  ```js
  { rows: [{ id, layout: 'fullscreen' | 'full' | 'half', h, slots: [slot], overlay? }] }
  ```
  - `slot.type` puede ser `text`, `image`, `video`, `carousel`, `color` o `svg`.
  - Los textos guardan sus `blocks` con `font`, `size`, `weight`, `lh`, `ls`, `align` y `upper`. Además, opcionales:
    - `ts`: el estilo de texto vinculado, y `tsOver: true` si se modificó localmente. Los valores propios son una copia del estilo.
    - `color`: el id de un color de la paleta. Sin `color`, el texto usa la tinta automática; si el color se borra de la paleta, vuelve a la automática.
  - Las imágenes y los videos guardan el `asset`: el id del archivo subido. En Supabase es el nombre del objeto en el bucket `assets`; en el artifact se sirve en `/_blob/<id>`.
  - `overlay` es el texto opcional sobre un bloque de pantalla completa.
  - Campos nuevos de los módulos (todos opcionales; si faltan, el módulo se ve como antes):
    - `slot.pad`: `{ t, r, b, l }`, el espaciado interno de cada lado en px de diseño, o `null` para el automático de ese lado (textos y SVG).
    - `slot.frame` (imágenes, también de fondo): `{ fit: 'cover' | 'contain', x, y, zoom }`, con el punto focal en % y la escala de 100 a 400 %. Se aplica con `object-position` y la propiedad `scale`, nunca con `transform`.
    - `slot.action`: `{ kind: 'modal' | 'download' | 'copy', value?, title?, body?, media?: [{ id, w, h }] }`, lo que pasa al hacer clic.
    - `slot.files`: `[{ id, name, type, size }]`, los archivos descargables (`name` es el nombre visible).
    - SVG: `{ type: 'svg', asset, w, h, name, size, ratio, bg: { kind: 'none' | 'surface' | 'color', color? }, scale, pos, dx, dy }`, con `scale` en % del ancho, `pos` una de las 9 posiciones (`tl` … `br`) y `dx` / `dy` en % del contenedor. Descargable es `action: { kind: 'download' }`.
    - Color en bloques normales: `{ type: 'color', color, ratio: '1/1', label }`; `label: false` oculta el nombre y el HEX.
    - `slot.stroke`: `{ w, c? }`, el borde del módulo (grosor en px; sin `c` usa el color del texto).
    - `row.w` (20–100, % de la columna) y `row.wa` (`'c'` o `'r'`; sin él, a la izquierda); en dos mitades, `row.split` (20–80, % del módulo izquierdo).
    - Textos: `slot.gap` (espacio entre elementos), y en `blocks` también divisores `{ id, kind: 'div', t, c?, len?, m? }`. Los elementos de un grupo llevan `g` (id en `slot.groups: { [id]: { dir: 'v' | 'h', gap?, al, ju, wrap?, box? } }`) y van seguidos. Textos y grupos tienen `box?: { w: 'hug' | px, h, fill, sw, sc, r, px, py }`.
    - Carrusel: `mode: 'strip'` (la tira), `sgap` y `sal` (`'center'` o `'end'`); cada imagen puede llevar `bw` × `bh` (su tamaño), `fx` / `fy` / `fz` (encuadre) y `cap` (texto debajo). `bg: { kind: 'none' | 'surface' | 'color', color? }` es el fondo (sin él, el gris del tema en el stepper y ninguno en la tira) y, en la tira, `pad` el espaciado interno.
  - Todos los ids de archivos (`asset`, `images`, `files`, `action.media`, la galería de la Home) mantienen vivo el archivo en el almacén.
  - Animaciones (todas opcionales). Los presets están en `ENTER` y `SCROLL` dentro de `src/catalog.html`, y `ANIM_KEYS` define cuáles ofrece cada tipo:
    - `row.anim`: `{ stagger, tstagger }`, la secuencia del bloque.
    - `slot.anim`: `{ enter, scroll, dur, delay, ease, dir, dist }`, la animación del módulo.
    - `block.anim` (en los bloques de texto): `{ enter, scroll, dur, delay, ease, dir, dist, by, order, stagger }`, la animación de ese texto.
    - Con estilo: `anim.style` (id del estilo) y `anim.over` (modificado localmente). Los valores propios son una copia del estilo.
    - `ease` es un nombre de GSAP (`power3.out`) o una curva `cubic-bezier(x1,y1,x2,y2)`.

## Publicar cambios

1. Editá `src/catalog.html`.
2. Corré `npm run build` y revisá en `npm run serve`.
3. Pedile a Claude que publique `dist/artifact.html` en el artifact existente, con el mismo link, para que no cambie la URL ni se pierdan los datos.

El contenido (textos, imágenes, categorías) vive en la base del artifact y no en este repo, así que publicar código nuevo no pisa lo que ya está cargado.

### Vercel

- El repo está conectado a Vercel (proyecto `belo-brandbook`): cada push a `main` se despliega solo, y cada rama tiene su preview.
- `vercel.json` le indica que corra `node scripts/build.mjs`, que no hace falta instalar dependencias y que sirva la carpeta `dist/`.
- La versión de Vercel guarda en Supabase sin configurar nada en Vercel: la configuración pública está en `supabase/public.json`.
- `dist/artifact.html` también la lleva, pero dentro de Claude la página usa la base del artifact.

## Créditos y licencias

- **Phudu** (variable, 300–900): © The Phudu Project Authors, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`). Se embebe un subset en la página.
- **Plus Jakarta Sans:** se carga desde Google Fonts (OFL).
- **Lenis** 1.3.26 (MIT): se carga desde jsDelivr. Hay una copia en `tests/fixtures/` solo para las pruebas.
- **supabase-js** 2.117.2 (MIT): se carga desde jsDelivr con hash de integridad, solo en modo Supabase.
- **GSAP** 3.15.0 con ScrollTrigger y SplitText ([licencia estándar de GSAP](https://gsap.com/standard-license), sin costo): se carga desde jsDelivr. Hay copias en `tests/fixtures/` solo para las pruebas.
- El stepper del carrusel es una reimplementación propia del comportamiento del *step player* de bencho.dev.

## Historial

- **v1:** estructura base. Sidebar con categorías y subcategorías, switch admin/viewer, slot de logo, módulos de texto, imagen, video y carrusel en ancho completo o dos mitades, placeholders antes de confirmar.
- **v2:**
  - Modo claro/oscuro, menú burger de pantalla completa y buscador.
  - Sidebar sin contenedor con auto-scroll.
  - Tinta adaptativa, editor de texto avanzado, altura de módulo y bloques de pantalla completa con texto encima.
  - Stepper animado en el carrusel.
- **v3:**
  - Selector de layout rediseñado (pantalla completa, ancho completo, dos mitades) con previews sin cajas anidadas.
  - Animación del burger más fluida y separador de sección punteado.
  - Barra flotante de tipo, botones redondos, botón de volver y deshacer/rehacer.
- **v4:** arreglo del menú que a veces quedaba a medio dibujar, con el texto encima de todo.
- **v5:** guardado compartido en Supabase. Login con Google para editores de Paisanos, cambios en vivo, conflictos sin pisarse, presencia, última edición, historial e importación del contenido del artifact.
- **v5.1:**
  - Arreglo del menú que quedaba sin fondo, con las categorías flotando sobre la página. Chrome dejaba partes animadas con un `visibility:hidden` viejo; ahora el menú cerrado usa `display:none` y la revelación circular es un círculo que crece (solo transform), sin recortes.
  - El menú es la pantalla de inicio y los controles se reubicaron con íconos.
  - Editores también con `@paisanos.io`.
  - Las imágenes de Supabase cargan con CORS para que el texto adaptativo pueda leerlas.
- **v5.2:** animaciones de Fran (presets por módulo y por bloque de texto, curvas, vista previa y estilos vinculados) integradas con el guardado compartido. Aplicar un estilo a todos guarda solo la animación de cada elemento, así no pisa cambios de otros.
  - Si un cambio no se puede aplicar a un documento, se saltea en lugar de trabar los guardados siguientes.
  - Al cerrar el menú de inicio, las animaciones de entrada vuelven a correr.
- **v6.0 (propuesta vene):**
  - Home como pantalla de inicio, con el globo de la galería, y switch viewer/admin abajo a la izquierda en las secciones.
  - Organizar bloques: arrastrar, duplicar y mover a cualquier sección, con borrado de archivos que respeta lo que siguen usando otros bloques.
  - Inspector contextual con vista Interacción, espaciado interno, estilos de texto, paleta de marca, encuadre de imágenes, módulos SVG y de color, interacciones y archivos descargables.
  - Arranca en modo claro por defecto: ya no sigue la preferencia del sistema si la persona no eligió un tema.
  - La migración `supabase/migrations/20261009120000_catalog_assets_sources.sql` suma PDF, ZIP, EPS y AI a los tipos permitidos del bucket `assets` (aplicada).
- **v6.1 (propuesta vene, rama `vene-home-slider`): slider espacial en la Home.**
  - El globo de la Home se reemplaza por un slider de tarjetas sobre una curva en CSS 3D, con loop infinito, inercia, hover y el mismo lightbox. Toma como referencia el "Spatial Cards Slider" de Osmo.
  - Leyenda opcional por elemento de la galería (`label`), editable en el panel **Galería**. Los datos guardados antes siguen funcionando igual.
  - Quinta vuelta: el anillo pasa a WebGL, con las imágenes y los videos curvados sobre una misma superficie continua, como en la referencia de Osmo, y una curvatura más marcada.
  - Cuarta vuelta: el titular y la descripción van centrados bajo la imagen; abajo quedan solo dos botones redondos con flechas finas (sin puntos ni contador).
  - Tercera vuelta: búsqueda y menú arriba a la derecha en la Home; la leyenda se reemplaza por **titular** y **descripción** (`title`, `desc`), que se ven solo en el lightbox; control de **velocidad** del movimiento (`home.speed`).
  - Segunda vuelta: se mueve sola despacio (frena con el mouse encima y vuelve al salir), tarjetas sin marco con la proporción de cada archivo (o Horizontal / Vertical / Cuadrada por elemento, `ratio`), esquinas regulables para todas (`home.radius`) y una curva nueva: un cilindro visto desde adentro, con las tarjetas ubicadas por longitud de arco y espacio parejo, para que nunca se tapen entre vecinas, con un toque esférico hacia los bordes.
- **v7.0:**
  - Categorías bloqueadas para Viewer, con candado en el menú y la regla en la base (`20261014120000_catalog_locked_categories.sql` y `20261014120100_catalog_locked_pages_policy.sql`, aplicadas).
  - Cada visita arranca en modo claro.
  - Título del sidebar con el cuerpo de las subcategorías y un chevron con todas las categorías; mover una subcategoría a otra categoría.
  - «Fondo» y «Texto encima» centrados en el panel.
  - Ancho de los bloques y reparto de las dos mitades; borde en los módulos; contenedores, auto layout y divisores adentro de los textos.
  - Carrusel en formato tira, con imágenes de tamaño libre, encuadre y texto debajo.
  - Ajuste único de tamaños en el contenido: textos de 15 a 18 px a 14 px (sobre pantalla completa, los de 18 a 20 px a 20 px); títulos grandes de ancho completo en Plus Jakarta a 72 px; títulos Phudu de pantalla completa y ancho completo a 120 px. Se dejaron igual los ejemplos de la sección Tipografía y los títulos de las tarjetas de dos mitades.
- **v7.1:** la Home de la rama `vene-home-slider` (el slider espacial de tarjetas en WebGL, con titular y descripción en el lightbox, formato por elemento, esquinas, velocidad y los botones arriba a la derecha) integrada sobre la v7.0. Solo se trajo la Home: todo lo demás de la v7.0 queda igual.
- **v7.2:** el carrusel en formato tira con las esquinas redondeadas de los demás módulos, y fondo a elección en el contenedor del carrusel (los dos formatos), con espaciado interno en la tira.
