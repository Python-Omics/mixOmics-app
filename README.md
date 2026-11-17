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
| **Cobertura (backend)** | `cd backend && .venv/bin/python -m pytest tests/ --cov=app --cov-report=term-missing` | Mide el código de `app/`; el umbral (`fail_under`) vive en `backend/pyproject.toml` y lo aplica el CI |
| **Frontend (E2E)** | `cd frontend && npx playwright test --project=chromium` | La UI contra el **mock** del preload: pipeline completo, i18n, accesibilidad, CSP, anti-FOUC y **la costura con el backend real** |
| **Smoke** | `cd frontend && npm run smoke` | La app real (Electron): que el renderer monte, la CSP, el canal de figuras, la rotación del log y el origen `app://` |



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

## Estructura de carpetas

```
mixOmics-app/                    ← raíz del repo
├── README.md                    ← este archivo
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


## Licencia

**GPL-3.0-or-later** (obligatoria: mixOmics es GPL ≥ 2 y Pythomics es obra
derivada).

> Pendiente: el archivo `LICENSE` de la raíz sigue diciendo MIT. Hay que
> migrarlo y agregar las cabeceras GPL en los archivos.
