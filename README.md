# Belo · Brandbook & Style Guidelines

Catálogo modular de la marca **Belo**. Las categorías y secciones se arman con bloques editables (texto, imagen, video, carrusel y color), en tres layouts: pantalla completa, ancho completo y dos mitades.

- **Versión compartida:** <https://belo-brandbook.vercel.app>, en Vercel, con el contenido guardado en Supabase. Cualquiera con el link la ve y la gente de Paisanos la edita.
- **Versión anterior (respaldo, congelada):** el artifact de Claude <https://claude.ai/artifact/BTAeownzjZUsJDNfH5bxT5>.

## Cómo funciona

El catálogo es **una sola página HTML** sin dependencias de build: markup, estilos y script viven en `src/catalog.html`. La página elige dónde guardar al arrancar:

- **Supabase (Vercel):** si el build recibió `SUPABASE_URL` y la clave pública, el contenido se guarda en Supabase y lo comparten todos los que abren el link. Ver [Guardado compartido](#guardado-compartido-supabase).
- **Dentro de Claude (artifact publicado):**
  - El contenido se guarda en la base compartida del artifact (`db`). Las imágenes y los videos se suben al almacén de archivos (`assets`).
  - Todos los que abren el link ven lo mismo.
  - Solo el dueño puede escribir: la regla de la base es lectura `view`, escritura `admin`. El modo **admin** muestra los "+", el panel de edición y los menús de cada ítem; el modo **viewer** muestra solo el contenido.
- **Vista local:** sin `window.claude` y sin configuración de Supabase, arranca con contenido de demo en memoria y lo indica abajo ("Vista local · los cambios no se guardan"). Sirve para revisar diseño y comportamiento sin tocar los datos reales.

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
npm test                          # build + flows, panel y menu
```

- Las pruebas recorren los flujos principales: crear y editar bloques, panel, deshacer y rehacer, menú, buscador, temas y mobile.
- `collab.cjs` prueba el guardado compartido con la librería real de Supabase contra un Supabase simulado (`tests/fake-supabase.cjs`): login con Google, permisos, cambios en vivo entre dos editores, conflictos, presencia, archivos, reintentos e importación.
- Las capturas quedan en `tests/output/`, que está ignorado por git.
- Las pruebas bloquean Google Fonts y sirven Lenis desde `tests/fixtures/` y supabase-js desde `node_modules`, así que corren sin red. Por eso en el log aparece `Failed to load resource: net::ERR_FAILED`: es esperado.
- Para cambiar el puerto: `PORT=8790 npm test`.

## Guardado compartido (Supabase)

- **Proyecto:** `belo-brandbook` (id `tdrlxenjgfvnjzmuixhy`, región São Paulo).
- **Base:** una tabla `docs` con un documento JSON por ruta (`catalog/tree` y `pages/{subId}`), el mismo modelo que el artifact. El esquema está en `supabase/migrations/`.
- **Quién ve:** cualquiera con el link, sin login.
- **Quién edita:** cuentas con email confirmado de `@paisanoscreando.com`. Se entra con Google desde el menú ("Iniciar sesión"). Una cuenta de otro dominio entra en "Solo lectura".
  - Para sumar a una persona puntual: `insert into private.editors (email) values ('alguien@belo.app');`
  - Para sumar un dominio entero: `insert into private.editor_domains (domain) values ('belo.app');`
- **Archivos:** bucket público `assets`. Solo los editores suben y borran.
- **Cambios de varias personas a la vez:**
  - Cada guardado lleva la versión sobre la que se armó. Si alguien guardó antes, la página vuelve a cargar el documento, reaplica el cambio encima y guarda de nuevo, así no se pisan.
  - Los cambios de los demás llegan en vivo, sin recargar.
  - Si dos personas confirman el mismo bloque, gana la última. Para evitarlo, en Admin se ve quién está editando: sus iniciales junto a la sección y un contorno con su nombre sobre el bloque.
  - Abajo a la derecha (en Admin) se ve quién editó la sección que estás mirando y cuándo.
- **Historial:** cada versión guardada queda en `doc_revisions`. Para volver atrás una sección, hay que copiar `data` de la revisión que corresponda a `docs` desde el editor SQL de Supabase.
- **Sin conexión:** si un guardado falla, el indicador pasa a "Sin guardar" y se reintenta solo. Si cerrás la pestaña con cambios pendientes, el navegador avisa.

### Configuración

- El build lee `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (o `SUPABASE_ANON_KEY`) y los inyecta en la página. Son valores públicos: lo que protege los datos son los permisos de la base. Nunca se usa la clave secreta (`service_role`), y el build la rechaza si se la pasan por error.
- **En Vercel:** cargar las dos variables en Settings → Environment Variables, para Production y Preview.
- **En local:** crear `.env.local` (ignorado por git) con las dos variables y correr `npm run serve`. Sin ese archivo, la página arranca en vista local.
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
    categories: [{ id, name, subs: [{ id, name }] }]
  }
  ```
- **`pages/{subId}`:** los bloques de cada sección, en orden.
  ```js
  { rows: [{ id, layout: 'fullscreen' | 'full' | 'half', h, slots: [slot], overlay? }] }
  ```
  - `slot.type` puede ser `text`, `image`, `video`, `carousel` o `color`.
  - Los textos guardan sus `blocks` con `font`, `size`, `weight`, `lh`, `ls`, `align` y `upper`.
  - Las imágenes y los videos guardan el `asset`: el id del archivo subido. En Supabase es el nombre del objeto en el bucket `assets`; en el artifact se sirve en `/_blob/<id>`.
  - `overlay` es el texto opcional sobre un bloque de pantalla completa.

## Publicar cambios

1. Editá `src/catalog.html`.
2. Corré `npm run build` y revisá en `npm run serve`.
3. Pedile a Claude que publique `dist/artifact.html` en el artifact existente, con el mismo link, para que no cambie la URL ni se pierdan los datos.

El contenido (textos, imágenes, categorías) vive en la base del artifact y no en este repo, así que publicar código nuevo no pisa lo que ya está cargado.

### Vercel

- El repo está conectado a Vercel (proyecto `belo-brandbook`): cada push a `main` se despliega solo, y cada rama tiene su preview.
- `vercel.json` le indica que corra `node scripts/build.mjs`, que no hace falta instalar dependencias y que sirva la carpeta `dist/`.
- Con las variables de Supabase cargadas, la versión de Vercel guarda en Supabase. Sin ellas, cae en la vista local de demo.
- `dist/` en el repo se genera sin configuración de Supabase, para publicarlo como artifact.

## Créditos y licencias

- **Phudu** (variable, 300–900): © The Phudu Project Authors, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`). Se embebe un subset en la página.
- **Plus Jakarta Sans:** se carga desde Google Fonts (OFL).
- **Lenis** 1.3.26 (MIT): se carga desde jsDelivr. Hay una copia en `tests/fixtures/` solo para las pruebas.
- **supabase-js** 2.117.2 (MIT): se carga desde jsDelivr con hash de integridad, solo en modo Supabase.
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
