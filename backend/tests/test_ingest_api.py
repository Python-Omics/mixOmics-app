"""Pruebas HTTP del endpoint de carga de bloques (RF-1, RB-14).

Los tests de :mod:`tests.test_ingest` cubren el parser puro. Estos cubren la
capa HTTP: dónde queda el archivo, qué pasa con un archivo inválido y qué
exige la autenticación.
"""

from __future__ import annotations

from pathlib import Path

from app.auth import TOKEN_HEADER


def test_subir_archivo_lo_guarda_con_el_nombre_normalizado(
    client: object,
    data_dir: Path,
) -> None:
    """El nombre se reduce a su base igual en Windows y en Linux."""
    response = client.post(  # type: ignore[attr-defined]
        "/v1/archivos/",
        files={
            "file": ("..\\..\\gene.csv", "sample,g1\nS1,1.5\n", "text/csv"),
        },
    )

    assert response.status_code == 201
    assert (data_dir / "gene.csv").is_file()
    assert list(data_dir.glob("*.csv")) == [data_dir / "gene.csv"]


def test_subir_archivo_invalido_no_deja_basura(
    client: object,
    data_dir: Path,
) -> None:
    """Un archivo que no pasa la validación no queda en el directorio."""
    response = client.post(  # type: ignore[attr-defined]
        "/v1/archivos/",
        files={
            "file": ("malo.csv", "sample,g1\nS1,1\nS1,2\n", "text/csv"),
        },
    )

    assert response.status_code == 409
    assert list(data_dir.glob("*.csv")) == []


def test_subir_archivo_con_extension_invalida_no_deja_basura(
    client: object,
    data_dir: Path,
) -> None:
    response = client.post(  # type: ignore[attr-defined]
        "/v1/archivos/",
        files={"file": ("notas.txt", "sample,g1\nS1,1.5\n", "text/plain")},
    )

    assert response.status_code == 400
    # No queda ningun archivo: la extension se comprueba antes de escribir.
    assert [entrada for entrada in data_dir.iterdir() if entrada.is_file()] == []


def test_subir_archivo_sin_token_es_rechazado(client: object) -> None:
    response = client.post(  # type: ignore[attr-defined]
        "/v1/archivos/",
        files={"file": ("gene.csv", "sample,g1\nS1,1.5\n", "text/csv")},
        headers={TOKEN_HEADER: "token-que-no-es-el-del-servidor"},
    )

    assert response.status_code == 401
