"""Pruebas directas del protocolo interno del worker (T7)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.schemas import ModelResult, Provenance


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
