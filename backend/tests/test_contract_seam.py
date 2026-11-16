"""Pruebas de la costura entre el renderer y el backend real (T11a).

Los E2E del frontend corren contra el **mock** de ``playwright.config.ts`` y
el smoke corre contra el **backend real** pero no pasa por las pantallas.
Ninguno de los dos mira al otro: si el contrato cambia de forma (un nombre de
campo, el cuerpo de una peticion, una respuesta), el mock y el backend real
divergen y los E2E siguen en verde mintiendo.

Esta suite cierra ese hueco. El contrato vive en **un solo archivo**,
``backend/tests/contract.json``, y los dos lados lo leen:

- este test reproduce los cuerpos canonicos contra la **API real** y exige
  que el backend los acepte y que las respuestas traigan los campos que el
  renderer lee;
- el test del frontend (``frontend/tests/e2e/frontend.spec.ts``) exige que el
  renderer mande exactamente esos cuerpos y que el mock responda con esos
  campos.

Si el mock y el backend se separan, el contrato deja de ser el punto de
encuentro y los dos tests fallan.

El escenario es el dataset de ejemplo del catalogo (``nutrimouse``): los
mismos CSV que la app trae pre-empaquetados en ``frontend/public/datasets/``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

import pytest

#: Contrato compartido con el frontend.
RUTA_CONTRATO = Path(__file__).with_name("contract.json")

#: Datasets de ejemplo que la app trae pre-empaquetados.
DIR_DATASETS = (
    Path(__file__).resolve().parents[2] / "frontend" / "public" / "datasets"
)

#: Firma binaria de un archivo PNG.
FIRMA_PNG = b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# El contrato compartido
# ---------------------------------------------------------------------------


def cargar_contrato() -> dict[str, Any]:
    """Lee el contrato compartido con el frontend."""
    return json.loads(RUTA_CONTRATO.read_text(encoding="utf-8"))


def peticion(contrato: dict[str, Any], nombre: str) -> dict[str, Any]:
    """Devuelve la peticion canonica con ese nombre."""
    for candidata in contrato["requests"]:
        if candidata["name"] == nombre:
            return candidata
    raise AssertionError(f"El contrato no define la peticion '{nombre}'.")


def _sustituir(valor: Any, valores: dict[str, Any]) -> Any:
    """Reemplaza los placeholders del contrato por valores concretos.

    Un placeholder es un string que empieza con ``$`` (por ejemplo
    ``$dataset_id``): se reemplaza entero, no por partes.
    """
    if isinstance(valor, str):
        return valores.get(valor, valor)
    if isinstance(valor, dict):
        return {clave: _sustituir(item, valores) for clave, item in valor.items()}
    if isinstance(valor, list):
        return [_sustituir(item, valores) for item in valor]
    return valor


# ---------------------------------------------------------------------------
# Verificador de los campos de la respuesta
# ---------------------------------------------------------------------------


def _cumple_tipo(valor: Any, kind: str) -> bool:
    """¿El valor tiene el tipo que declara el contrato?"""
    if kind == "string":
        return isinstance(valor, str)
    if kind == "integer":
        return isinstance(valor, int) and not isinstance(valor, bool)
    if kind == "number":
        return isinstance(valor, (int, float)) and not isinstance(valor, bool)
    if kind == "boolean":
        return isinstance(valor, bool)
    if kind == "array":
        return isinstance(valor, list)
    if kind == "object":
        return isinstance(valor, dict)
    if kind == "enum":
        return isinstance(valor, str)
    raise AssertionError(f"Tipo desconocido en el contrato: {kind!r}")


def _resolver(camino: str, cuerpo: Any) -> tuple[bool, list[Any]]:
    """Resuelve una ruta de campo del contrato sobre un cuerpo JSON.

    La sintaxis son segmentos separados por punto; un segmento terminado en
    ``[]`` significa "cada elemento de la lista". Devuelve si la ruta existe
    y los valores que encontró (una lista vacía significa que la ruta existe
    pero no hay elementos: por ejemplo, una lista sin biomarcadores).
    """
    actuales: list[Any] = [cuerpo]

    for segmento in camino.split("."):
        es_lista = segmento.endswith("[]")
        clave = segmento[:-2] if es_lista else segmento
        siguientes: list[Any] = []

        for actual in actuales:
            if not isinstance(actual, dict) or clave not in actual:
                return False, []
            hijo = actual[clave]
            if es_lista:
                if not isinstance(hijo, list):
                    return False, []
                siguientes.extend(hijo)
            else:
                siguientes.append(hijo)

        actuales = siguientes

    return True, actuales


def errores_de_campos(campos: list[dict[str, Any]], cuerpo: Any) -> list[str]:
    """Devuelve los errores que tiene el cuerpo frente al contrato.

    Cada error dice qué campo falla y por qué: un campo que no existe, un
    tipo que no coincide, un valor fuera de la lista permitida o un nombre
    que no cumple el patron.
    """
    errores: list[str] = []

    for campo in campos:
        camino = campo["path"]
        existe, valores = _resolver(camino, cuerpo)

        if not existe:
            errores.append(f"falta el campo '{camino}'")
            continue

        for valor in valores:
            if valor is None:
                if campo.get("nullable"):
                    continue
                errores.append(f"el campo '{camino}' es null")
                continue

            if not _cumple_tipo(valor, campo["kind"]):
                errores.append(
                    f"el campo '{camino}' es {type(valor).__name__} "
                    f"y el contrato pide {campo['kind']}"
                )
                continue

            if campo["kind"] == "enum" and valor not in campo["values"]:
                errores.append(
                    f"el campo '{camino}' vale {valor!r} y no esta en "
                    f"{campo['values']}"
                )

            patron = campo.get("pattern")
            if patron is not None and not re.search(patron, valor):
                errores.append(
                    f"el campo '{camino}' vale {valor!r} y no cumple {patron!r}"
                )

            patron_clave = campo.get("key_pattern")
            if patron_clave is not None:
                for clave in valor:
                    if not re.search(patron_clave, clave):
                        errores.append(
                            f"la clave '{clave}' de '{camino}' no cumple "
                            f"{patron_clave!r}"
                        )

    return errores


def exigir_campos(
    contrato: dict[str, Any], nombre: str, cuerpo: Any
) -> None:
    """Falla si el cuerpo no cumple el contrato de esa respuesta."""
    campos = contrato["responses"][nombre]["fields"]
    errores = errores_de_campos(campos, cuerpo)
    assert not errores, (
        f"La respuesta '{nombre}' no cumple el contrato compartido:\n"
        + "\n".join(f"  - {error}" for error in errores)
    )


# ---------------------------------------------------------------------------
# El escenario
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def entorno_con_r() -> None:
    """Omite las pruebas si la maquina no tiene R con ``mixOmics``.

    El DIABLO no tiene implementacion en Python: sin R el job falla con un
    error de entorno, no con un error del codigo.
    """
    from app.capabilities import probe_capabilities

    capabilities = probe_capabilities()
    if not capabilities.r or not capabilities.mixomics:
        pytest.skip(
            "El entorno no tiene R con el paquete mixOmics: "
            "las pruebas de DIABLO no se pueden ejecutar."
        )


def subir_ejemplos(client: Any, contrato: dict[str, Any]) -> None:
    """Sube los CSV de ejemplo como los sube el renderer.

    El renderer los manda por multipart al endpoint de ingesta; aca se hace
    lo mismo, con los archivos reales del repo.
    """
    for nombre in contrato["escenario"]["archivos"]:
        contenido = (DIR_DATASETS / nombre).read_bytes()
        respuesta = client.post(
            "/v1/archivos/",
            files={"file": (nombre, contenido, "text/csv")},
        )
        assert respuesta.status_code == 201, respuesta.text
        exigir_campos(contrato, "upload", respuesta.json())


def _crear_receta(
    client: Any, contrato: dict[str, Any], valores: dict[str, Any]
) -> str:
    """Crea la receta con el cuerpo canonico y devuelve su identificador."""
    canonica = peticion(contrato, "createDataset")
    cuerpo = _sustituir(canonica["body"], valores)
    respuesta = client.post(canonica["path"], json=cuerpo)
    assert respuesta.status_code == canonica["status"], respuesta.text
    exigir_campos(contrato, "dataset", respuesta.json())
    return str(respuesta.json()["id"])


def _alinear(
    client: Any,
    contrato: dict[str, Any],
    dataset_id: str,
    valores: dict[str, Any],
    nombre: str,
) -> dict[str, Any]:
    """Alinea con el cuerpo canonico indicado."""
    canonica = peticion(contrato, nombre)
    cuerpo = _sustituir(canonica["body"], valores)
    respuesta = client.post(
        canonica["path"].replace("{dataset_id}", dataset_id), json=cuerpo
    )
    assert respuesta.status_code == canonica["status"], respuesta.text
    exigir_campos(contrato, "alignment", respuesta.json())
    return respuesta.json()


def _fijar_target(
    client: Any, contrato: dict[str, Any], dataset_id: str
) -> None:
    """Fija la variable de clase con el cuerpo canonico."""
    canonica = peticion(contrato, "setDatasetTarget")
    respuesta = client.post(
        canonica["path"].replace("{dataset_id}", dataset_id),
        json=canonica["body"],
    )
    assert respuesta.status_code == canonica["status"], respuesta.text
    exigir_campos(contrato, "dataset", respuesta.json())


def _encolar_modelo(
    client: Any,
    contrato: dict[str, Any],
    dataset_id: str,
    nombre: str,
    valores: dict[str, Any],
) -> str:
    """Encola el modelo con el cuerpo canonico y devuelve el ``job_id``."""
    canonica = peticion(contrato, nombre)
    cuerpo = _sustituir(canonica["body"], {**valores, "$dataset_id": dataset_id})
    respuesta = client.post(canonica["path"], json=cuerpo)
    assert respuesta.status_code == canonica["status"], respuesta.text
    exigir_campos(contrato, "jobAccepted", respuesta.json())
    return str(respuesta.json()["job_id"])


# ---------------------------------------------------------------------------
# Las pruebas
# ---------------------------------------------------------------------------


def test_el_backend_acepta_los_cuerpos_canonicos_del_renderer(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """Los cuerpos que manda el renderer son aceptados por la API real.

    Es el recorrido completo del pipeline: ingesta, receta, alineacion,
    variable de clase y modelo. Cada respuesta se compara con el contrato
    compartido, que es el mismo que leen los tests del frontend.
    """
    contrato = cargar_contrato()
    valores = {"$seed": 42}

    subir_ejemplos(client, contrato)
    dataset_id = _crear_receta(client, contrato, valores)

    # La alineacion se calcula sola y despues la confirma el usuario.
    alineacion = _alinear(
        client, contrato, dataset_id, valores, "alignDataset"
    )
    assert alineacion["confirmed"] is False
    assert len(alineacion["sample_ids"]) == 40

    confirmada = _alinear(
        client, contrato, dataset_id, valores, "confirmAlignment"
    )
    assert confirmada["confirmed"] is True

    # La variable de clase queda en la receta.
    _fijar_target(client, contrato, dataset_id)

    # Y el modelo se encola con el cuerpo canonico.
    job_id = _encolar_modelo(
        client, contrato, dataset_id, "runModelPca", valores
    )

    job = esperar_job(job_id, timeout_s=180.0)
    assert job["status"] == "completed", job
    exigir_campos(contrato, "job", job)

    # El resultado trae la varianza explicada del PCA y la trazabilidad.
    resultado = job["result"]
    assert resultado["model_type"] == "PCA"
    assert resultado["n_components"] == 2
    assert resultado["explained_variance_ratio"]
    assert resultado["provenance"]["seed"] == 42
    assert {archivo["name"] for archivo in resultado["provenance"]["data_files"]} == {
        "nutrimouse_gene.csv",
        "nutrimouse_lipid.csv",
        "nutrimouse_meta.csv",
    }


def test_las_figuras_del_job_se_sirven_por_http(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
) -> None:
    """La figura que el renderer pide existe y es un PNG.

    El renderer la pide por el canal ``api:file`` con el nombre **sin**
    extension: es el contrato que declara el archivo compartido.
    """
    contrato = cargar_contrato()
    valores = {"$seed": 42}

    subir_ejemplos(client, contrato)
    dataset_id = _crear_receta(client, contrato, valores)
    _alinear(client, contrato, dataset_id, valores, "alignDataset")
    _alinear(client, contrato, dataset_id, valores, "confirmAlignment")
    _fijar_target(client, contrato, dataset_id)
    job_id = _encolar_modelo(
        client, contrato, dataset_id, "runModelPca", valores
    )

    job = esperar_job(job_id, timeout_s=180.0)
    assert job["status"] == "completed", job

    figuras = job["result"]["figures"]
    assert figuras, "El PCA no produjo ninguna figura."

    for figura in figuras:
        # El nombre va sin extension: la URL es ``{name}.png``.
        assert "." not in figura["name"]
        respuesta = client.get(
            f"/v1/files/{job_id}/{figura['name']}.png"
        )
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.headers["content-type"] == "image/png"
        assert respuesta.content.startswith(FIRMA_PNG)


def test_el_diablo_acepta_el_cuerpo_canonico(
    client: Any,
    esperar_job: Callable[..., dict[str, Any]],
    entorno_con_r: None,
) -> None:
    """El cuerpo canonico del DIABLO tambien lo acepta la API real.

    El DIABLO es el modelo que produce las correlaciones entre bloques y
    los biomarcadores: aca se comprueba que la clave de las correlaciones es
    la que el renderer lee (``"bloqueA|bloqueB"``) y que los biomarcadores
    llegan como lista plana.
    """
    contrato = cargar_contrato()
    valores = {"$seed": 42}

    subir_ejemplos(client, contrato)
    dataset_id = _crear_receta(client, contrato, valores)
    _alinear(client, contrato, dataset_id, valores, "alignDataset")
    _alinear(client, contrato, dataset_id, valores, "confirmAlignment")
    _fijar_target(client, contrato, dataset_id)
    job_id = _encolar_modelo(
        client, contrato, dataset_id, "runModelDiablo", valores
    )

    job = esperar_job(job_id, timeout_s=600.0)
    assert job["status"] == "completed", job
    exigir_campos(contrato, "job", job)

    resultado = job["result"]
    assert resultado["model_type"] == "DIABLO"

    # Las correlaciones van indexadas por el par de bloques.
    assert resultado["correlations"], "El DIABLO no produjo correlaciones."
    for clave in resultado["correlations"]:
        assert clave.count("|") == 1, clave

    # Y los biomarcadores llegan como lista plana, con su bloque.
    assert resultado["biomarkers"], "El DIABLO no produjo biomarcadores."
    for biomarcador in resultado["biomarkers"]:
        assert biomarcador["block"] in {
            "nutrimouse_gene.csv",
            "nutrimouse_lipid.csv",
        }
        assert isinstance(biomarcador["loading"], float)


def test_un_cuerpo_divergente_lo_rechaza_el_backend(client: Any) -> None:
    """Si el contrato se separa del backend, el backend lo rechaza.

    Es la contraprueba del test de costura: con el nombre del campo cambiado
    (``blocks`` -> ``bloques``) la API responde 422. Por eso la suite puede
    afirmar que el contrato compartido describes el backend de verdad y no
    una forma inventada.
    """
    contrato = cargar_contrato()
    valores = {"$seed": 42}

    subir_ejemplos(client, contrato)
    _crear_receta(client, contrato, valores)

    divergente = {"bloques": peticion(contrato, "createDataset")["body"]["blocks"]}
    respuesta = client.post("/v1/datasets/", json=divergente)
    assert respuesta.status_code == 422, respuesta.text
