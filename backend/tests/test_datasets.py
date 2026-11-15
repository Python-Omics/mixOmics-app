"""Pruebas de la receta de datos (T4): el dataset es un recurso, no matrices.

El backend guarda una **receta**: rutas, forma, IDs de muestra, clasificación
numérica/categórica y decisiones. Las matrices nunca se materializan en la API
(S29), y el cliente manda **nombres** de archivo, nunca rutas: el backend
resuelve el archivo dentro de su propio directorio de datos y lo parsea con
:func:`app.ingest.parse_block`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from app.datasets import DatasetStore
from app.errors import ErrorCode, PythomicsError
from app.schemas import BlockRef, PreprocessingStep, TargetSpec

#: Formato del identificador de una receta.
ID_PATTERN = re.compile(r"^ds_[0-9a-f]{12}$")

#: Claves de un bloque dentro de la receta guardada.
CLAVES_BLOQUE = {
    "name",
    "role",
    "path",
    "n_samples",
    "n_variables",
    "n_numeric_variables",
    "categorical_columns",
    "sample_ids",
}


def _bloque(
    name: str,
    *,
    role: str = "block",
    path: str = "/datos/bloque.csv",
    n_samples: int = 2,
) -> BlockRef:
    """Construye una referencia de bloque para las pruebas del store."""
    return BlockRef(
        name=name,
        role=role,  # type: ignore[arg-type]
        path=path,
        n_samples=n_samples,
        n_variables=2,
        n_numeric_variables=2,
        categorical_columns=[],
        sample_ids=["S1", "S2"],
    )


def _store(tmp_path: Path) -> DatasetStore:
    """Store de recetas sobre un directorio temporal."""
    return DatasetStore(tmp_path / "datasets")


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


def test_store_create_guarda_la_receta_y_la_devuelve(tmp_path: Path) -> None:
    store = _store(tmp_path)
    bloques = [_bloque("a.csv"), _bloque("b.csv")]

    receta = store.create(bloques, None)

    assert ID_PATTERN.match(receta.id)
    assert receta.blocks == bloques
    assert receta.target is None
    assert (store.root / f"{receta.id}.json").is_file()
    assert store.get(receta.id) == receta


def test_store_guarda_solo_la_receta_y_no_las_matrices(tmp_path: Path) -> None:
    """La receta guarda forma y decisiones, jamás los valores de la matriz."""
    store = _store(tmp_path)

    receta = store.create([_bloque("a.csv")], None)

    contenido = (store.root / f"{receta.id}.json").read_text(encoding="utf-8")
    guardada = json.loads(contenido)
    assert set(guardada) == {"id", "blocks", "alignment", "preprocessing", "target"}
    assert set(guardada["blocks"][0]) == CLAVES_BLOQUE


def test_store_get_con_id_invalido_no_toca_el_disco(tmp_path: Path) -> None:
    """Un ID con otro formato no se busca en el disco: se rechaza de entrada."""
    store = _store(tmp_path)

    with pytest.raises(PythomicsError) as exc_info:
        store.get("no-es-un-id")

    assert exc_info.value.code is ErrorCode.E_UNKNOWN_DATASET
    assert list(store.root.iterdir()) == []


def test_store_get_con_id_de_traversal_no_toca_el_disco(tmp_path: Path) -> None:
    store = _store(tmp_path)

    with pytest.raises(PythomicsError) as exc_info:
        store.get("../../etc/passwd")

    assert exc_info.value.code is ErrorCode.E_UNKNOWN_DATASET
    assert list(store.root.iterdir()) == []


def test_store_get_de_id_inexistente_da_404(tmp_path: Path) -> None:
    store = _store(tmp_path)

    with pytest.raises(PythomicsError) as exc_info:
        store.get("ds_0123456789ab")

    assert exc_info.value.code is ErrorCode.E_UNKNOWN_DATASET


def test_store_delete_con_id_invalido_no_toca_el_disco(tmp_path: Path) -> None:
    store = _store(tmp_path)

    with pytest.raises(PythomicsError) as exc_info:
        store.delete("../fuera")

    assert exc_info.value.code is ErrorCode.E_UNKNOWN_DATASET
    assert list(store.root.iterdir()) == []


def test_store_delete_de_id_inexistente_da_404(tmp_path: Path) -> None:
    store = _store(tmp_path)

    with pytest.raises(PythomicsError) as exc_info:
        store.delete("ds_0123456789ab")

    assert exc_info.value.code is ErrorCode.E_UNKNOWN_DATASET


def test_store_delete_borra_la_receta(tmp_path: Path) -> None:
    store = _store(tmp_path)
    receta = store.create([_bloque("a.csv")], None)

    store.delete(receta.id)

    assert not (store.root / f"{receta.id}.json").exists()
    with pytest.raises(PythomicsError):
        store.get(receta.id)


def test_store_save_reemplaza_la_receta(tmp_path: Path) -> None:
    store = _store(tmp_path)
    receta = store.create([_bloque("a.csv")], None)
    receta.target = TargetSpec(block="a.csv", column="label")

    guardada = store.save(receta)

    assert guardada.target == TargetSpec(block="a.csv", column="label")
    assert store.get(receta.id).target == TargetSpec(block="a.csv", column="label")


def test_store_conserva_los_pasos_de_preprocesamiento(tmp_path: Path) -> None:
    """El preprocesamiento vive con la receta, no se recalcula (RB-13, S17)."""
    store = _store(tmp_path)
    receta = store.create([_bloque("a.csv")], None)
    receta.preprocessing = [
        PreprocessingStep(op="center", params={}),
        PreprocessingStep(op="scale", params={"scale": True}),
    ]

    store.save(receta)

    guardada = store.get(receta.id)
    assert [paso.op for paso in guardada.preprocessing] == ["center", "scale"]
    assert guardada.preprocessing[1].params == {"scale": True}


def test_store_list_devuelve_las_recetas(tmp_path: Path) -> None:
    store = _store(tmp_path)
    primera = store.create([_bloque("a.csv")], None)
    segunda = store.create(
        [_bloque("b.csv")], TargetSpec(block="b.csv", column="clase")
    )

    recetas = store.list()

    assert {receta.id for receta in recetas} == {primera.id, segunda.id}
    assert len(recetas) == 2


def test_store_escribe_de_forma_atomica_y_no_deja_temporales(
    tmp_path: Path,
) -> None:
    """La escritura pasa por un ``.tmp`` que se renombra: nunca queda a medias."""
    store = _store(tmp_path)

    receta = store.create([_bloque("a.csv")], None)

    assert list(store.root.glob("*.tmp")) == []
    assert list(store.root.iterdir()) == [store.root / f"{receta.id}.json"]


def test_store_list_ignora_archivos_que_no_son_recetas(tmp_path: Path) -> None:
    store = _store(tmp_path)
    receta = store.create([_bloque("a.csv")], None)
    (store.root / "notas.txt").write_text("hola", encoding="utf-8")
    (store.root / "ds_0123456789ab.json.tmp").write_text("{", encoding="utf-8")

    assert [item.id for item in store.list()] == [receta.id]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def test_crear_dataset_con_dos_bloques(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\n")
    write_block("meta.csv", "sample,genotype\nS1,1\nS2,2\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={
            "blocks": [
                {"name": "gene.csv", "role": "block"},
                {"name": "meta.csv", "role": "metadata"},
            ]
        },
    )

    assert respuesta.status_code == 201
    receta = respuesta.json()
    assert ID_PATTERN.match(receta["id"])
    assert [bloque["name"] for bloque in receta["blocks"]] == [
        "gene.csv",
        "meta.csv",
    ]
    assert [bloque["role"] for bloque in receta["blocks"]] == ["block", "metadata"]
    gen = receta["blocks"][0]
    assert gen["n_samples"] == 2
    assert gen["n_variables"] == 2
    assert gen["n_numeric_variables"] == 2
    assert gen["categorical_columns"] == []
    assert gen["sample_ids"] == ["S1", "S2"]
    assert gen["path"].endswith("gene.csv")


def test_crear_dataset_toma_la_clasificacion_del_archivo_real(
    client: Any, write_block: Any
) -> None:
    """La clasificación viene del archivo, no del rol declarado."""
    write_block("mixto.csv", "sample,g1,label\nS1,1.5,A\nS2,3.5,B\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "mixto.csv"}]},
    )

    assert respuesta.status_code == 201
    bloque = respuesta.json()["blocks"][0]
    assert bloque["n_variables"] == 2
    assert bloque["n_numeric_variables"] == 1
    assert bloque["categorical_columns"] == ["label"]
    assert bloque["sample_ids"] == ["S1", "S2"]


def test_crear_dataset_no_devuelve_las_matrices(client: Any, write_block: Any) -> None:
    """La respuesta es la receta: los valores de la matriz no viajan."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv"}]},
    )

    assert respuesta.status_code == 201
    receta = respuesta.json()
    assert set(receta) == {"id", "blocks", "alignment", "preprocessing", "target"}
    assert set(receta["blocks"][0]) == CLAVES_BLOQUE
    assert "1.5" not in json.dumps(receta)


def test_crear_dataset_registra_el_target(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    write_block("meta.csv", "sample,genotype\nS1,1\nS2,2\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={
            "blocks": [{"name": "gene.csv"}, {"name": "meta.csv"}],
            "target": {"block": "meta.csv", "column": "genotype"},
        },
    )

    assert respuesta.status_code == 201
    receta = respuesta.json()
    assert receta["target"] == {"block": "meta.csv", "column": "genotype"}
    assert (
        client.get(f"/v1/datasets/{receta['id']}/").json()["target"]["column"]
        == "genotype"
    )


def test_crear_dataset_rechaza_target_de_bloque_ajeno(
    client: Any, write_block: Any
) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={
            "blocks": [{"name": "gene.csv"}],
            "target": {"block": "otro.csv", "column": "clase"},
        },
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "E_TARGET_COLUMN_MISSING"


def test_crear_dataset_no_valida_la_columna_del_target(
    client: Any, write_block: Any
) -> None:
    """La columna se valida en el model request, no en la ingesta (S38)."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={
            "blocks": [{"name": "gene.csv"}],
            "target": {"block": "gene.csv", "column": "columna-inexistente"},
        },
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["target"]["column"] == "columna-inexistente"


def test_crear_dataset_rechaza_bloque_inexistente(client: Any) -> None:
    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "no-existe.csv"}]},
    )

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_BLOCK"


def test_crear_dataset_rechaza_nombre_con_traversal(
    client: Any, data_dir: Path
) -> None:
    """Un nombre con ``../`` no puede alcanzar un archivo de fuera del directorio."""
    fuera = data_dir.parent / "fuera-del-backend.csv"
    fuera.write_text("sample,g1\nS1,1.5\n", encoding="utf-8")

    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "../fuera-del-backend.csv"}]},
    )

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_BLOCK"
    assert list((data_dir / "datasets").iterdir()) == []


def test_listar_datasets(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    primera = client.post(
        "/v1/datasets/", json={"blocks": [{"name": "gene.csv"}]}
    ).json()
    segunda = client.post(
        "/v1/datasets/",
        json={
            "blocks": [{"name": "gene.csv"}, {"name": "gene.csv"}],
            "target": {"block": "gene.csv", "column": "g1"},
        },
    ).json()

    respuesta = client.get("/v1/datasets/")

    assert respuesta.status_code == 200
    listado = respuesta.json()
    assert listado["total"] == 2
    assert {item["id"] for item in listado["datasets"]} == {
        primera["id"],
        segunda["id"],
    }
    resumida = next(
        item for item in listado["datasets"] if item["id"] == segunda["id"]
    )
    assert resumida["n_blocks"] == 2
    assert resumida["target"] == {"block": "gene.csv", "column": "g1"}


def test_obtener_dataset(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    creado = client.post(
        "/v1/datasets/", json={"blocks": [{"name": "gene.csv"}]}
    ).json()

    respuesta = client.get(f"/v1/datasets/{creado['id']}/")

    assert respuesta.status_code == 200
    assert respuesta.json() == creado


def test_obtener_dataset_inexistente(client: Any) -> None:
    respuesta = client.get("/v1/datasets/ds_0123456789ab/")

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_DATASET"


def test_id_con_formato_invalido_da_404_sin_tocar_el_disco(
    client: Any, data_dir: Path
) -> None:
    respuesta = client.get("/v1/datasets/no-es-un-id/")

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_DATASET"
    assert list((data_dir / "datasets").iterdir()) == []


def test_id_con_traversal_da_404_sin_tocar_el_disco(
    client: Any, data_dir: Path
) -> None:
    respuesta = client.get("/v1/datasets/..%2F..%2Fetc%2Fpasswd/")

    assert respuesta.status_code == 404
    assert list((data_dir / "datasets").iterdir()) == []


def test_fijar_target_de_un_dataset(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    write_block("meta.csv", "sample,genotype\nS1,1\nS2,2\n")
    creado = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv"}, {"name": "meta.csv"}]},
    ).json()

    respuesta = client.post(
        f"/v1/datasets/{creado['id']}/target/",
        json={"block": "meta.csv", "column": "genotype"},
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["target"] == {"block": "meta.csv", "column": "genotype"}
    assert (
        client.get(f"/v1/datasets/{creado['id']}/").json()["target"]["column"]
        == "genotype"
    )


def test_fijar_target_de_bloque_ajeno_da_422(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    creado = client.post(
        "/v1/datasets/", json={"blocks": [{"name": "gene.csv"}]}
    ).json()

    respuesta = client.post(
        f"/v1/datasets/{creado['id']}/target/",
        json={"block": "otro.csv", "column": "clase"},
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "E_TARGET_COLUMN_MISSING"


def test_borrar_dataset(client: Any, write_block: Any) -> None:
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    creado = client.post(
        "/v1/datasets/", json={"blocks": [{"name": "gene.csv"}]}
    ).json()

    respuesta = client.delete(f"/v1/datasets/{creado['id']}/")

    assert respuesta.status_code == 200
    assert "mensaje" in respuesta.json()
    assert client.get(f"/v1/datasets/{creado['id']}/").status_code == 404


def test_borrar_dataset_inexistente(client: Any) -> None:
    respuesta = client.delete("/v1/datasets/ds_0123456789ab/")

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_DATASET"


def test_crear_dataset_sin_token_da_401(client: Any, write_block: Any) -> None:
    """Sin el token compartido no se crea ninguna receta."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv"}]},
        headers={"X-Pythomics-Token": ""},
    )

    assert respuesta.status_code == 401
    assert respuesta.json()["error"]["code"] == "E_UNAUTHORIZED"


def test_crear_dataset_rechaza_bloque_con_ids_duplicados(
    client: Any, write_block: Any, data_dir: Path
) -> None:
    """Un bloque que no supera la validación de la ingesta no entra en la receta."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS1,3.5\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv"}]},
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "E_DUPLICATE_SAMPLES"
    assert list((data_dir / "datasets").iterdir()) == []


def test_crear_dataset_rechaza_nombre_que_es_un_directorio(
    client: Any, data_dir: Path
) -> None:
    (data_dir / "carpeta").mkdir()

    respuesta = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "carpeta"}]},
    )

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_BLOCK"


def test_crear_dataset_rechaza_campos_desconocidos(
    client: Any, write_block: Any
) -> None:
    """El contrato es estricto: el renderer no puede mandar una ruta."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")

    respuesta = client.post(
        "/v1/datasets/",
        json={
            "blocks": [{"name": "gene.csv"}],
            "ruta": "/etc/passwd",
        },
    )

    assert respuesta.status_code == 422


def test_crear_dataset_sin_bloques_da_422(client: Any) -> None:
    respuesta = client.post("/v1/datasets/", json={"blocks": []})

    assert respuesta.status_code == 422


def test_borrar_dataset_no_borra_los_archivos_de_datos(
    client: Any, write_block: Any, data_dir: Path
) -> None:
    """Borrar una receta no toca los archivos que el usuario subió."""
    write_block("gene.csv", "sample,g1\nS1,1.5\nS2,3.5\n")
    creado = client.post(
        "/v1/datasets/", json={"blocks": [{"name": "gene.csv"}]}
    ).json()

    respuesta = client.delete(f"/v1/datasets/{creado['id']}/")

    assert respuesta.status_code == 200
    assert (data_dir / "gene.csv").is_file()
