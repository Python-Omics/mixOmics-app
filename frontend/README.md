# Pythomics — Frontend (Electron POC)

Aplicación de escritorio para análisis multi-ómico **sin código**, construida en
**Electron + Vite + React + TypeScript + Tailwind**.

Esta es la **POC** del frontend. El backend (`../backend`) aún está como esqueleto:
sus endpoints existen pero devuelven `null`/`pass`. La POC verifica que el
frontend levante, conecte con el backend y muestre la UI completa.

> **Esta POC no incluye commits:** vive en el working tree hasta que el equipo
> apruebe el resultado.

---

## Requisitos

- **Node ≥ 20 LTS** (probado con Node 22 y 26)
- **npm ≥ 10**
- **Python 3.13.5+** en `PATH` (o un venv en `backend/.venv/`) — necesario para
  que el backend arranque. Si no está, la UI abre igual pero el badge dirá
  "Backend con error" y verás el detalle en el panel de logs.

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
> # 1) Limpiar cache previo de Electron
> rm -rf ~/.cache/electron
>
> # 2) Re-instalar aprobando los install scripts
> rm -rf node_modules/electron
> npm install --foreground-scripts
>
> # 3) Si la descarga se queda colgada (raro en algunos entornos con
> #    npm 10+), bajar el binario a mano y extraerlo:
> URL=https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-linux-x64.zip
> curl -L -o /tmp/electron.zip "$URL"
> rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
> unzip -q /tmp/electron.zip -d node_modules/electron/dist
> # OJO: usar printf (sin \n). Si usás echo, queda un newline en
> # path.txt y Electron intenta spawn-ear ".../dist/electron\n".
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
   el backend Python en `:8501`, y solo después muestra la UI

Las DevTools de Electron se abren automáticamente en modo `detach`.

## Build de producción (local, sin empaquetar)

```bash
npm run build
npm start
```

Compila el renderer con Vite y el main con `tsc`, luego abre Electron contra
los artefactos.

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite + Electron orquestados con `concurrently` + `wait-on` |
| `npm run build` | Compila main (`tsc`) y renderer (`vite build`) |
| `npm start` | Build + abre Electron |
| `npm run typecheck` | Valida tipos sin emitir (main y renderer) |

---

## Smoke test manual (checklist)

Con `npm run dev` corriendo, validar en orden:

- [ ] **Backend arranca antes que la UI**: la ventana de Electron se abre solo
      después de ver `[manager] Python:` en el panel de logs y el badge dice
      "Backend en línea" (verde).
- [ ] **Sidebar con 3 pasos** navegables: "Cargar datos", "Configurar modelo",
      "Resultados". El paso activo tiene `aria-current="step"` (verificable en
      DevTools).
- [ ] **Drag & drop** de un `.csv` o `.tsv`:
      - El archivo aparece en la lista con preview (primeras filas)
      - El panel de status dice "Archivo listo localmente (endpoint pendiente…)"
- [ ] **Click directo** también funciona (file picker)
- [ ] **Validación de formato**: un `.txt` o `.json` es rechazado con mensaje
      en rojo
- [ ] **Botón "Siguiente"** se habilita solo si hay ≥ 1 archivo
- [ ] **Paso 2**: cambiar `model_type` actualiza la descripción debajo del select.
      `keepX` aparece solo en `sPLS-DA` y `DIABLO`.
- [ ] **Ejecutar análisis**: al hacer click, la UI espera y luego salta al
      paso 3. Como el backend aún no implementa el endpoint, `ResultsPanel`
      muestra el banner ámbar "Sin resultados todavía".
- [ ] **Panel de logs**: muestra el `stdout`/`stderr` de uvicorn en vivo, con
      auto-scroll. Botón "Limpiar" funciona.
- [ ] **Cerrar la ventana**: el subproceso Python se mata (verificable con
      `ps aux | grep main.py` antes y después).
- [ ] **Accesibilidad**:
      - `Tab` recorre los interactivos con outline azul visible
      - Skip link "Saltar al contenido principal" aparece con `Tab` desde
        cualquier parte y salta al `<main>`
      - Los emojis (📄, 📊, ✓, etc.) tienen `aria-hidden="true"` (no los
        lee el screen reader)

## Estructura del proyecto

```
frontend/
├── package.json
├── tsconfig.json                 ← TS renderer (ESM, JSX)
├── tsconfig.electron.json        ← TS main + preload (CommonJS)
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── electron/
│   ├── main.cjs                  ← BrowserWindow + spawn backend
│   ├── backend.cjs               ← BackendManager (spawn, waitForPort, logs)
│   └── preload.cjs               ← contextBridge → window.pyxAPI
└── src/
    ├── main.tsx                  ← ReactDOM.createRoot
    ├── App.tsx                   ← Shell + state machine de 3 pasos
    ├── styles/globals.css        ← Tailwind + componentes + skip link
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── TopBar.tsx
    │   ├── BackendStatusBadge.tsx
    │   ├── LogPanel.tsx
    │   ├── FileDropzone.tsx
    │   ├── FileList.tsx
    │   ├── DataPreview.tsx
    │   ├── ModelConfigForm.tsx
    │   ├── ResultsPanel.tsx
    │   └── BiomarkersTable.tsx
    ├── pages/
    │   ├── LoadPage.tsx
    │   ├── ConfigurePage.tsx
    │   └── ResultsPage.tsx
    └── lib/
        ├── api.ts                ← Wrapper sobre window.pyxAPI.api
        ├── types.ts              ← Tipos compartidos (IPC, UI, modelos)
        ├── project-state.tsx     ← Context con estado del proyecto
        └── use-backend-status.ts ← Hook: status + logs streaming
```

## Cómo se conecta con el backend

El preload expone `window.pyxAPI` con dos grupos de funciones:

| Grupo | Función | Qué hace |
|---|---|---|
| Estado | `getBackendStatus()` | Consulta si el subproceso Python está vivo |
| Estado | `restartBackend()` | Mata y vuelve a spawnear |
| HTTP | `api.get/post/delete(path, body)` | Proxy a `http://127.0.0.1:8501{path}` |
| Streams | `onBackendLog(cb)` → unsubscribe | Eventos `backend:log` |
| Streams | `onBackendExit(cb)` → unsubscribe | Eventos `backend:exit` |
| Streams | `onBackendError(cb)` → unsubscribe | Eventos `backend:error` |

El renderer **nunca** accede al puerto `8501` directamente. Todo va por el main
process vía IPC, lo que mantiene `contextIsolation: true` y `sandbox: true`.

## Pendiente para iteraciones siguientes

- Implementar los endpoints reales del backend (los `pass` actuales)
- Gráficos reales con Plotly o Recharts
- Soporte para múltiples bloques (DIABLO necesita 2+ archivos alineados)
- Selector de API key de LLM en la UI (RF-20)
- Empaquetado con `electron-builder` (instaladores multiplataforma)
- Tests E2E con Playwright + Spectron