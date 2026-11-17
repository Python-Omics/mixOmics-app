"""Pruebas directas del protocolo interno del worker (T7)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from app.schemas import ModelResult, Provenance


class _ModeloFalso:
    """Modelo mínimo con la forma que usan las figuras del DIABLO."""

    def __init__(
        self,
        loadings: dict[str, Any],
        names: dict[str, list[str]],
        x_dict: dict[str, Any] | None = None,
        y: Any = None,
    ) -> None:
        self.loadings_ = loadings
        self.names_ = names
        self.X_dict_ = x_dict if x_dict is not None else {}
        self.Y_ = y if y is not None else np.array(["wt", "ppar"])


def test_el_worker_registra_las_etapas_en_orden(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El progreso pasa por las seis etapas, después de ``queued``."""
    from app import worker

    etapas: list[str] = []
    escritura_original = worker.write_json_atomic

    def registrar(path: Path, payload: Any) -> None:
        if isinstance(payload, dict) and "stage" in payload:
            etapas.append(payload["stage"])
        escritura_original(path, payload)

    monkeypatch.setattr(worker, "write_json_atomic", registrar)
    monkeypatch.setattr(worker, "_load_blocks", lambda blocks: [])
    monkeypatch.setattr(worker, "_align_blocks", lambda loaded, ids: [])
    monkeypatch.setattr(worker, "_fit_pca", lambda blocks, n_components: [])

    resultado = ModelResult(
        model_type="PCA",
        blocks=[],
        n_components=1,
        provenance=Provenance(
            pythomics_version="prueba",
            seed=1,
            params={},
            preprocessing=[],
            created_at="2025-01-01T00:00:00+00:00",
        ),
    )
    monkeypatch.setattr(
        worker,
        "_build_result",
        lambda fitted, *, n_components, seed, bloques=None, target=None: resultado,
    )

    spec = worker.JobSpec.model_validate(
        {
            "job_id": "job_0123456789ab",
            "dataset_id": "ds_0123456789ab",
            "blocks": [
                {
                    "name": "gene.csv",
                    "role": "block",
                    "path": str(tmp_path / "gene.csv"),
                    "n_samples": 1,
                    "n_variables": 1,
                    "n_numeric_variables": 1,
                    "categorical_columns": [],
                    "sample_ids": ["S1"],
                }
            ],
            "alignment": {
                "sample_ids": ["S1"],
                "discarded": {},
                "confirmed": True,
            },
            "target": None,
            "model": {
                "model_type": "PCA",
                "n_components": 1,
                "keepX": None,
                "design": None,
                "seed": 1,
            },
            "paths": {
                "spec": str(tmp_path / "spec.json"),
                "progress": str(tmp_path / "progress.json"),
                "result": str(tmp_path / "result.json"),
                "error": str(tmp_path / "error.json"),
                "log": str(tmp_path / "worker.log"),
            },
        }
    )

    worker.run_job(spec)

    assert etapas == [
        "queued",
        "load",
        "align",
        "preprocess",
        "fit",
        "transform",
        "figures",
    ]


def test_el_modelo_recortado_deja_las_variables_mas_importantes() -> None:
    """El recorte deja las variables con mayor |loading| de cada bloque."""
    from app import worker

    # Veinticinco variables: solo las tres con mayor |loading| deben
    # quedar, y el recorte se corta en el tope de variables por bloque.
    loadings = np.zeros((25, 2))
    loadings[0, 0] = 0.9
    loadings[1, 1] = -0.8
    loadings[2, 0] = 0.7
    loadings[3:, :] = 0.01

    marco = pd.DataFrame(
        np.zeros((2, 25)),
        columns=[f"g{indice}" for indice in range(25)],
    )
    modelo = _ModeloFalso(
        {"gene.csv": loadings},
        {"gene.csv": [f"g{indice}" for indice in range(25)]},
        {"gene.csv": marco},
    )

    recortado = worker._modelo_recortado(modelo, 3, 2)

    assert recortado is not None
    # Las tres variables importantes no se pierden en el recorte, y el
    # recorte no se queda con más de las pedidas.
    assert recortado.names_["gene.csv"] == ["g0", "g2", "g1"]
    assert recortado.loadings_["gene.csv"].shape == (3, 2)
    # La biblioteca solo usa las columnas que están en el recorte.
    assert list(recortado.X_dict_["gene.csv"].columns) == ["g0", "g2", "g1"]
    # Los biomarcadores que expone son los del recorte.
    marcadores = recortado.get_biomarkers("gene.csv", comp=1)
    assert set(marcadores.index) == {"g0", "g2"}


def test_el_modelo_recortado_antepone_el_bloque_a_las_variables_repetidas() -> None:
    """Dos bloques con la misma variable no se pisan: se antepone el bloque."""
    from app import worker

    loadings = {"gene.csv": np.array([[0.9], [0.4]]), "lipid.csv": np.array([[0.8]])}
    nombres = {"gene.csv": ["TP53", "GAPDH"], "lipid.csv": ["TP53"]}
    marcos = {
        "gene.csv": pd.DataFrame([[1.0, 2.0]], columns=["TP53", "GAPDH"]),
        "lipid.csv": pd.DataFrame([[3.0]], columns=["TP53"]),
    }
    modelo = _ModeloFalso(loadings, nombres, marcos)

    recortado = worker._modelo_recortado(modelo, 5, 1)

    assert recortado is not None
    # La variable repetida se antepone con el nombre de su bloque en los
    # dos bloques: el nombre queda inequívoco.
    assert recortado.names_["gene.csv"] == ["gene.csv::TP53", "GAPDH"]
    assert recortado.names_["lipid.csv"] == ["lipid.csv::TP53"]
    # Los dataframes quedan con los mismos nombres que los loadings: la
    # biblioteca busca las columnas por nombre.
    assert list(recortado.X_dict_["lipid.csv"].columns) == ["lipid.csv::TP53"]


def test_el_modelo_recortado_usa_nombres_posicionales_si_faltan_nombres() -> None:
    """Si R y Python discrepan en la cantidad de nombres, la figura sale igual."""
    from app import worker

    modelo = _ModeloFalso(
        {"gene.csv": np.array([[0.5, 0.2], [0.1, 0.4]])},
        {"gene.csv": ["g0"]},
    )

    recortado = worker._modelo_recortado(modelo, 5, 2)

    assert recortado is not None
    assert len(recortado.names_["gene.csv"]) == 2
    assert all(nombre.startswith("var_") for nombre in recortado.names_["gene.csv"])


def test_un_modelo_sin_loadings_no_tiene_recorte() -> None:
    """Un modelo sin loadings no aporta nada que dibujar."""
    from app import worker

    modelo = _ModeloFalso({}, {})

    assert worker._modelo_recortado(modelo, 5, 2) is None


def test_una_figura_que_falla_no_tumba_el_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Si una figura falla, el job sigue y devuelve las demás.

    El análisis ya está hecho: perder una figura es preferible a perder el
    trabajo.
    """
    from app import worker
    from app.schemas import Figure

    ajustado = worker._FittedDiablo(
        model=_ModeloFalso({}, {}),
        blocks=["gene.csv"],
        variables={"gene.csv": ["g1"]},
        classes=["wt"],
        seed=42,
        n_components=2,
        design=[[0.0]],
        keepX=None,
    )

    def _figura_buena(kind: str):
        def _dibujar(fitted: Any, ruta: Path) -> Figure:
            return Figure(
                kind=kind,
                path=ruta.name,
                name=ruta.stem,
                mime="image/png",
            )

        return _dibujar

    def _figura_rota(fitted: Any, ruta: Path) -> Figure:
        raise RuntimeError("no hay memoria")

    monkeypatch.setattr(worker, "_figura_biomarkers", _figura_buena("biomarkers"))
    monkeypatch.setattr(worker, "_figura_heatmap", _figura_rota)
    monkeypatch.setattr(worker, "_figura_network", _figura_buena("network"))
    monkeypatch.setattr(worker, "_figura_circos", _figura_buena("circos"))

    figuras = worker._build_diablo_figures(ajustado, tmp_path)

    assert [figura.kind for figura in figuras] == [
        "biomarkers",
        "network",
        "circos",
    ]


def test_si_todas_las_figuras_fallan_el_job_no_tumba(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ni siquiera un fallo de todas las figuras puede tumbar el job."""
    from app import worker

    ajustado = worker._FittedDiablo(
        model=_ModeloFalso({}, {}),
        blocks=["gene.csv"],
        variables={"gene.csv": ["g1"]},
        classes=["wt"],
        seed=42,
        n_components=2,
        design=[[0.0]],
        keepX=None,
    )

    def _figura_rota(fitted: Any, ruta: Path) -> Any:
        raise RuntimeError("no hay memoria")

    for nombre in (
        "_figura_biomarkers",
        "_figura_heatmap",
        "_figura_network",
        "_figura_circos",
    ):
        monkeypatch.setattr(worker, nombre, _figura_rota)

    assert worker._build_diablo_figures(ajustado, tmp_path) == []
