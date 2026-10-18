# Pythomics

Pythomics es un port a Python de la librería `mixOmics` (R/Bioconductor) para integración multi-ómica, junto con una aplicación de escritorio en Electron que permite a biólogos sin experiencia en programación ejecutar pipelines completos (carga → preprocesamiento → PCA / sPLS-DA / DIABLO → gráficos → reporte PDF) en local, sin subir matrices crudas a la nube. El cálculo estadístico se ejecuta 100% en el equipo del usuario. En versiones futuras, con consentimiento explícito, se podrán consultar APIs biológicas públicas (UniProt, MyGene) y servicios de LLM para anotar biomarcadores y asistir el análisis preliminar, enviando solo identificadores genéricos y métricas agregadas. La librería se publica con tolerancia numérica 1e-6 frente a R y licencia GPL-3.0-or-later.

## Estructura de carpetas

```
mixomics-python/
├── mixOmics-app/                    ← esta carpeta (app de escritorio)
│   ├── backend/                      ← FastAPI en :8501
│   │   ├── app/api.py                ← endpoints
│   │   ├── main.py                   ← entrypoint uvicorn
│   │   ├── requirements.txt          ← incluye -e ../../omics
│   │   └── .venv/                    ← venv del backend (no commiteado)
│   ├── frontend/                     ← Electron + Vite + React + TS
│   │   ├── electron/                 ← main, preload, backend manager
│   │   ├── src/                      ← React (pages, components, lib)
│   │   └── README.md                 ← setup y smoke test del frontend
│   └── LICENSE                       ← (pendiente: migrar a GPL-3.0)
└── omics/                           ← librería pythomics (un nivel arriba)
    ├── pythomics/                    ← paquete Python
    │   ├── tools/                    ← NipalsPCA, perf
    │   ├── models/                   ← DIABLO wrapper, rcc
    │   ├── visualizations/, ai/, reports/
    └── pyproject.toml                ← hatchling, deps opcionales [r], [llm], [viz]…
```

## Setup

El setup es **una sola vez por máquina**. Requiere Node 20+ y Python 3.13+.

```bash
# 1. Backend: crear venv e instalar deps (incluye editable install de pythomics)
cd mixOmics-app/backend
python -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# 2. Frontend: instalar deps de Node
cd ../frontend
npm install
```

> **Nota sobre `omics/`:** está un nivel arriba de la app (`mixomics-python/omics/`). El path `../../omics` en `backend/requirements.txt` apunta ahí. Si se mueve la app
a otra ubicación, es necesario actualizar el path.

## Ejecución

**Caso normal: una sola terminal.** El frontend levanta Vite + Electron, y Electron levanta el backend Python en background.

```bash
cd mixOmics-app/frontend
npm run dev
# → Vite arranca en :5173
# → Electron espera a Vite, spawnea `python main.py` desde backend/
# → Polling a http://127.0.0.1:8501/v1/health (timeout 30s)
# → Ventana abre, badge pasa a "Backend en línea" cuando está listo
```

**Opcional: backend aislado** (por si se quiere hacer debug/tests aislados):

```bash
cd mixOmics-app/backend
.venv/bin/python main.py
# → Swagger en http://127.0.0.1:8501/docs
```
