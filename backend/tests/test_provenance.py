"""Pruebas de la trazabilidad del análisis: la ``Provenance`` (T8, S16).

La provenance es lo que hace auditable un resultado: qué versión de la
librería corrió, con qué semilla, con qué parámetros efectivos y **qué
archivos exactos** entraron al cálculo (RB-7).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

from app.schemas import ModelResult

#: Bloque de variables de ejemplo: tres muestras, dos variables numéricas.
CONTENIDO_GENE = "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\nS3,5.5,6.5\n"

#: Bloque de metadatos de ejemplo: la variable de clase.
CONTENIDO_META = "sample,grupo\nS1,A\nS2,B\nS3,A\n"

#: Tipos que un JSON puede representar.
TIPOS_JSON = (str, int, float, bool, type(None))


def _correr_pca(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
    dataset_id: str,
    *,
    n_components: int = 2,
) -> dict[str, Any]:
    """Encola un PCA y devuelve el job ya terminado."""
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": n_components,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    return esperar_job(aceptado.json()["job_id"])


def _es_json(valor: Any) -> bool:
    """Indica si un valor se puede representar en JSON."""
    if isinstance(valor, TIPOS_JSON):
        return True
    if isinstance(valor, list):
        return all(_es_json(item) for item in valor)
    if isinstance(valor, dict):
        return all(
            isinstance(clave, str) and _es_json(item)
            for clave, item in valor.items()
        )
    return False


def test_la_provenance_trae_los_parametros_efectivos_del_modelo(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """Quedan registrados los parámetros con los que se ajustó el modelo."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    job = _correr_pca(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    params = job["result"]["provenance"]["params"]
    assert params["model_type"] == "PCA"
    assert params["estimator"] == "NipalsPCA"
    assert params["center"] is True
    assert params["scale"] is False
    assert params["n_components"] == 2
    assert params["preprocessing"] == []
    assert params["blocks"] == ["gene.csv"]
    assert params["target"] is None


def test_la_provenance_trae_los_parametros_con_la_variable_de_clase(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """Con clase, la provenance dice de qué bloque y de qué columna salió."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "meta.csv", "role": "metadata"},
        ],
        target={"block": "meta.csv", "column": "grupo"},
    )

    job = _correr_pca(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    params = job["result"]["provenance"]["params"]
    assert params["target"] == {"block": "meta.csv", "column": "grupo"}


def test_la_provenance_trae_la_huella_de_los_datos(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """Cada archivo que entró al cálculo queda ligado a su hash y su tamaño."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "meta.csv", "role": "metadata"},
        ],
        target={"block": "meta.csv", "column": "grupo"},
    )

    job = _correr_pca(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    provenance = job["result"]["provenance"]
    huellas = provenance["data_files"]

    assert [huella["name"] for huella in huellas] == ["gene.csv", "meta.csv"]
    assert huellas[0]["role"] == "block"
    assert huellas[1]["role"] == "metadata"
    assert huellas[0]["sha256"] == hashlib.sha256(
        CONTENIDO_GENE.encode("utf-8")
    ).hexdigest()
    assert huellas[1]["sha256"] == hashlib.sha256(
        CONTENIDO_META.encode("utf-8")
    ).hexdigest()
    assert huellas[0]["size_bytes"] == len(CONTENIDO_GENE.encode("utf-8"))

    fingerprint = provenance["data_fingerprint"]
    assert isinstance(fingerprint, str)
    assert len(fingerprint) == 64
    assert all(caracter in "0123456789abcdef" for caracter in fingerprint)


def test_la_huella_cambia_cuando_cambia_el_archivo(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """El resultado queda ligado a los archivos exactos: si el archivo cambia,
    la huella cambia (aunque la forma del bloque siga siendo la misma)."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    primero = _correr_pca(client, esperar_job, dataset_id)
    assert primero["status"] == "completed", primero

    write_block(
        "gene.csv",
        "sample,g1,g2\nS1,9.5,2.5\nS2,3.5,4.5\nS3,5.5,6.5\n",
    )
    segundo = _correr_pca(client, esperar_job, dataset_id)
    assert segundo["status"] == "completed", segundo

    huella_primera = primero["result"]["provenance"]["data_fingerprint"]
    huella_segunda = segundo["result"]["provenance"]["data_fingerprint"]
    assert huella_primera != huella_segunda


def test_la_provenance_no_trae_objetos_no_serializables(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
) -> None:
    """H4: todo lo que viaja en la provenance es JSON (S24)."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    job = _correr_pca(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    provenance = job["result"]["provenance"]
    assert _es_json(provenance["params"])
    assert _es_json(provenance["data_files"])
    assert _es_json(provenance["data_fingerprint"])

    resultado = data_dir / "jobs" / job["job_id"] / "result.json"
    payload = json.loads(resultado.read_text(encoding="utf-8"))
    validado = ModelResult.model_validate(payload)
    assert validado.provenance.params["center"] is True
