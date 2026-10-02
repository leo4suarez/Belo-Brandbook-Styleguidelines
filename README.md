# Belo · Brandbook & Style Guidelines

Catálogo modular de la marca **Belo**. Las categorías y secciones se arman con bloques editables (texto, imagen, video, carrusel y color), en tres layouts: pantalla completa, ancho completo y dos mitades.

La versión en vivo es un artifact de Claude: <https://claude.ai/artifact/BTAeownzjZUsJDNfH5bxT5>

## Cómo funciona

El catálogo es **una sola página HTML** sin dependencias de build: markup, estilos y script viven en `src/catalog.html`.

- **Dentro de Claude (artifact publicado):**
  - El contenido se guarda en la base compartida del artifact (`db`). Las imágenes y los videos se suben al almacén de archivos (`assets`).
  - Todos los que abren el link ven lo mismo.
  - Solo el dueño puede escribir: la regla de la base es lectura `view`, escritura `admin`. El modo **admin** muestra los "+", el panel de edición y los menús de cada ítem; el modo **viewer** muestra solo el contenido.
- **Fuera de Claude (vista local):** si la página no encuentra `window.claude`, arranca con contenido de demo en memoria y lo indica abajo ("Vista local · los cambios no se guardan"). Sirve para revisar diseño y comportamiento sin tocar los datos reales.

### Funciones principales

- Menú de pantalla completa (burger) con las categorías grandes, el switch claro/oscuro y el switch admin/viewer.
- Buscador.
- Sidebar sin contenedor, con el título de la categoría y las subcategorías. Hace scroll-spy y auto-scroll dentro de la misma página.
- Color de texto adaptativo sobre fondos blancos, azules o fotos, para el sidebar, el menú y el texto sobre imágenes.
- Editor de texto con Phudu o Plus Jakarta Sans: tamaño, peso, interlineado, tracking, alineación y mayúsculas exactos.
- Altura de módulo personalizada. Mientras se edita, el resto de la página se atenúa.
- Barra flotante de tipo de módulo, botón de volver y `Ctrl+Z` / `Ctrl+Shift+Z` para deshacer y rehacer.
- Carrusel con stepper animado (step player), arrastre con física de resorte y autoplay al entrar en pantalla.
- Scroll suave con Lenis.

## Estructura

```
src/catalog.html            Fuente única (HTML + CSS + JS). Contiene el marcador __PHUDU_B64__
assets/fonts/               Phudu variable (TTF original), subset woff2 que se embebe, y su licencia OFL
scripts/build.mjs           Genera dist/ embebiendo la fuente en base64
scripts/serve.mjs           Servidor estático mínimo para dist/ (sin dependencias)
dist/artifact.html          Lo que se publica como artifact (cuerpo de la página)
dist/index.html             La misma página envuelta en un documento completo, para verla local
tests/                      Pruebas end-to-end con Playwright y sus fixtures
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
npm test                          # build + flows, panel y menu
```

- Las pruebas recorren los flujos principales: crear y editar bloques, panel, deshacer y rehacer, menú, buscador, temas y mobile.
- Las capturas quedan en `tests/output/`, que está ignorado por git.
- Las pruebas bloquean Google Fonts y sirven Lenis desde `tests/fixtures/`, así que corren sin red. Por eso en el log aparece `Failed to load resource: net::ERR_FAILED`: es esperado.
- Para cambiar el puerto: `PORT=8790 npm test`.

## Modelo de datos

Hay dos tipos de documento en la base del artifact:

- **`catalog/tree`:** el árbol de navegación y la configuración global.
  ```js
  {
    logo: { id, w, h, mono } | null,
    menu: { bg: { kind: 'color', color } | { kind: 'image', asset, w, h, dim } },
    categories: [{ id, name, subs: [{ id, name }] }]
  }
  ```
- **`pages/{subId}`:** los bloques de cada sección, en orden.
  ```js
  { rows: [{ id, layout: 'fullscreen' | 'full' | 'half', h, slots: [slot], overlay? }] }
  ```
  - `slot.type` puede ser `text`, `image`, `video`, `carousel` o `color`.
  - Los textos guardan sus `blocks` con `font`, `size`, `weight`, `lh`, `ls`, `align` y `upper`.
  - Las imágenes y los videos guardan el `asset` (id del archivo subido, servido en `/_blob/<id>`).
  - `overlay` es el texto opcional sobre un bloque de pantalla completa.

## Publicar cambios

1. Editá `src/catalog.html`.
2. Corré `npm run build` y revisá en `npm run serve`.
3. Pedile a Claude que publique `dist/artifact.html` en el artifact existente, con el mismo link, para que no cambie la URL ni se pierdan los datos.

El contenido (textos, imágenes, categorías) vive en la base del artifact y no en este repo, así que publicar código nuevo no pisa lo que ya está cargado.

## Créditos y licencias

- **Phudu** (variable, 300–900): © The Phudu Project Authors, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`). Se embebe un subset en la página.
- **Plus Jakarta Sans:** se carga desde Google Fonts (OFL).
- **Lenis** 1.3.26 (MIT): se carga desde jsDelivr. Hay una copia en `tests/fixtures/` solo para las pruebas.
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
