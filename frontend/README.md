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

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite + Electron orquestados con `concurrently` + `wait-on` |
| `npm run build` | Compila main (`tsc`) y renderer (`vite build`), con el guardián de i18n en el medio |
| `npm start` | Build + abre Electron |
| `npm run typecheck` | Valida tipos sin emitir (main y renderer) |
| `npm run check:i18n` | Guardián: ningún texto hardcodeado, catálogos en paridad, sin claves muertas |
| `npm run test:e2e` | Suite de Playwright (E2E contra el mock del preload) |
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
│   │   ├── FileDropzone.tsx
│   │   ├── FileList.tsx
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
