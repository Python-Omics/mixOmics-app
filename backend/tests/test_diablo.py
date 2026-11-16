"""Pruebas del DIABLO: el modelo supervisado multi-bloque (T9, RF-8, S12).

El DIABLO llama a R a través de ``DIABLOWrapper``: el resultado **es** el de
mixOmics, porque el wrapper ejecuta ``block.splsda`` en R. La paridad no se
mide acá (L20).

Estas pruebas necesitan R con el paquete ``mixOmics``. Si el entorno no lo
ofrece, se **omiten** con un motivo claro: no es un fallo del backend, es una
máquina sin la dependencia.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pytest

from app.schemas import Capabilities

#: Firma binaria de un archivo PNG.
FIRMA_PNG = b"\x89PNG\r\n\x1a\n"

#: Bloque de variables de ejemplo: seis muestras, tres variables.
CONTENIDO_GENE = (
    "sample,g1,g2,g3\n"
    "S1,1.0,0.5,2.0\n"
    "S2,2.0,1.5,1.0\n"
    "S3,3.0,2.5,4.0\n"
    "S4,4.0,3.5,3.0\n"
    "S5,5.0,4.5,5.0\n"
    "S6,6.0,5.5,6.0\n"
)

#: Segundo bloque de variables: seis muestras, dos variables.
CONTENIDO_LIPID = (
    "sample,l1,l2\n"
    "S1,0.1,1.1\n"
    "S2,0.2,2.2\n"
    "S3,0.3,3.3\n"
    "S4,2.4,1.4\n"
    "S5,2.5,2.5\n"
    "S6,2.6,3.6\n"
)

#: Tabla de phenotypes: la variable de clase (S39).
CONTENIDO_META = (
    "sample,grupo\n"
    "S1,wt\n"
    "S2,wt\n"
    "S3,wt\n"
    "S4,ppar\n"
    "S5,ppar\n"
    "S6,ppar\n"
)

#: La misma tabla de phenotypes, pero con las filas en otro orden.
CONTENIDO_META_DESORDENADO = (
    "sample,grupo\n"
    "S3,wt\n"
    "S5,ppar\n"
    "S1,wt\n"
    "S6,ppar\n"
    "S2,wt\n"
    "S4,ppar\n"
)

#: Bloques de la receta de ejemplo, en el orden en que se alinean.
BLOQUES = [
    {"name": "gene.csv", "role": "block"},
    {"name": "lipid.csv", "role": "block"},
    {"name": "meta.csv", "role": "metadata"},
]

#: Variable de clase de la receta de ejemplo.
TARGET = {"block": "meta.csv", "column": "grupo"}


@pytest.fixture(scope="module")
def entorno_con_r() -> None:
    """Omite las pruebas si la máquina no tiene R con ``mixOmics``.

    El DIABLO no tiene implementación en Python: sin R el job falla con un
    error de entorno, no con un error del código.
    """
    from app.capabilities import probe_capabilities

    capabilities = probe_capabilities()
    if not capabilities.r or not capabilities.mixomics:
        pytest.skip(
            "El entorno no tiene R con el paquete mixOmics: "
            "las pruebas de DIABLO no se pueden ejecutar."
        )


def _correr_diablo(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
    dataset_id: str,
    **extra: Any,
) -> dict[str, Any]:
    """Encola un DIABLO y devuelve el job ya terminado."""
    cuerpo: dict[str, Any] = {
        "dataset_id": dataset_id,
        "model_type": "DIABLO",
        "n_components": 2,
    }
    cuerpo.update(extra)

    aceptado = client.post("/v1/model/", json=cuerpo)
    assert aceptado.status_code == 202, aceptado.text
    return esperar_job(aceptado.json()["job_id"], timeout_s=300.0)


def test_el_diablo_completa_y_devuelve_el_resultado_completo(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """El DIABLO termina y trae scores, loadings, biomarcadores y correlaciones."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    resultado = job["result"]
    assert resultado["model_type"] == "DIABLO"
    assert resultado["blocks"] == ["gene.csv", "lipid.csv"]
    assert resultado["n_components"] == 2

    # Scores (variates) por bloque: filas = muestras, columnas = componentes.
    assert set(resultado["scores"]) == {"gene.csv", "lipid.csv"}
    assert len(resultado["scores"]["gene.csv"]) == 6
    assert len(resultado["scores"]["gene.csv"][0]) == 2
    assert len(resultado["scores"]["lipid.csv"]) == 6

    # Loadings por bloque, con el nombre de la variable y su componente.
    assert set(resultado["loadings"]) == {"gene.csv", "lipid.csv"}
    variables = {
        loading["variable_id"] for loading in resultado["loadings"]["gene.csv"]
    }
    assert variables == {"g1", "g2", "g3"}
    assert {loading["component"] for loading in resultado["loadings"]["gene.csv"]} == {
        1,
        2,
    }

    # Biomarcadores por bloque: el modelo dice qué variables seleccionó.
    assert resultado["biomarkers"], resultado
    assert {biomarcador["block"] for biomarcador in resultado["biomarkers"]} == {
        "gene.csv",
        "lipid.csv",
    }
    assert all(
        biomarcador["component"] in (1, 2)
        for biomarcador in resultado["biomarkers"]
    )

    # Correlaciones entre bloques: una matriz por par de bloques.
    correlaciones = resultado["correlations"]
    assert "gene.csv|lipid.csv" in correlaciones, correlaciones
    matriz = correlaciones["gene.csv|lipid.csv"]
    assert len(matriz) == 2
    assert all(len(fila) == 2 for fila in matriz)


def test_el_loading_plot_y_el_circulo_se_generan_y_se_sirven(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """El DIABLO dibuja el loading plot y el círculo de correlaciones."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    figuras = {figura["kind"]: figura for figura in job["result"]["figures"]}
    assert set(figuras) == {"biomarkers", "circos"}, job["result"]["figures"]

    for figura in figuras.values():
        assert figura["name"] == figura["path"].removesuffix(".png")
        assert figura["mime"] == "image/png"

        respuesta = client.get(
            f"/v1/files/{job['job_id']}/{figura['name']}.png"
        )
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.headers["content-type"] == "image/png"
        assert respuesta.content.startswith(FIRMA_PNG)


def test_una_receta_sin_variable_de_clase_no_se_puede_ajustar(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    entorno_con_r: None,
) -> None:
    """El DIABLO es supervisado: sin variable de clase no se encola nada."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    dataset_id = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "lipid.csv", "role": "block"},
        ]
    )

    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "DIABLO",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 422, respuesta.text
    error = respuesta.json()["error"]
    assert error["code"] == "E_TARGET_COLUMN_MISSING"
    assert error["message_key"] == "errors.targetColumnMissing"
    assert error["detail"]["reason"] == "diablo_requires_target"


def test_el_worker_tambien_exige_la_variable_de_clase() -> None:
    """El worker no ajusta un DIABLO sin clase, aunque se le pida."""
    from app.errors import PythomicsError
    from app import worker

    with pytest.raises(PythomicsError) as error:
        worker._matrices_diablo([], None)

    assert error.value.code.value == "E_TARGET_COLUMN_MISSING"
    assert error.value.detail["reason"] == "diablo_requires_target"


def test_una_columna_de_clase_inexistente_hace_fallar_el_job(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """Si la columna de clase no existe en su bloque, el job falla con claridad."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(
        BLOQUES,
        target={"block": "meta.csv", "column": "clase-inexistente"},
    )

    job = _correr_diablo(client, esperar_job, dataset_id)

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_TARGET_COLUMN_MISSING"
    assert job["error"]["detail"]["column"] == "clase-inexistente"


def test_sin_r_la_api_responde_503_antes_de_encolar(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sin R, el DIABLO no se acepta: la API responde 503 (S26)."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    async def sin_r() -> Capabilities:
        return Capabilities(pythomics=True, r=False, mixomics=False)

    monkeypatch.setattr("app.api.probe_capabilities_async", sin_r)

    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "DIABLO",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 503, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_R_NOT_AVAILABLE"
    assert respuesta.json()["error"]["message_key"] == "errors.rNotAvailable"


def test_sin_mixomics_la_api_responde_503_antes_de_encolar(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Con R pero sin el paquete mixOmics, tampoco se acepta el DIABLO."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    async def sin_mixomics() -> Capabilities:
        return Capabilities(pythomics=True, r=True, mixomics=False)

    monkeypatch.setattr("app.api.probe_capabilities_async", sin_mixomics)

    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "DIABLO",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 503, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_MIXOMICS_NOT_AVAILABLE"


def test_si_r_falla_durante_el_job_el_error_es_claro_y_el_log_conserva_r(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    data_dir: Path,
    entorno_con_r: None,
) -> None:
    """Un fallo dentro de R deja el job en ``failed`` con un error claro.

    El caso de prueba es una variable de clase con una sola categoría: R
    rechaza el ajuste. Lo importante es que el job no se pierde en silencio
    y que la salida de R queda en el log del worker.
    """
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", "sample,grupo\nS1,wt\nS2,wt\nS3,wt\nS4,wt\nS5,wt\nS6,wt\n")
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(client, esperar_job, dataset_id)

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_ANALYSIS_FAILED"
    assert job["error"]["detail"]["reason"] == "diablo_failed"

    log = (data_dir / "jobs" / job["job_id"] / "worker.log").read_text(
        encoding="utf-8",
        errors="replace",
    )
    # La salida de R queda en el log: es el diagnóstico del fallo.
    assert "mixOmics" in log
    assert "E_ANALYSIS_FAILED" in log


def test_la_provenance_del_diablo_incluye_el_design_y_el_keepx(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """La provenance registra los parámetros efectivos del DIABLO."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(
        client,
        esperar_job,
        dataset_id,
        design=[[0.0, 1.0], [1.0, 0.0]],
        keepX={"gene.csv": [2, 2], "lipid.csv": [1, 1]},
    )

    assert job["status"] == "completed", job
    params = job["result"]["provenance"]["params"]
    assert params["model_type"] == "DIABLO"
    assert params["estimator"] == "DIABLOWrapper"
    assert params["center"] is True
    assert params["scale"] is False
    assert params["n_components"] == 2
    assert params["blocks"] == ["gene.csv", "lipid.csv"]
    assert params["target"] == {"block": "meta.csv", "column": "grupo"}
    assert params["design"] == [[0.0, 1.0], [1.0, 0.0]]
    assert params["keepX"] == {"gene.csv": [2, 2], "lipid.csv": [1, 1]}


def test_sin_design_la_provenance_registra_el_valor_predeterminado_de_mixomics(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """Sin diseño explícito, se registra el que usa mixOmics por defecto."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(client, esperar_job, dataset_id)

    assert job["status"] == "completed", job
    params = job["result"]["provenance"]["params"]
    assert params["design"] == [[0.0, 1.0], [1.0, 0.0]]
    assert params["keepX"] is None


def test_el_diablo_con_un_solo_componente_tambien_termina(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """Con un solo componente el DIABLO también completa y dibuja sus figuras."""
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta.csv", CONTENIDO_META)
    dataset_id = crear_dataset(BLOQUES, target=TARGET)

    job = _correr_diablo(client, esperar_job, dataset_id, n_components=1)

    assert job["status"] == "completed", job
    assert job["result"]["n_components"] == 1
    assert len(job["result"]["scores"]["gene.csv"][0]) == 1
    assert {figura["kind"] for figura in job["result"]["figures"]} == {
        "biomarkers",
        "circos",
    }


def test_la_clase_se_toma_por_el_id_de_muestra_y_no_por_la_posicion(
    client: Any,
    write_block: Callable[[str, str], Path],
    crear_dataset: Callable[..., str],
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """El orden del archivo de phenotypes no cambia el resultado (S39).

    Si la clase se tomara por posición, el segundo análisis tendría las clases
    permutadas y el modelo sería otro. Los dos archivos de phenotypes son
    distintos a propósito: la receta guarda la ruta, no los datos, así que
    dos recetas con el mismo nombre de archivo leerían el mismo archivo.
    """
    write_block("gene.csv", CONTENIDO_GENE)
    write_block("lipid.csv", CONTENIDO_LIPID)
    write_block("meta_ordenado.csv", CONTENIDO_META)
    write_block("meta_desordenado.csv", CONTENIDO_META_DESORDENADO)

    receta_ordenada = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "lipid.csv", "role": "block"},
            {"name": "meta_ordenado.csv", "role": "metadata"},
        ],
        target={"block": "meta_ordenado.csv", "column": "grupo"},
    )
    receta_desordenada = crear_dataset(
        [
            {"name": "gene.csv", "role": "block"},
            {"name": "lipid.csv", "role": "block"},
            {"name": "meta_desordenado.csv", "role": "metadata"},
        ],
        target={"block": "meta_desordenado.csv", "column": "grupo"},
    )

    job_ordenado = _correr_diablo(client, esperar_job, receta_ordenada)
    job_desordenado = _correr_diablo(client, esperar_job, receta_desordenada)

    assert job_ordenado["status"] == "completed", job_ordenado
    assert job_desordenado["status"] == "completed", job_desordenado

    scores_ordenados = job_ordenado["result"]["scores"]
    scores_desordenados = job_desordenado["result"]["scores"]

    assert scores_ordenados == scores_desordenados

    biomarcadores_ordenados = job_ordenado["result"]["biomarkers"]
    biomarcadores_desordenados = job_desordenado["result"]["biomarkers"]
    assert biomarcadores_ordenados == biomarcadores_desordenados
