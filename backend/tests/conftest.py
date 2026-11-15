"""Fixtures compartidas de las pruebas del backend.

Las pruebas nunca tocan el directorio de datos real: ``app.state.DATA_DIR``
y el registro de recetas se reemplazan por directorios temporales, y el
token compartido se fija a un valor conocido para poder llamar a la API.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import TOKEN_HEADER
from app.datasets import DatasetStore
from app.jobs import JobManager

#: Token compartido usado por las pruebas.
TOKEN_DE_PRUEBA = "token-de-prueba"

#: Subdirectorio donde viven las recetas dentro del directorio de datos.
DATASETS_SUBDIR = "datasets"


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Directorio de datos temporal, en el lugar del de la app.

    También fija el token compartido y deja el registro de recetas apuntando
    a un directorio temporal, así que ninguna prueba lee ni escribe en
    ``backend/data/``.

    El estado de la app se restaura a mano: ``monkeypatch.setattr`` no sirve
    con el ``State`` de Starlette, que guarda los valores fuera del
    ``__dict__`` del objeto, y al deshacer el cambio terminaba borrando el
    atributo en vez de restaurarlo.
    """
    monkeypatch.setenv("PYTHOMICS_API_TOKEN", TOKEN_DE_PRUEBA)

    data_dir_anterior = app.state.DATA_DIR
    store_anterior = app.state.DATASET_STORE
    manager_anterior = getattr(app.state, "JOB_MANAGER", None)
    app.state.DATA_DIR = tmp_path
    app.state.DATASET_STORE = DatasetStore(tmp_path / DATASETS_SUBDIR)
    app.state.JOB_MANAGER = JobManager(tmp_path / "jobs")

    try:
        yield tmp_path
    finally:
        app.state.JOB_MANAGER.shutdown()
        app.state.DATA_DIR = data_dir_anterior
        app.state.DATASET_STORE = store_anterior
        if manager_anterior is not None:
            app.state.JOB_MANAGER = manager_anterior


@pytest.fixture
def client(data_dir: Path) -> Any:
    """Cliente HTTP con el token compartido ya puesto."""
    return TestClient(app, headers={TOKEN_HEADER: TOKEN_DE_PRUEBA})


@pytest.fixture
def write_block(data_dir: Path) -> Callable[[str, str], Path]:
    """Escribe un bloque tabular en el directorio de datos."""

    def _write(name: str, content: str) -> Path:
        path = data_dir / name
        path.write_text(content, encoding="utf-8")
        return path

    return _write
