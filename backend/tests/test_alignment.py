"""Pruebas de la alineación multi-bloque (T5): se alinea por ID, no por posición.

La alineación es una **decisión auditable** (RF-2, RB-3): el backend calcula la
intersección de IDs a partir de la receta —sin abrir ni materializar ninguna
matriz— y deja registrada la decisión en la receta.

El criterio de aceptación de RF-2 (S10) va literal: *3 matrices de 40, 38 y
40 muestras con 36 en común → 36 muestras en el mismo orden y 4, 2 y 4
descartadas*.
"""

from __future__ import annotations

from typing import Any, Callable

from app.errors import derive_message_key

#: IDs comunes a los tres bloques del criterio de aceptación.
COMUNES = [f"S{indice:02d}" for indice in range(1, 37)]

#: IDs exclusivos del bloque de 40 muestras (4 descartadas).
SOLO_GEN = [f"S{indice:02d}" for indice in range(37, 41)]

#: IDs exclusivos del bloque de 38 muestras (2 descartadas).
SOLO_LIP = ["S41", "S42"]

#: IDs exclusivos del tercer bloque (4 descartadas).
SOLO_META = [f"S{indice:02d}" for indice in range(43, 47)]


def _csv(ids: list[str], columna: str = "g1") -> str:
    """Arma un CSV tabular con una fila por muestra."""
    lineas = [f"sample,{columna}"]
    for posicion, identificador in enumerate(ids):
        lineas.append(f"{identificador},{float(posicion)}")
    return "\n".join(lineas) + "\n"


def _crear_receta(
    client: Any,
    write_block: Callable[[str, str], Any],
    bloques: list[tuple[str, str, str]],
    target: dict[str, str] | None = None,
) -> str:
    """Crea una receta con los bloques dados y devuelve su identificador.

    Args:
        client: Cliente HTTP de pruebas.
        write_block: Escritor de bloques en el directorio de datos.
        bloques: Lista de (nombre, rol, contenido) de cada bloque.
        target: Variable de clase, si la receta es supervisada.
    """
    entradas = []
    for nombre, rol, contenido in bloques:
        write_block(nombre, contenido)
        entradas.append({"name": nombre, "role": rol})

    cuerpo: dict[str, Any] = {"blocks": entradas}
    if target is not None:
        cuerpo["target"] = target

    respuesta = client.post("/v1/datasets/", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    return str(respuesta.json()["id"])


def _alinear(
    client: Any, dataset_id: str, bloques: list[str], confirmed: bool = True
) -> Any:
    """Invoca el endpoint de alineación."""
    return client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": bloques, "confirmed": confirmed},
    )


# ---------------------------------------------------------------------------
# Criterio de aceptación de RF-2 (S10)
# ---------------------------------------------------------------------------


def test_alinear_conserva_36_muestras_en_el_mismo_orden_y_reporta_descartadas(
    client: Any, write_block: Any
) -> None:
    """S10 literal: 3 matrices de 40, 38 y 40 muestras con 36 en común.

    Las 3 quedan con 36 muestras en el mismo orden y el sistema informa las
    4, 2 y 4 descartadas.
    """
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("lipid.csv", "block", _csv(COMUNES + SOLO_LIP)),
            ("meta.csv", "metadata", _csv(COMUNES + SOLO_META, "genotype")),
        ],
    )

    respuesta = _alinear(
        client, dataset_id, ["gene.csv", "lipid.csv", "meta.csv"]
    )

    assert respuesta.status_code == 200, respuesta.text
    alineacion = respuesta.json()
    assert alineacion["sample_ids"] == COMUNES
    assert alineacion["confirmed"] is True
    assert alineacion["discarded"] == {
        "gene.csv": SOLO_GEN,
        "lipid.csv": SOLO_LIP,
        "meta.csv": SOLO_META,
    }


def test_alinear_reporta_todas_las_descartadas_por_bloque(
    client: Any, write_block: Any
) -> None:
    """Cada bloque reporta lo que le sobra, aunque no le sobre nada."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2"])),
            ("lipid.csv", "block", _csv(["S1", "S2"])),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["discarded"] == {"gene.csv": [], "lipid.csv": []}


# ---------------------------------------------------------------------------
# Orden canónico
# ---------------------------------------------------------------------------


def test_alinear_toma_el_orden_del_primer_bloque_seleccionado(
    client: Any, write_block: Any
) -> None:
    """El orden canónico es el del primer bloque: los IDs pueden venir distintos."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2", "S3"])),
            ("lipid.csv", "block", _csv(["S3", "S1", "S2"])),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["sample_ids"] == ["S1", "S2", "S3"]


def test_alinear_cambia_el_orden_cuando_cambia_el_primer_bloque(
    client: Any, write_block: Any
) -> None:
    """El orden canónico sigue al primer bloque, no a un bloque fijo."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2", "S3"])),
            ("lipid.csv", "block", _csv(["S3", "S1", "S2"])),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["lipid.csv", "gene.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["sample_ids"] == ["S3", "S1", "S2"]


# ---------------------------------------------------------------------------
# Errores
# ---------------------------------------------------------------------------


def test_alinear_sin_ids_comunes_da_400(client: Any, write_block: Any) -> None:
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2"])),
            ("lipid.csv", "block", _csv(["X1", "X2"])),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "E_NO_COMMON_SAMPLES"


def test_alinear_un_bloque_ajeno_a_la_receta_da_404(
    client: Any, write_block: Any
) -> None:
    dataset_id = _crear_receta(
        client, write_block, [("gene.csv", "block", _csv(["S1", "S2"]))]
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "otro.csv"])

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_BLOCK"


def test_alinear_con_el_bloque_del_target_fuera_da_422(
    client: Any, write_block: Any
) -> None:
    """S39: si el archivo de phenotypes no se alinea, la clase queda desfasada."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("meta.csv", "metadata", _csv(COMUNES + SOLO_META, "genotype")),
        ],
        target={"block": "meta.csv", "column": "genotype"},
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv"])

    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "E_TARGET_BLOCK_NOT_ALIGNED"


def test_alinear_con_el_bloque_del_target_incluido_no_falla(
    client: Any, write_block: Any
) -> None:
    """El mismo dataset alineado con el bloque del target sí se alinea."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("meta.csv", "metadata", _csv(COMUNES + SOLO_META, "genotype")),
        ],
        target={"block": "meta.csv", "column": "genotype"},
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "meta.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["sample_ids"] == COMUNES


def test_alinear_un_dataset_inexistente_da_404(client: Any) -> None:
    respuesta = client.post(
        "/v1/datasets/ds_0123456789ab/align/",
        json={"blocks": ["gene.csv"], "confirmed": True},
    )

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_DATASET"


def test_alinear_sin_bloques_da_422(client: Any, write_block: Any) -> None:
    dataset_id = _crear_receta(
        client, write_block, [("gene.csv", "block", _csv(["S1", "S2"]))]
    )

    respuesta = client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": [], "confirmed": True},
    )

    assert respuesta.status_code == 422


# ---------------------------------------------------------------------------
# Idempotencia, re-invocación y persistencia
# ---------------------------------------------------------------------------


def test_alinear_dos_veces_con_los_mismos_bloques_da_el_mismo_resultado(
    client: Any, write_block: Any
) -> None:
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("lipid.csv", "block", _csv(COMUNES + SOLO_LIP)),
        ],
    )

    primera = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])
    segunda = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert primera.status_code == 200, primera.text
    assert segunda.status_code == 200, segunda.text
    assert segunda.json() == primera.json()


def test_alinear_de_nuevo_con_menos_bloques_realinea(
    client: Any, write_block: Any
) -> None:
    """Re-invocable: excluir un bloque es llamarlo con menos bloques.

    Al quedar un solo bloque, la intersección es ese bloque mismo: la
    alineación se recalcula con los bloques de la nueva llamada.
    """
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("lipid.csv", "block", _csv(COMUNES + SOLO_LIP)),
        ],
    )

    _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])
    respuesta = _alinear(client, dataset_id, ["gene.csv"])

    assert respuesta.status_code == 200, respuesta.text
    alineacion = respuesta.json()
    assert alineacion["sample_ids"] == COMUNES + SOLO_GEN
    assert alineacion["discarded"] == {"gene.csv": []}

    guardada = client.get(f"/v1/datasets/{dataset_id}/").json()
    assert guardada["alignment"] == alineacion


def test_la_alineacion_queda_persistida_en_la_receta(
    client: Any, write_block: Any
) -> None:
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("lipid.csv", "block", _csv(COMUNES + SOLO_LIP)),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert respuesta.status_code == 200, respuesta.text
    guardada = client.get(f"/v1/datasets/{dataset_id}/").json()
    assert guardada["alignment"] == respuesta.json()


def test_alinear_registra_la_confirmacion_del_usuario(
    client: Any, write_block: Any
) -> None:
    """La alineación queda sin confirmar hasta que el usuario la confirma."""
    dataset_id = _crear_receta(
        client, write_block, [("gene.csv", "block", _csv(["S1", "S2"]))]
    )

    sin_confirmar = _alinear(
        client, dataset_id, ["gene.csv"], confirmed=False
    )
    confirmada = _alinear(client, dataset_id, ["gene.csv"], confirmed=True)

    assert sin_confirmar.status_code == 200, sin_confirmar.text
    assert sin_confirmar.json()["confirmed"] is False
    assert confirmada.json()["confirmed"] is True


def test_alinear_no_devuelve_las_matrices(client: Any, write_block: Any) -> None:
    """La alineación se calcula desde la receta: los valores no viajan."""
    dataset_id = _crear_receta(
        client, write_block, [("gene.csv", "block", _csv(["S1", "S2"]))]
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert set(respuesta.json()) == {"sample_ids", "discarded", "confirmed"}
    assert "0.0" not in respuesta.text


# ---------------------------------------------------------------------------
# Triangulación: casos alternos y negativos que protegen el contrato
# ---------------------------------------------------------------------------


def test_alinear_no_abre_los_archivos_de_datos(
    client: Any, write_block: Any, data_dir: Any
) -> None:
    """La intersección sale de la receta: sin los archivos, la alineación sigue.

    Es la garantía estructural de S29: la API no materializa matrices.
    """
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(COMUNES + SOLO_GEN)),
            ("lipid.csv", "block", _csv(COMUNES + SOLO_LIP)),
        ],
    )
    (data_dir / "gene.csv").unlink()
    (data_dir / "lipid.csv").unlink()

    respuesta = _alinear(client, dataset_id, ["gene.csv", "lipid.csv"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["sample_ids"] == COMUNES
    assert respuesta.json()["discarded"] == {
        "gene.csv": SOLO_GEN,
        "lipid.csv": SOLO_LIP,
    }


def test_el_error_del_bloque_del_target_trae_la_clave_de_i18n_derivada(
    client: Any, write_block: Any
) -> None:
    """El código nuevo viaja con la clave que el renderer resuelve (S22, S28)."""
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2"])),
            ("meta.csv", "metadata", _csv(["S1", "S2"], "genotype")),
        ],
        target={"block": "meta.csv", "column": "genotype"},
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv"])

    assert respuesta.status_code == 422
    error = respuesta.json()["error"]
    assert error["code"] == "E_TARGET_BLOCK_NOT_ALIGNED"
    assert error["message_key"] == "errors.targetBlockNotAligned"
    assert error["message_key"] == derive_message_key("E_TARGET_BLOCK_NOT_ALIGNED")
    assert error["detail"]["block"] == "meta.csv"


def test_alinear_con_un_bloque_repetido_lo_cuenta_una_sola_vez(
    client: Any, write_block: Any
) -> None:
    dataset_id = _crear_receta(
        client,
        write_block,
        [
            ("gene.csv", "block", _csv(["S1", "S2"])),
            ("lipid.csv", "block", _csv(["S1", "S2"])),
        ],
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv", "gene.csv", "lipid.csv"])

    assert respuesta.status_code == 200, respuesta.text
    alineacion = respuesta.json()
    assert alineacion["sample_ids"] == ["S1", "S2"]
    assert alineacion["discarded"] == {"gene.csv": [], "lipid.csv": []}


def test_alinear_un_solo_bloque_conserva_todas_sus_muestras(
    client: Any, write_block: Any
) -> None:
    """Con un solo bloque, la intersección es ese bloque mismo."""
    dataset_id = _crear_receta(
        client, write_block, [("gene.csv", "block", _csv(COMUNES + SOLO_GEN))]
    )

    respuesta = _alinear(client, dataset_id, ["gene.csv"])

    assert respuesta.status_code == 200, respuesta.text
    alineacion = respuesta.json()
    assert alineacion["sample_ids"] == COMUNES + SOLO_GEN
    assert alineacion["discarded"] == {"gene.csv": []}
