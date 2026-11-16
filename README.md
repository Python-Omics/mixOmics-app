# Pythomics

Pythomics es un port a Python de la librería `mixOmics` (R/Bioconductor) para
integración multi-ómica, junto con una aplicación de escritorio (Electron) que
permite a biólogos sin experiencia en programación **cargar matrices
multi-ómicas, alinearlas por identificador de muestra, ejecutar PCA o DIABLO y
ver los resultados con sus figuras**, todo en el equipo del usuario: las
matrices crudas nunca salen de la máquina.

El cálculo estadístico se ejecuta 100% en local. En versiones futuras, con
consentimiento explícito, se podrán consultar APIs biológicas públicas
(UniProt, MyGene) y servicios de LLM para anotar biomarcadores y asistir el
análisis preliminar, enviando solo identificadores genéricos y métricas
agregadas. La librería se publica con tolerancia numérica 1e-6 frente a R y
licencia GPL-3.0-or-later.

---

## Qué hace la app hoy

El pipeline son tres pasos: **Cargar → Configurar → Resultados**.

### 1. Cargar

Se aceptan archivos `.csv` y `.tsv` (RB-14). La convención de columnas es la
de Python: **una fila por muestra, una columna por variable, y la primera
columna es el ID de muestra**. El backend valida antes de guardar:

| Qué se valida | Qué pasa |
|---|---|
| Extensión | `400` con `E_FILE_EXTENSION` |
| Archivo vacío o ilegible | `400` con `E_EMPTY_FILE` |
| Ancho de las filas | `400` con `E_MALFORMED_FILE` (indica línea, esperados y encontrados) |
| IDs de muestra duplicados | `409` con `E_DUPLICATE_SAMPLES` (se listan los duplicados) |
| Celdas vacías | `400` con `E_MISSING_VALUES` (se cuentan y se nombran las columnas) |

Las columnas no numéricas **no** rechazan la carga: se registran y se listan
como advertencia. El **rol** de cada archivo (bloque de variables o tabla de
metadata) lo declara el usuario, no el tipo de las columnas.

El archivo lo lee el proceso Electron, no el renderer: el renderer manda solo
la ruta y el cuerpo multipart se arma leyendo el archivo del disco.

### 2. Configurar

Tres secciones:

- **Dataset**: la receta que se crea en el backend (qué bloques entran y con
  qué rol). El backend guarda la **receta**, nunca las matrices.
- **Alineación**: intersección de los IDs de muestra de los bloques, en el
  orden canónico del primer bloque, con el reporte de las descartadas por
  bloque. El usuario la confirma; sin esa confirmación el modelo no se puede
  encolar.
- **Modelo**: PCA o DIABLO, cantidad de componentes y variable de clase.

### 3. Resultados

La pantalla de resultados muestra lo que devuelve el job: la etapa actual
(progreso **por etapa, sin porcentaje**), la varianza explicada, los loadings,
los scores, los biomarcadores, las correlaciones entre bloques, las figuras y
la trazabilidad del análisis (versión de la librería, de R y de mixOmics,
semilla, parámetros efectivos y huella SHA-256 de los archivos).

---

## Qué está diferido, y por qué

| Qué | Estado | Por qué |
|---|---|---|
| **Preprocesamiento (RF-3)** | Fuera del MVP | Decisión del operador. El MVP no preprocesa: los `NaN` se rechazan en la ingesta (el peor modo de fallo posible en una herramienta científica es un resultado plausible pero incorrecto, y `NipalsPCA` no falla con `NaN`: los absorbe). Los modelos usan los valores predeterminados de mixOmics (`center=True`, `scale=False`), que quedan registrados en la `provenance`. Las operaciones (centrado, escalado, imputación, filtro de varianza) se implementarán en `pythomics`. |
| **`sPLS-DA` / `PLS-DA` mono-bloque (RF-7)** | Fuera del MVP | No hay wrapper en la librería. El selector de modelos solo ofrece PCA y DIABLO, así que la app no promete lo que nadie implementa. |
| **Reporte PDF con LLM** | No implementado | `BioAnnotator` y `BioLLM` salen a la red y el MVP es 100% local (RB-9, RNF-S-3). `/v1/model_llm/` y `/v1/reporte/` responden `501`. |
| **Selección de variables (`keepX`)** | No expuesto en la UI | El DIABLO corre con el valor predeterminado de mixOmics (`keepX = NULL`): hay biomarcadores, pero la selección de variables no se puede elegir desde la app. |
| **Paridad numérica contra R** | La mide el equipo de la librería | La suite de paridad se ajusta en paralelo, en el repositorio hermano. El DIABLO llama a `block.splsda` de R, así que su resultado **es** el de mixOmics. |
| **Estrés 500 × 20.000** | Diferido | Se retoma cuando se retome el estrés o antes de liberar la app a usuarios con archivos grandes. |

---

## Requisitos

| Requisito | Para qué | Notas |
|---|---|---|
| **Node ≥ 20.10** y npm ≥ 10 | Frontend (Vite + Electron) | Probado con Node 22 y 26 |
| **Python ≥ 3.13** | Backend (FastAPI + worker) | Probado con 3.14; se usa un venv propio en `backend/.venv` |
| **R + el paquete `mixOmics`** | **Solo el DIABLO** | Sin R la app **arranca igual**: `/v1/health` informa que no hay R, la UI deshabilita el DIABLO y la API responde `503` (`E_R_NOT_AVAILABLE` / `E_MIXOMICS_NOT_AVAILABLE`). El PCA es Python puro y no lo necesita. |

---

## Setup

El setup es **una sola vez por máquina**.

```bash
# 1. Backend: crear el venv e instalar las dependencias
cd mixOmics-app/backend
python -m venv .venv
.venv/bin/pip install --upgrade pip          # Windows: .venv\Scripts\pip
.venv/bin/pip install -r requirements.txt

# 2. Frontend: instalar las dependencias de Node
cd ../frontend
npm install
```

> **Nota sobre `omics/`:** la librería `pythomics` vive un nivel arriba
> (`mixomics-python/omics/`). `backend/requirements.txt` la instala en modo
> editable desde `../../omics` con los extras `[r,viz]` (rpy2 y las
> dependencias de graficado). Si se mueve la app, hay que actualizar ese path.

---

## Ejecución

### Desarrollo (una sola terminal)

```bash
cd mixOmics-app/frontend
npm run dev
# → Vite arranca en :5173
# → Electron espera a Vite y levanta el backend Python en 127.0.0.1:8501
# → La ventana abre cuando el backend responde
```

### Backend aislado (para depurar o testear la API por separado)

```bash
cd mixOmics-app/backend
.venv/bin/python main.py
# → Swagger en http://127.0.0.1:8501/docs
```

Al levantarlo a mano se **genera un token de API** y se muestra por pantalla:
toda ruta lo exige en la cabecera `X-Pythomics-Token`. Cuando el backend lo
levanta Electron, el token viaja por el canal del spawn y nunca llega al
renderer.

### Producción (local, sin empaquetar)

```bash
cd mixOmics-app/frontend
npm run build
npm start
```

El renderer se sirve bajo el esquema propio `app://pythomics/` (registrado en
`electron/main.cjs`), no con `file://`: con `file://` el documento tiene origen
opaco y la CSP bloquea el bundle. `npm run smoke` hace el build y corre las
verificaciones automáticas sobre la app real.

---

## Las tres suites

| Suite | Comando | Qué cubre |
|---|---|---|
| **Backend** | `cd backend && .venv/bin/python -m pytest tests/ -q` | Ingesta, recetas, alineación, jobs, worker, figuras, provenance, DIABLO y **la costura con el renderer** |
| **Frontend (E2E)** | `cd frontend && npx playwright test --project=chromium` | La UI contra el **mock** del preload: pipeline completo, i18n, accesibilidad, CSP, anti-FOUC y **la costura con el backend real** |
| **Smoke** | `cd frontend && npm run smoke` | La app real (Electron): que el renderer monte, la CSP, el canal de figuras, la rotación del log y el origen `app://` |

### La costura entre el renderer y el backend

Los E2E de Playwright corren contra el **mock** y el smoke corre contra el
**backend real**, pero ninguno de los dos mira al otro: si el contrato cambia
de forma (un nombre de campo, el cuerpo de una petición, una respuesta), el
mock y el backend divergen y los E2E siguen en verde mintiendo.

El contrato vive en **un solo archivo**, `backend/tests/contract.json`, y los
dos lados lo leen:

- **el test del backend** (`backend/tests/test_contract_seam.py`) reproduce los
  cuerpos canónicos contra la **API real** y exige que los acepte y que las
  respuestas traigan los campos que el renderer lee;
- **el test del frontend** (`frontend/tests/e2e/frontend.spec.ts`) exige que el
  renderer mande exactamente esos cuerpos y que el mock responda con esos
  campos.

Si el mock y el backend se separan, el contrato deja de ser el punto de
encuentro y **los dos tests fallan**.

Las tres suites también corren **solas en cada push y en cada pull request**:
ver la sección [CI](#ci).

---

## CI

Cada **push** y cada **pull request** corren las tres suites en GitHub Actions
(`.github/workflows/ci.yml`). El pipeline **falla** si alguna suite falla: no
hay `continue-on-error` en ningún paso.

| Job | Plataformas | Qué corre |
|---|---|---|
| **backend** | `ubuntu-latest` (con R), `windows-latest` y `macos-latest` (sin R) | `pytest tests/ -q` (desde `backend/`) |
| **frontend** | `ubuntu-latest`, `windows-latest` y `macos-latest` | `npm ci`, `npm run typecheck`, `npm run build` (con el guardián de i18n) y `npx playwright test --project=chromium` |
| **smoke** | `ubuntu-latest` | `xvfb-run -a npm run smoke`: la app Electron real, con un job de verdad contra el backend |

Detalles que importan:

- **R solo en Linux.** En Linux se instala R con el paquete `mixOmics` de
  Bioconductor, y la biblioteca de R queda **cacheada** (la clave del caché
  lleva la versión de R y el hash de los requirements): la primera corrida
  tarda, las siguientes no. En Windows y macOS la librería se instala **sin**
  el extra `r` (rpy2 necesita las cabeceras de R) y las pruebas de DIABLO se
  **omiten** solas: son las que necesitan R.
- **El smoke necesita un display.** En el runner de Linux se usa `xvfb-run`,
  y hacen falta las librerías de sistema de Electron/Chromium.
- **`fail-fast: false`** en las matrices: que una plataforma falle no cancela
  las otras dos.
- **Los dos repos se clonan como hermanos** (`mixOmics-app/` y `omics/`),
  porque `backend/requirements.txt` instala la librería en modo editable con
  la ruta relativa `../../omics`, que se resuelve contra el directorio de
  trabajo.

### El secret `PYTHOMICS_LIBRARY_TOKEN`

La librería `pythomics` vive en un repositorio **privado**
(`Sephir0ath/omics`) y el CI la clona en cada corrida. Para eso hace falta un
secret del repositorio:

| Qué | Dónde |
|---|---|
| **Nombre** | `PYTHOMICS_LIBRARY_TOKEN` |
| **Dónde se crea** | `Settings → Secrets and variables → Actions → New repository secret`, en el repositorio `Python-Omics/mixOmics-app` |
| **Qué es** | Un **Personal Access Token** con permiso de **leer** el repositorio `Sephir0ath/omics` |
| **Alcance mínimo** | Un PAT *classic* con el scope `repo`, o un PAT *fine-grained* con lectura de contenidos (`Contents: Read-only`) sobre `Sephir0ath/omics` |

Cómo generarlo:

1. GitHub → tu perfil → **Settings** → **Developer settings** → **Personal access tokens**.
2. **Tokens (classic)** → **Generate new token (classic)**, o **Fine-grained tokens** → **Generate new token**.
3. En el PAT *classic*, marca el alcance **repo**. En el *fine-grained*, elige el repositorio `Sephir0ath/omics` y el permiso **Contents: Read-only**.
4. Copia el token (solo se muestra una vez) y pégalo en el secret del repositorio.

Sin el secret, los jobs **backend** y **smoke** fallan con un mensaje que
explica qué crear (no con un 404 críptico del checkout). Ojo: los pull
requests que llegan de un *fork* no reciben los secrets, así que en esos el
backend y el smoke no pueden correr (el frontend sí).

La librería se clona **de su rama por defecto** (sin `ref`): el equipo de la
librería trabaja en paralelo y el CI tiene que avisar cuando una de sus
cambios rompe la app.

### Qué no cubre el CI

- **R fuera de Linux**: no hay una matriz con R en Windows y macOS (R ahí es
  frágil), así que la parte de DIABLO solo se prueba en Linux.
- **El smoke solo corre en Linux**: no hay un equivalente con display en
  Windows y macOS.
- **La paridad contra R** no se mide en el CI: la ajusta el equipo de la
  librería en paralelo (ver [Qué está diferido, y por qué](#qué-está-diferido-y-por-qué)).

---

## Arquitectura

```
renderer (React + TypeScript)
   │  window.pyxAPI.*            ← única puerta; el renderer NO conoce el puerto
   ▼
Electron main (main.cjs + preload.cjs)
   │  fetch → 127.0.0.1:8501    ← proxy + frontera de política (token compartido)
   ▼
FastAPI (uvicorn, :8501)
   │  valida, orquesta, serializa  ← NO importa pythomics ni rpy2
   ▼
Worker (subproceso)
      pythomics → rpy2 → R (mixOmics)
```

| Frontera | Qué garantiza |
|---|---|
| Renderer ↔ Electron | El renderer **nunca** habla con el puerto: todo pasa por el puente IPC, con `contextIsolation` y una CSP estricta. El token compartido vive en el main process. |
| API ↔ worker | El dataset es una **receta**, nunca las matrices: la API guarda rutas, forma, IDs y decisiones; el worker es el único que carga, alinea y ajusta. |
| API ↔ cálculo | El cálculo corre en un **proceso hijo**: cancelar un job es matarlo, y un fallo de R no tumba la API. La cola es serial (un análisis a la vez) para respetar el techo de 4 GB. |
| Worker ↔ renderer | Las figuras se generan en el worker y viajan por un canal IPC propio (`api:file`, base64): el renderer arma un `blob:` URL y nunca accede al puerto. |

---

## Estructura de carpetas

```
mixOmics-app/                    ← raíz del repo
├── AGENTS.md                    ← contexto operativo para agentes
├── README.md                    ← este archivo
├── Avance_Escrito_…md          ← spec canónica
├── backend/                     ← FastAPI en :8501
│   ├── main.py                  ← entrypoint uvicorn
│   ├── requirements.txt         ← incluye -e ../../omics[r,viz]
│   ├── ESTRUCTURA.md            ← contrato de la API, endpoint por endpoint
│   ├── app/
│   │   ├── api.py               ← endpoints (valida, orquesta, serializa)
│   │   ├── schemas.py           ← esquemas Pydantic del contrato
│   │   ├── errors.py            ← registro de códigos de error
│   │   ├── ingest.py            ← parser de bloques (CSV/TSV)
│   │   ├── datasets.py          ← registro de recetas (recetas, no datos)
│   │   ├── jobs.py              ← cola serial, proceso hijo, cancelación
│   │   ├── worker.py            ← el hijo que materializa y ajusta
│   │   ├── capabilities.py      ← sonda de R (subproceso, single-flight)
│   │   ├── auth.py              ← token compartido
│   │   └── paths.py             ← directorios de datos
│   └── tests/                   ← pytest + el contrato compartido
└── frontend/                    ← Electron + Vite + React + TS
    ├── electron/                ← main, preload y gestor del backend
    ├── public/datasets/         ← 3 datasets de ejemplo (CSV)
    ├── scripts/check-i18n.mjs   ← guardián de i18n (corre en el build)
    ├── src/                     ← React (pages, components, lib, i18n)
    └── tests/e2e/               ← Playwright (mock del preload)
```

El pipeline vive en `.github/workflows/ci.yml` (ver [CI](#ci)).

---

## Datasets de ejemplo

Para probar el flujo sin preparar datos propios, la app trae 3 datasets
extraídos de `mixOmics` (R) como CSV estáticos en `frontend/public/datasets/`:

- `nutrimouse_gene.csv` + `nutrimouse_lipid.csv` + `nutrimouse_meta.csv`
- `srbct_gene.csv` + `srbct_meta.csv`
- `breast_TCGA_{mrna,mirna,protein}.csv` + `breast_TCGA_meta.csv`

La convención de los CSV es la misma que en la carga: una fila por muestra, una
columna por variable y la primera columna es el ID de muestra (`sample`), para
alinear por ID y no por posición (RB-3).

Regeneración (requiere R + `mixOmics` + `rpy2`):

```bash
cd mixOmics-app
backend/.venv/bin/python scripts/extract_mixomics_datasets.py
```

El script **valida cada bloque contra R** (forma, nombres, IDs y valores)
antes de terminar: si algo no cuadra, falla en vez de dejar un bundle
corrupto. Ver `frontend/public/datasets/README.md`.

---

## Licencia

**GPL-3.0-or-later** (obligatoria: mixOmics es GPL ≥ 2 y Pythomics es obra
derivada).

> Pendiente: el archivo `LICENSE` de la raíz sigue diciendo MIT. Hay que
> migrarlo y agregar las cabeceras GPL en los archivos.
