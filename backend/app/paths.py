"""Resolución de rutas del backend.

La ruta de datos **no puede depender del entrypoint**. Si se define en
``main.py``, entonces ``uvicorn app.api:app`` — que no pasa por ``main.py`` —
arranca sin ``app.state.DATA_DIR`` y cualquier endpoint que la use revienta con
500. Por eso vive acá, en un módulo de la app, y se resuelve al importar.

Precedencia:

1. ``PYTHOMICS_DATA_DIR`` — la setea el proceso Electron. En producción apunta a
   ``app.getPath('userData')/data``, que siempre es escribible; el directorio
   junto al ejecutable puede no serlo (PyInstaller, ``/Applications``, etc.).
2. Carpeta de datos de un bundle congelado (PyInstaller), como mejor
   esfuerzo.
3. ``backend/data`` — desarrollo.

En todos los casos el directorio se crea si no existe.
"""

import os
import sys
import tempfile
from pathlib import Path

#: Variable de entorno que el proceso Electron setea para apuntar al
#: directorio de datos.
DATA_DIR_ENV = "PYTHOMICS_DATA_DIR"

#: Nombre del subdirectorio de datos dentro del perfil del usuario.
DATA_SUBDIR = "data"

#: Nombre del subdirectorio de recetas dentro del directorio de datos.
DATASETS_SUBDIR = "datasets"


def _is_frozen() -> bool:
    """True si el proceso corre desde un bundle de PyInstaller."""
    return bool(getattr(sys, "frozen", False))


def resolve_data_dir() -> Path:
    """Devuelve el directorio donde se guardan archivos y resultados.

    El directorio se crea si no existe. Si no se puede crear (permisos), se
    cae a un temporal: la app tiene que poder arrancar aunque el disco esté
    en modo lectura.
    """
    env = os.environ.get(DATA_DIR_ENV)
    if env:
        candidate = Path(env).expanduser()
    elif _is_frozen():
        candidate = Path(sys.executable).resolve().parent / DATA_SUBDIR
    else:
        # backend/app/paths.py -> backend/data
        candidate = Path(__file__).resolve().parent.parent / DATA_SUBDIR

    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except OSError:
        fallback = Path(tempfile.mkdtemp(prefix="pythomics-data-"))
        return fallback


def resolve_jobs_dir(data_dir: Path | None = None) -> Path:
    """Directorio donde viven los jobs (spec, progreso, resultado, figuras).

    Vive dentro del directorio de datos, así que en producción también está
    en el perfil del usuario. ``data_dir`` permite que las pruebas usen un
    directorio temporal sin cambiar la variable de entorno del proceso.
    """
    base = Path(data_dir) if data_dir is not None else resolve_data_dir()
    jobs = base / "jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    return jobs


def resolve_datasets_dir() -> Path:
    """Directorio donde viven las recetas de datos.

    Es hijo del directorio de datos: en producción también queda dentro del
    perfil del usuario, y las recetas nunca se mezclan con los archivos que
    sube el usuario.
    """
    datasets = resolve_data_dir() / DATASETS_SUBDIR
    datasets.mkdir(parents=True, exist_ok=True)
    return datasets
