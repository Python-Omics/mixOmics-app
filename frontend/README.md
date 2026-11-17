# Pythomics — Frontend (Electron)

Aplicación de escritorio para análisis multi-ómico **sin código**, construida en
**Electron + Vite + React + TypeScript + Tailwind**.

El frontend es una de las tres piezas del proyecto: habla con el backend local
(FastAPI) **exclusivamente por el puente IPC de Electron** y nunca accede al
puerto por su cuenta.

---

## Requisitos

- **Node ≥ 20.10** (probado con Node 22 y 26) y **npm ≥ 10**
- **Python 3.13+** (probado con 3.14) en el venv de `backend/.venv` — es lo que
  el proceso Electron levanta como backend. Si no está, la UI abre igual pero
  el badge dice "Backend con error" y el panel de logs muestra el detalle.
- **R + el paquete `mixOmics`**: **solo** para el DIABLO. Sin R, la app
  arranca igual y `/v1/health` informa que no está disponible.

## Instalar

```bash
cd frontend
npm install
```

> **Detección automática de entorno:** al iniciar, Pythomics detecta si está
> corriendo en Linux con un compositor Wayland estricto (Hyprland, Sway,
> River, Wayfire, Cage) leyendo `WAYLAND_DISPLAY` y `XDG_CURRENT_DESKTOP`.
> Solo en ese caso aplica los flags de compatibilidad (`--no-sandbox`,
> `--disable-gpu`, `--in-process-gpu`, etc.) y desactiva el sandbox del
> renderer. En macOS, Windows y Linux con X11/Wayland tolerante (GNOME, KDE
> Plasma 6) la app arranca en modo seguro con GPU acceleration.
>
> **Opt-in al sandbox estricto** (anula la detección automática):
>
> ```bash
> PYTHOMICS_STRICT_SANDBOX=1 npm run dev
> ```
>
> **Matriz de compat:**
>
> | OS / Compositor | Flags de compat | Sandbox renderer | GPU |
> |---|---|---|---|
> | macOS | ❌ | ✅ | ✅ (Metal) |
> | Windows | ❌ | ✅ | ✅ (DirectX) |
> | Linux X11 | ❌ | ✅ | ✅ |
> | Linux GNOME Wayland | ❌ | ✅ | ✅ |
> | Linux KDE Plasma 6 Wayland | ❌ | ✅ | ✅ |
> | Linux Hyprland (Omarchy) | ✅ | ❌ | ❌ |
> | Linux Sway / River / Wayfire / Cage | ✅ | ❌ | ❌ |
> | Cualquiera + `PYTHOMICS_STRICT_SANDBOX=1` | ❌ | ✅ | ✅ |

> **Si Electron no arranca con el error "Electron failed to install
> correctly":** npm ≥ 10 bloquea los `postinstall` por defecto. Solución:
>
> ```bash
> # 1) Limpiar la caché previa de Electron
> rm -rf ~/.cache/electron
>
> # 2) Reinstalar aceptando los install scripts
> rm -rf node_modules/electron
> npm install --foreground-scripts
>
> # 3) Si la descarga se queda colgada (raro en algunos entornos con
> #    npm 10+), bajar el binario a mano y extraerlo:
> URL=https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-linux-x64.zip
> curl -L -o /tmp/electron.zip "$URL"
> rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
> unzip -q /tmp/electron.zip -d node_modules/electron/dist
> # OJO: usar printf (sin \n). Si se usa echo, queda un newline en
> # path.txt y Electron intenta arrancar ".../dist/electron\n".
> printf "electron" > node_modules/electron/path.txt
> printf "33.4.11" > node_modules/electron/dist/version
> rm /tmp/electron.zip
> ```

## Correr en desarrollo

```bash
npm run dev
```

Esto levanta dos procesos coordinados:

1. **Vite** (renderer): HMR en `http://localhost:5173`
2. **Electron** (main): abre la ventana, espera a que Vite esté listo, spawnea
   el backend Python en `127.0.0.1:8501`, y solo después muestra la UI

Las DevTools de Electron se abren automáticamente en modo `detach`.

## Build de producción (local, sin empaquetar)

```bash
npm run build
npm start
```

Compila el renderer con Vite y el main con `tsc`, luego abre Electron contra
los artefactos.

En producción el renderer se sirve bajo el esquema propio **`app://pythomics/`**
(registrado en `electron/main.cjs`), no con `file://`. Motivo: con `file://` el
documento tiene origen opaco (`null`) y la CSP —que usa `script-src 'self'`—
bloquea el bundle JS/CSS entero, así que la app no arranca. Con un esquema
registrado como `standard` el origen es real, la CSP puede usar `'self'` sin
relajarse y el guard de path traversal del handler impide salir de `dist/`.

### La CSP

La CSP vive en el `<meta http-equiv>` de `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' http://127.0.0.1:8501 ws://127.0.0.1:5173 http://localhost:5173 ws://localhost:5173;
```

Dos puntos que parecen excepciones y no lo son:

- **`img-src` incluye `blob:`**: las figuras del análisis llegan al renderer
  como base64 por el canal `api:file` y el renderer arma un `blob:` URL con
  esos bytes. Son URLs *origin-scoped* creadas por el propio renderer, no una
  apertura de origen.
- **`connect-src` nombra el puerto del backend**: es la whitelist de
  `fetch` para el proceso main. El renderer nunca usa `fetch` contra el
  puerto (todo pasa por IPC), pero la whitelist queda explícita y no abierta.

El anti-FOUC vive en `public/app-init.js` (no inline en
`index.html`) por la misma razón: `script-src 'self'` no incluye
`'unsafe-inline'`, así que un `<script>` inline quedaría bloqueado. Al ser un
archivo del mismo origen, la CSP lo permite sin cambios.

Ese script aplica, antes del primer paint:

- el **tema** de colores (`data-theme`),
- el **idioma** (`lang` y `data-locale`),
- el **título** de la ventana (`document.title`).

Va cargado **después** del `<title>` en el `<head>` a propósito: si el script
corriera antes de que el parser procesara el `<title>`, el parser lo sobrescribiría
después y el título quedaría en español.

El tagline del splash se resuelve con `content: attr()` en CSS, que tampoco
necesita JS: el texto vive en atributos `data-tagline-es` / `data-tagline-en` del
HTML y el selector `[data-locale='en']` elige cuál mostrar.

## Regla de i18n (obligatoria)

**Ningún texto visible al usuario puede estar hardcodeado en el renderer.**

Todo texto va en los catálogos y se accede con `t('clave')`:

```tsx
import { useTranslate } from '../i18n';

const t = useTranslate();
return <button>{t('home.cta')}</button>;
```

- **Catálogos**: `src/i18n/es.json` y `src/i18n/en.json`. Claves **planas con punto**
  (`home.cta`), no anidadas. `es.json` es la fuente de verdad de las claves.
- **Tipos**: `MessageKey` sale de `es.json`, así que una clave mal escrita es un
  **error de TypeScript** → build roto, no un `undefined` en producción.
- **Paridad**: los dos catálogos tienen que tener las mismas claves. Lo verifica
  `src/i18n/parity.ts` a nivel de tipos.
- **Plurales**: con sintaxis ICU, nunca con `count === 1 ? '' : 's'`.

```json
"load.filesCount": "{count, plural, one {# archivo cargado} other {# archivos cargados}}"
```

### El guardián

```bash
npm run check:i18n
```

Corre **dentro de `npm run build`**, así que un texto hardcodeado rompe el build.
Verifica tres cosas:

1. Que no haya texto visible al usuario hardcodeado (texto JSX, `aria-label`,
   `placeholder`, `title`, `alt`, y propiedades `label`/`description`/… de objeto).
2. Que los dos catálogos tengan las mismas claves.
3. Que no queden claves sin uso (una traducción muerta no se mantiene).

Usa el parser de TypeScript, no regex: las genéricas como `useState<Step>('load')`
no se confunden con texto JSX.

### Qué NO se traduce

La nomenclatura científica va en inglés (RNF-U-3): `PCA`, `PLS-DA`, `sPLS-DA`,
`DIABLO`, `keepX`, `mixOmics`, nombres de genes y lípidos, nombres de datasets.
Está en la lista `NOT_TRANSLATABLE` del guardián. Si se agrega un término
técnico nuevo, hay que agregarlo ahí.

Los mensajes del backend (`detail` de FastAPI) se interpolan tal cual: no se
traducen en el renderer. Los errores del backend llegan en su propio sobre
(`{"error": {code, message_key, detail}}`) y el renderer traduce la clave.

## Cómo se conecta con el backend

El preload expone `window.pyxAPI` con tres grupos de funciones:

| Grupo | Función | Qué hace |
|---|---|---|
| Estado | `getBackendStatus()` | Consulta si el subproceso Python está vivo |
| Estado | `restartBackend()` | Mata y vuelve a spawnear |
| HTTP | `api.get/post/delete(path, body)` | Proxy a `http://127.0.0.1:8501{path}` |
| HTTP | `api.upload(path, filename, content)` | Subida multipart: el proceso main arma el cuerpo leyendo el archivo del disco |
| HTTP | `api.getFigure(jobId, name)` | Pide un PNG por el canal `api:file` y lo devuelve en base64 |
| Archivos | `getPathForFile(file)` | Ruta real del archivo que el usuario eligió (autorización de un solo uso) |
| Streams | `onBackendLog(cb)` → unsubscribe | Eventos `backend:log` |
| Streams | `onBackendExit(cb)` → unsubscribe | Eventos `backend:exit` |
| Streams | `onBackendError(cb)` → unsubscribe | Eventos `backend:error` |

El renderer **nunca** accede al puerto `8501` directamente: todo va por el main
process vía IPC, lo que mantiene `contextIsolation: true` y el sandbox del
renderer.

### El token compartido

Escuchar en `127.0.0.1` no vuelve privado al backend: CORS cerrado impide que
una página web **lea** la API, pero no que le **escriba**. Por eso toda
petición lleva la cabecera `X-Pythomics-Token`, con un token que genera el
proceso Electron al arrancar y que viaja por el canal del spawn. **El token
nunca llega al renderer** y el proceso main lo agrega a cada petición.

### El canal `api:file`

`api:request` devuelve JSON o texto: **no soporta binario**. Una figura es un
PNG, así que tiene su propio canal (`api:file`): el proceso main la pide al
backend (con el token) y la devuelve como `{mime, dataBase64}`; el renderer arma
un `blob:` URL con esos bytes. La alternativa —meter el base64 dentro del JSON
del job— multiplicaría el tamaño de la respuesta del job.

## Las figuras de la pantalla de resultados

Las figuras del análisis las dibuja el **worker** (el proceso hijo): el
renderer solo las muestra. El backend manda, por cada figura, su `kind`, su
ruta dentro del directorio del job y sus dimensiones en píxeles (leídas de la
cabecera del PNG).

| `kind` | Qué es | Dónde se dibuja |
|---|---|---|
| `pca` | Sample plot del PCA | `pythomics.visualizations.plot_pca` |
| `biomarkers` | Loading plot del DIABLO (un panel por bloque) | `pythomics.visualizations.plot_biomarkers` |
| `heatmap` | Heatmap clusterizado del DIABLO (CIM: muestras en las filas, variables en las columnas) | `pythomics.visualizations.plot_cim` |
| `network` | Red de relevancia del DIABLO (las variables de un bloque que se relacionan con las de otro) | `pythomics.visualizations.plot_network` |
| `circos` | Círculo de correlaciones del DIABLO | `pythomics.visualizations.plot_circos` |

El **heatmap** es el *Clustered Image Map* (CIM) de la biblioteca: las
muestras en las filas (coloreadas por clase), las variables en las columnas
(coloreadas por bloque) y el valor de la variable como color, con los dos
dendrogramas de la jerarquía. Como la biblioteca dibuja **todas** las
variables del modelo (en breast.TCGA son 526: 200 de mRNA, 184 de miRNA y 142
de proteína), el worker le pasa un modelo **recortado** a las 20 variables con
mayor `|loading|` de cada bloque: un mapa de 500 columnas no se lee y la red
de relevancia sería un enredo. El recorte no cambia el modelo del análisis:
solo la vista que se dibuja.

Los identificadores de muestra aparecen en el heatmap solo cuando hay hasta
60 muestras: con más, los nombres se superponen y el color de la fila ya
dice de qué clase es cada muestra.

Ninguna figura puede tumbar el trabajo: si una falla (falta una dependencia,
R devuelve un error, se queda sin memoria), el worker lo deja escrito en su
log y el job sigue con las demás.

### La grilla: las figuras anchas ocupan la fila completa

La grilla de la sección **Figuras** es de dos columnas, pero una figura
apaisada no se lee en media columna. El ancho y el alto que manda el backend
deciden el span (sin medir la imagen en el DOM):

| Proporción (ancho/alto) | Span | Ejemplos |
|---|---|---|
| ≥ 1.25 | Fila completa (`lg:col-span-2`) | loading plot (1570×697), heatmap (1584×1065), red de relevancia (1185×818) |
| < 1.25 | Una columna | círculo de correlaciones (954×1007) |

### La vista ampliada

El problema real de las figuras es de **tamaño**, no de resolución: los PNG
tienen entre 950 y 1600 px de ancho y se mostraban reducidos. La solución es
la estándar para figuras científicas: al hacer click en una figura se abre en
grande.

- La miniatura es un **botón real** con `aria-label` (`results.figureExpand`):
  se opera con teclado y el lector de pantalla anuncia qué se abre.
- La vista ampliada es un `role="dialog"` con `aria-modal` y nombre
  accesible (`results.figureDialog`), montado en un **portal** al `body`: así
  el overlay cubre toda la ventana y no hereda el `space-y` del panel de
  resultados (que lo bajaba 16 px) ni el `overflow` de `<main>`.
- Se cierra con **Escape**, con el botón de cerrar y con un **click fuera**
  de la imagen, y el foco **vuelve al disparador** al cerrarse.
- La imagen ampliada es el mismo `blob:` URL que la miniatura: no se vuelve a
  pedir la figura al backend.

Cada figura lleva un pie de foto con su etiqueta traducida
(`results.figureKind.*`) y sus dimensiones en píxeles.

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite + Electron orquestados con `concurrently` + `wait-on` |
| `npm run build` | Compila main (`tsc`) y renderer (`vite build`), con el guardián de i18n en el medio |
| `npm start` | Build + abre Electron |
| `npm run typecheck` | Valida tipos sin emitir (main y renderer) |
| `npm run check:i18n` | Guardián: ningún texto hardcodeado, catálogos en paridad, sin claves muertas |
| `npm run test:e2e` | Suite de Playwright (E2E contra el mock del preload) |
| `npm run test:coverage` | La misma suite E2E **midiendo la cobertura del renderer** (V8 por el protocolo de DevTools, con un reporter propio). Reporte en `frontend/coverage/index.html` (gitignored). Hoy: **46%** de las líneas del renderer |
| `npm run smoke` | Build + abre Electron contra el build y verifica la app real (exit 0/1) |

## Las tres suites

| Suite | Comando | Qué cubre |
|---|---|---|
| Backend | `cd ../backend && .venv/bin/python -m pytest tests/ -q` | Ingesta, recetas, alineación, jobs, worker, figuras, provenance, DIABLO y la costura con el renderer |
| Frontend (E2E) | `npm run test:e2e` | La UI contra el **mock** del preload: pipeline completo, i18n, accesibilidad, CSP, anti-FOUC y la costura con el backend real |
| Smoke | `npm run smoke` | La app real (Electron): el renderer monta, la CSP, el canal de figuras, la rotación del log y el origen `app://` |

### El mock de Playwright

Los E2E corren en el browser, donde no existe `window.pyxAPI`: el mock
(`playwright.config.ts`, función `installApiMock`) lo inyecta con
`page.addInitScript`. El mock:

- responde con la forma del backend real (receta → alineación → target → job);
- registra cada llamada en `window.__apiCalls` (para verificar contra qué
  rutas pega el frontend);
- registra cada respuesta en `window.__apiResponses`.

### La costura con el backend real

Los E2E corren contra el mock y el smoke contra el backend real, pero ninguno
mira al otro: si el contrato cambia de forma, el mock y el backend divergen y
los E2E siguen en verde mintiendo.

El contrato vive en **un solo archivo**, `backend/tests/contract.json`, y los
dos lados lo leen:

- el **test del backend** (`backend/tests/test_contract_seam.py`) reproduce los
  cuerpos canónicos contra la API real y exige que los acepte;
- los **tests del frontend** (`tests/e2e/frontend.spec.ts`) exigen que el
  renderer mande exactamente esos cuerpos y que el mock responda con esos
  campos.

Si el mock y el backend se separan, **los dos tests fallan**.

## La banda multi-omics de Inicio

La pantalla de Inicio muestra, arriba del tagline, una **banda decorativa de
tres paneles científicos**: el PCA de `nutrimouse`, un **circos de mixOmics**
y una tira de heat map. Sale del artboard `design/home-biology-figure/02-multiomics-band.html`.

| Pieza | Dónde |
|---|---|
| `src/components/BiologyBand.tsx` | El componente: los tres paneles en un SVG cada uno |
| `src/lib/home-figure-data.ts` | **Generado**: los números (coordenadas, paths, rampa) |
| `scripts/generate_home_figure.py` (en la raíz del repo) | El generador |

### Los datos son reales, no inventados

El renderer **no calcula nada**: dibuja los números que están inline en
`src/lib/home-figure-data.ts`. Ese módulo lo genera

```bash
cd mixOmics-app
backend/.venv/bin/python scripts/generate_home_figure.py
```

que calcula el PCA con `pythomics.tools.NipalsPCA(n_components=2, center=True,
scale=False)` sobre `frontend/public/datasets/nutrimouse_gene.csv`, toma las
clases de la columna `genotype` de `nutrimouse_meta.csv` (`wt` = círculo,
`ppar` = rombo) y el z-score por variable para el heat map (saturado en ±2.0,
rampa divergente `slate-700 → --p-100 → --p-400`).

El circos del medio usa el **segundo bloque** (`nutrimouse_lipid.csv`, 40
muestras × 21 lípidos): el anillo lleva una variable por sector (los genes
arriba, los lípidos abajo) y las cuerdas son los pares gen/lípid con
**correlación de Pearson real** por encima de `|r| ≥ 0.70` (11 cuerdas de las
2.520 que existen: con 0.65 serían 25 y con 0.60, 47 — a partir de ahí el
centro se vuelve un nudo). Las dos pistas de clase son el perfil (media en z)
de `wt` y de `ppar` variable por variable, siguiendo el anillo.

El generador **verifica contra el artboard**: vuelve a armar el markup de los
tres paneles y lo compara, byte a byte, con el que está inline en el HTML del
diseño. Si divergen, falla y no escribe nada.

> El módulo generado se commitea: el renderer no puede depender de Python ni
> de un paso de build extra.

### Es decorativa

- El contenedor va con `aria-hidden="true"` y los SVG **no** tienen
  `aria-label`: un lector de pantalla no anuncia nada.
- Lo único que dice es la **nomenclatura científica** del circos (los nombres
  de los genes y de los lípidos: `HPNCL`, `C20.2n.6`, …). Son datos, no copy
  de interfaz, así que van inline en el SVG y **no se traducen** (RNF-U-3) y
  no necesitan ninguna clave de i18n nueva.
- Los colores salen de las custom properties (`--p-*`), así que la figura sigue
  al tema activo (`data-theme`): al cambiar de tema, el heat map se repinta con
  la rampa del tema nuevo.
- Con `prefers-reduced-motion: reduce` los paneles quedan visibles y
  estáticos desde el primer frame, y las cuerdas del circos dejan de latir.

## La tarjeta de cada archivo (pantalla de carga)

Cada archivo cargado es **una sola tarjeta** (`FileList.tsx` → `<li>`), con la
preview y su descripción adentro:

```
┌───────────────────────────────────────────────────────────────────┐
│ [icono] breast_TCGA_protein.csv   388.1 KB · 12:02      [ x ]      │
├───────────────────────────────────────┬───────────────────────────┤
│  DataPreview (la tabla, con scroll     │  breast_TCGA_protein      │
│  horizontal propio)                    │  150 muestras × 142 vars  │
│                                        │  [Marcar como metadata]   │
└───────────────────────────────────────┴───────────────────────────┘
```

| Pieza | Dónde |
|---|---|
| `src/components/FileList.tsx` | La tarjeta: encabezado + preview (izquierda) + descripción (derecha) |
| `src/components/DataPreview.tsx` | La tabla de la preview (con su scroll propio) |
| `src/components/FileDetails.tsx` | La descripción: dimensiones, columna de IDs, rol y advertencias |

- **Horizontal a partir de `md` (768px)**: la columna de la descripción mide
  `240px` (`260px` desde `xl`); por debajo, cae debajo de la preview.
- La descripción es una `region` con `aria-label` (`ingest.summaryTitle`) y el
  botón de rol conserva su `aria-pressed`: no hay cards anidadas ni texto
  nuevo (todo sale del catálogo de i18n).
- La página usa `max-w-3xl` (`max-w-5xl` desde `xl`): en pantallas grandes la
  preview tiene aire.

## El scroll del shell (una sola barra de scroll)

El pipeline (Cargar → Configurar → Resultados) tiene **una sola barra de
scroll**: la de `<main>`. La página (el documento) nunca scrollea.

```
html (100%) → body (100%) → #root (100%) → shell (h-full w-full overflow-hidden)
                                                   ├── <aside>  (sidebar)
                                                   └── <main>  (relative flex-1 overflow-auto) ← el scroll
```

Las reglas que lo sostienen:

| Regla | Por qué |
|---|---|
| `html`/`body`/`#root` miden `100%` | El shell ocupa exactamente el viewport. `100vw` (que sí incluye el ancho de los scrollbars) haría que el shell mida de más y agregara una barra horizontal. |
| `<main>` es `relative` | Es el bloque contenedor de los descendientes en `absolute` (los labels `sr-only` de Tailwind son `position: absolute`). Sin `relative`, su bloque contenedor sería el viewport: el `overflow: auto` de `<main>` no los recortaría, el label se escaparía del área scrolleable y **estiraría el documento**. El síntoma era una segunda barra de scroll a la derecha y, al scrollear, un rectángulo vacío con el fondo de la página debajo del shell. |
| Los labels `sr-only` viven en un wrapper `relative` | Su propio bloque contenedor está dentro de `<main>`, así que el recorte del área scrolleable los aplica aunque el ancestro cambie. |

**Regla para los componentes**: nada posicionado en `absolute` (ni `fixed`)
dentro de `<main>` puede quedarse sin un ancestro posicionado. Si el bloque
contenedor cae fuera del área scrolleable, el elemento se escapa de su
`overflow` y estira la página.

El guardián de esta invariante vive en `tests/e2e/layout.spec.ts`: mide
`documentElement.scrollHeight` contra `window.innerHeight` en la pantalla de
Cargar y en la de Configurar (con el DIABLO y su grilla de keepX).

## Estructura del proyecto

```
frontend/
├── package.json
├── playwright.config.ts         ← mock del preload + config de Playwright
├── tsconfig.json                 ← TS renderer (ESM, JSX)
├── tsconfig.electron.json        ← TS main + preload (CommonJS)
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html                    ← CSP + anti-FOUC + splash
├── public/
│   ├── app-init.js               ← tema, idioma y título antes del primer paint
│   └── datasets/                 ← 3 datasets de ejemplo (CSV)
├── electron/
│   ├── main.cjs                  ← BrowserWindow, esquema app://, proxy HTTP, token
│   ├── backend.cjs               ← BackendManager (spawn, waitForPort, logs, rotación)
│   └── preload.cjs               ← contextBridge → window.pyxAPI
├── scripts/
│   └── check-i18n.mjs            ← guardián de i18n
├── src/
│   ├── main.tsx                  ← ReactDOM.createRoot
│   ├── App.tsx                   ← Shell + máquina de estados de 3 pasos
│   ├── styles/globals.css        ← Tailwind + componentes + skip link
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   ├── BiologyBand.tsx       ← banda decorativa de Inicio (3 paneles)
│   │   ├── FileDropzone.tsx
│   │   ├── FileList.tsx
│   │   ├── FileDetails.tsx       ← descripción del archivo (columna derecha)
│   │   ├── DataPreview.tsx
│   │   ├── ModelConfigForm.tsx
│   │   ├── ResultsPanel.tsx
│   │   ├── BiomarkersTable.tsx
│   │   └── ...
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── LoadPage.tsx
│   │   ├── ConfigurePage.tsx     ← dataset, alineación y modelo
│   │   └── ResultsPage.tsx       ← polling del job, progreso y cancelación
│   ├── lib/
│   │   ├── api.ts                ← wrapper sobre window.pyxAPI.api
│   │   ├── types.ts              ← tipos compartidos (IPC, UI, modelos)
│   │   ├── project-state.tsx     ← contexto con el estado del proyecto
│   │   ├── example-datasets.ts   ← catálogo de datasets de ejemplo
│   │   ├── home-figure-data.ts   ← GENERADO: datos de la banda de Inicio
│   │   └── themes.ts
│   └── i18n/
│       ├── es.json              ← fuente de verdad de las claves
│       ├── en.json
│       ├── index.tsx             ← provider + useTranslate
│       ├── messages.ts           ← tipos de las claves
│       └── parity.ts             ← paridad de catálogos a nivel de tipos
└── tests/
    └── e2e/frontend.spec.ts      ← E2E de Playwright
```

## Pendiente para iteraciones siguientes

- Empaquetado con `electron-builder` (instaladores multiplataforma) y embebido
  de Python con PyInstaller
- `keepX` en la UI: hoy el DIABLO corre con el valor predeterminado de
  mixOmics (`keepX = NULL`)
- Preprocesamiento configurable (RF-3), que vive en `pythomics`
- `sPLS-DA` mono-bloque (RF-7)
- Reporte PDF y anotación con LLM (requieren red: RB-9, RNF-S-3)
- Selección de variables en la tabla de scores (hoy identifica las muestras
  por posición: el `ModelResult` no lleva los IDs, que viven en la receta)
