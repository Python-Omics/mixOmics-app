"""Pruebas de las figuras del análisis (T8).

El sample plot se genera en el **worker** (el proceso hijo), nunca en la API:
el proceso de FastAPI no importa matplotlib ni ``pythomics.visualizations``.
Estas pruebas cubren la generación de la figura, su entrega por HTTP y el
aislamiento del proceso de la API.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from app.schemas import BlockRef, TargetSpec

#: Firma binaria de un archivo PNG.
FIRMA_PNG = b"\x89PNG\r\n\x1a\n"

#: Bloque de variables de ejemplo: tres muestras, dos variables numéricas.
CONTENIDO_GENE = "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\nS3,5.5,6.5\n"

#: Bloque de metadatos de ejemplo: la variable de clase.
CONTENIDO_META = "sample,grupo\nS1,A\nS2,B\nS3,A\n"


def _correr_pca(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
    dataset_id: str,
    *,
    n_components: int = 2,
) -> dict[str, Any]:
    """Encola un PCA de dos componentes y devuelve el job ya terminado."""
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


def test_el_job_produce_un_png_y_lo_lista_en_las_figuras(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
) -> None:
    """El job deja un PNG en su directorio y lo lista en ``result.figures``."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = esperar_job(aceptado.json()["job_id"])

    assert job["status"] == "completed", job
    figuras = job["result"]["figures"]
    assert len(figuras) == 1, figuras
    figura = figuras[0]
    assert figura["kind"] == "pca"
    assert figura["mime"] == "image/png"
    assert figura["name"] == "scores_gene"
    assert figura["path"] == "scores_gene.png"

    png = data_dir / "jobs" / job["job_id"] / "scores_gene.png"
    assert png.is_file()
    assert png.read_bytes().startswith(FIRMA_PNG)


def test_la_figura_se_sirve_por_http_como_imagen(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """El PNG del job se sirve por ``GET /v1/files/{job_id}/{name}.png``."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]
    job = esperar_job(job_id)
    assert job["status"] == "completed", job

    respuesta = client.get(f"/v1/files/{job_id}/scores_gene.png")

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.headers["content-type"] == "image/png"
    assert respuesta.content.startswith(FIRMA_PNG)


def test_el_proceso_de_la_api_no_importa_matplotlib_ni_visualizations() -> None:
    """S30: el proceso de FastAPI no carga ni la librería de figuras ni matplotlib.

    La comprobación corre en un proceso aparte, con la API recién importada:
    así el resultado no depende del orden en que se ejecuten las pruebas.
    """
    backend_dir = Path(__file__).resolve().parent.parent
    codigo = (
        "import sys; import app.api; "
        "print(','.join(sorted({'matplotlib', 'pythomics.visualizations'} "
        "& set(sys.modules))))"
    )

    terminada = subprocess.run(
        [sys.executable, "-c", codigo],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        check=False,
    )

    assert terminada.returncode == 0, terminada.stderr
    assert terminada.stdout.strip() == ""


def test_el_sample_plot_se_genera_sin_variable_de_clase(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
) -> None:
    """Un PCA no supervisado también produce su sample plot."""
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = esperar_job(aceptado.json()["job_id"])

    assert job["status"] == "completed", job
    assert len(job["result"]["figures"]) == 1, job["result"]["figures"]
    png = data_dir / "jobs" / job["job_id"] / "scores_gene.png"
    assert png.is_file()
    assert png.read_bytes().startswith(FIRMA_PNG)


def test_el_sample_plot_se_colorea_por_la_clase_cuando_hay_target(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
) -> None:
    """Con variable de clase, el sample plot sale coloreado por ella.

    La evidencia es la diferencia con el gráfico sin clase: el primero
    tiene la leyenda de las clases y el segundo no.
    """
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("meta.csv", CONTENIDO_META)

    con_clase = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "meta.csv", "role": "metadata"},
        ],
        target={"block": "meta.csv", "column": "grupo"},
    )
    sin_clase = crear_dataset([{"name": "gene.csv", "role": "block"}])

    job_con_clase = _correr_pca(client, esperar_job, con_clase)
    job_sin_clase = _correr_pca(client, esperar_job, sin_clase)

    assert job_con_clase["status"] == "completed", job_con_clase
    assert job_sin_clase["status"] == "completed", job_sin_clase
    assert len(job_con_clase["result"]["figures"]) == 1
    assert len(job_sin_clase["result"]["figures"]) == 1

    png_con_clase = (
        data_dir / "jobs" / job_con_clase["job_id"] / "scores_gene.png"
    ).read_bytes()
    png_sin_clase = (
        data_dir / "jobs" / job_sin_clase["job_id"] / "scores_gene.png"
    ).read_bytes()

    assert png_con_clase.startswith(FIRMA_PNG)
    assert png_sin_clase.startswith(FIRMA_PNG)
    assert png_con_clase != png_sin_clase


def test_el_metadata_de_la_figura_lleva_la_clase_y_los_ids_canonicos(
    tmp_path: Path,
) -> None:
    """El frame de metadatos tiene la clase y el índice canónico de muestras."""
    from app import worker

    ruta = tmp_path / "meta.csv"
    ruta.write_text(CONTENIDO_META, encoding="utf-8")
    bloque = worker._LoadedBlock(
        reference=BlockRef(
            name="meta.csv",
            role="metadata",
            path=str(ruta),
            n_samples=3,
            n_variables=1,
            n_numeric_variables=0,
            categorical_columns=["grupo"],
            sample_ids=["S1", "S2", "S3"],
        ),
        frame=pd.read_csv(ruta, dtype=str),
        id_column="sample",
        numeric_columns=[],
    )

    metadata, hue = worker._metadata_figura(
        [bloque],
        TargetSpec(block="meta.csv", column="grupo"),
        ["S1", "S2", "S3"],
    )

    assert hue == "grupo"
    assert list(metadata.columns) == ["grupo"]
    assert list(metadata.index) == ["S1", "S2", "S3"]
    assert metadata["grupo"].tolist() == ["A", "B", "A"]


def test_sin_variable_de_clase_el_metadata_tiene_una_fila_por_muestra() -> None:
    """Sin clase, el frame de metadatos está vacío pero tiene las filas."""
    from app import worker

    metadata, hue = worker._metadata_figura([], None, ["S1", "S2", "S3"])

    assert hue is None
    assert len(metadata) == 3
    assert list(metadata.index) == ["S1", "S2", "S3"]
    assert list(metadata.columns) == []


def test_con_un_solo_componente_el_job_termina_sin_figura(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
) -> None:
    """El sample plot es bidimensional: con un componente no se genera figura.

    El análisis no se pierde por eso: el job termina con su resultado y sin
    figuras.
    """
    write_block("gene.csv", CONTENIDO_GENE)
    dataset_id = crear_dataset([{"name": "gene.csv", "role": "block"}])

    job = _correr_pca(client, esperar_job, dataset_id, n_components=1)

    assert job["status"] == "completed", job
    assert job["result"]["figures"] == []
    assert job["result"]["n_components"] == 1
    assert not (data_dir / "jobs" / job["job_id"] / "scores_gene.png").exists()

