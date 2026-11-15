"""Pruebas de la ingesta y validación de bloques tabulares (RF-1)."""

from pathlib import Path

import pytest

from app.errors import ErrorCode, PythomicsError, derive_warning_message_key
from app.ingest import parse_block


def _write(tmp_path: Path, name: str, content: str) -> Path:
    """Escribe un fixture tabular en el directorio temporal de pytest."""
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return path


def test_parse_block_csv_valido_resume_muestras_y_variables(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "block.csv",
        "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\n",
    )

    parsed = parse_block(path, "block.csv")

    assert parsed.name == "block"
    assert parsed.filename == "block.csv"
    assert parsed.n_samples == 2
    assert parsed.n_variables == 2
    assert parsed.n_numeric_variables == 2
    assert parsed.columns == ["g1", "g2"]
    assert parsed.sample_id_column == "sample"
    assert parsed.warnings == []
    assert parsed.preview.columns == ["sample", "g1", "g2"]
    assert parsed.preview.rows == [
        ["S1", "1.5", "2.5"],
        ["S2", "3.5", "4.5"],
    ]


def test_parse_block_rechaza_extension_no_soportada(tmp_path: Path) -> None:
    path = _write(tmp_path, "block.txt", "sample,g1\nS1,1\n")

    with pytest.raises(PythomicsError) as exc_info:
        parse_block(path, "block.txt")

    assert exc_info.value.code is ErrorCode.E_FILE_EXTENSION
    assert exc_info.value.detail["file"] == "block.txt"


def test_parse_block_rechaza_archivo_sin_filas(tmp_path: Path) -> None:
    path = _write(tmp_path, "empty.csv", "sample,g1\n")

    with pytest.raises(PythomicsError) as exc_info:
        parse_block(path, "empty.csv")

    assert exc_info.value.code is ErrorCode.E_EMPTY_FILE


def test_parse_block_rechaza_ids_duplicados_y_los_lista(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "duplicates.csv",
        "sample,label\nS1,A\nS1,B\n",
    )

    with pytest.raises(PythomicsError) as exc_info:
        parse_block(path, "duplicates.csv")

    error = exc_info.value
    assert error.code is ErrorCode.E_DUPLICATE_SAMPLES
    assert error.detail["file"] == "duplicates.csv"
    assert error.detail["duplicates"] == ["S1"]
    assert error.detail["duplicate_count"] == 1


def test_parse_block_limita_duplicados_reportados_pero_conserva_el_total(
    tmp_path: Path,
) -> None:
    rows = [f"D{i},{i}" for i in range(51) for _ in range(2)]
    path = _write(
        tmp_path,
        "many-duplicates.csv",
        "sample,g1\n" + "\n".join(rows) + "\n",
    )

    with pytest.raises(PythomicsError) as exc_info:
        parse_block(path, "many-duplicates.csv")

    error = exc_info.value
    assert len(error.detail["duplicates"]) == 50
    assert error.detail["duplicates"] == [f"D{i}" for i in range(50)]
    assert error.detail["duplicate_count"] == 51


def test_parse_block_admite_columna_no_numerica_con_warning(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "mixed.csv",
        "sample,g1,label\nS1,1,A\nS2,2,B\n",
    )

    parsed = parse_block(path, "mixed.csv")

    assert parsed.n_variables == 2
    assert parsed.n_numeric_variables == 1
    assert parsed.columns == ["g1", "label"]
    assert len(parsed.warnings) == 1
    warning = parsed.warnings[0]
    assert warning.code == "W_NON_NUMERIC_COLUMNS"
    assert warning.message_key == "ingest.warnings.nonNumericColumns"
    assert warning.columns == ["label"]
    assert warning.detail == {}


def test_parse_block_admite_todas_las_columnas_de_texto_sin_warning(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "text.csv",
        "sample,label,group\nS1,A,x\nS2,B,y\n",
    )

    parsed = parse_block(path, "text.csv")

    assert parsed.n_variables == 2
    assert parsed.n_numeric_variables == 0
    assert parsed.columns == ["label", "group"]
    assert parsed.warnings == []


def test_parse_block_reporta_fenotipos_codificados_como_numericos(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "metadata.csv",
        "sample,genotype,diet\n1,1,3\n2,1,5\n",
    )

    parsed = parse_block(path, "metadata.csv")

    assert parsed.n_variables == 2
    assert parsed.n_numeric_variables == 2
    assert parsed.columns == ["genotype", "diet"]
    assert parsed.warnings == []


def test_parse_block_limita_columns_a_100_sin_ocultar_el_total(
    tmp_path: Path,
) -> None:
    variable_names = [f"g{i}" for i in range(1, 102)]
    header = ",".join(["sample", *variable_names])
    values = ",".join(["1", *(["1.5"] * 101)])
    path = _write(tmp_path, "wide.csv", f"{header}\n{values}\n")

    parsed = parse_block(path, "wide.csv")

    assert parsed.n_variables == 101
    assert parsed.n_numeric_variables == 101
    assert len(parsed.columns) == 100
    assert parsed.columns == variable_names[:100]
    assert parsed.warnings == []


def test_parse_block_tsv(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "block.tsv",
        "sample\tg1\tg2\nS1\t1.5\t2.5\nS2\t3.5\t4.5\n",
    )

    parsed = parse_block(path, "block.tsv")

    assert parsed.n_samples == 2
    assert parsed.n_variables == 2
    assert parsed.preview.columns == ["sample", "g1", "g2"]
    assert parsed.preview.rows == [
        ["S1", "1.5", "2.5"],
        ["S2", "3.5", "4.5"],
    ]


def test_parse_block_detecta_separador_antes_de_la_coma_decimal(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "decimal.csv",
        "sample;g1;g2\nS1;1,5;2,5\nS2;3,5;4,5\n",
    )

    parsed = parse_block(path, "decimal.csv")

    assert parsed.n_samples == 2
    assert parsed.n_variables == 2
    assert parsed.preview.columns == ["sample", "g1", "g2"]
    assert parsed.preview.rows == [
        ["S1", "1,5", "2,5"],
        ["S2", "3,5", "4,5"],
    ]


def test_parse_block_advertencia_para_codificacion_reparada(
    tmp_path: Path,
) -> None:
    path = tmp_path / "latin.csv"
    path.write_bytes("sample,g1\nñ1,1\n".encode("latin-1"))

    parsed = parse_block(path, "latin.csv")

    assert len(parsed.warnings) == 1
    warning = parsed.warnings[0]
    assert warning.code == "W_ENCODING_REPAIRED"
    assert warning.message_key == "ingest.warnings.encodingRepaired"
    assert warning.columns == []


def test_parse_block_acepta_archivo_de_una_sola_columna_de_ids(
    tmp_path: Path,
) -> None:
    path = _write(tmp_path, "one-column.csv", "sample\nS1\nS2\n")

    parsed = parse_block(path, "one-column.csv")

    assert parsed.n_variables == 0
    assert parsed.n_numeric_variables == 0
    assert parsed.columns == []
    assert parsed.warnings == []


def test_parse_block_limita_preview_a_5_filas_y_8_columnas(
    tmp_path: Path,
) -> None:
    header = ",".join(["sample", *[f"g{i}" for i in range(1, 10)]])
    rows = "\n".join(
        ",".join([f"S{i}", *[str(i) for _ in range(1, 10)]]) for i in range(1, 8)
    )
    path = _write(tmp_path, "large.csv", f"{header}\n{rows}\n")

    parsed = parse_block(path, "large.csv")

    assert len(parsed.preview.rows) == 5
    assert len(parsed.preview.columns) == 8
    assert parsed.preview.columns[0] == "sample"


def test_warning_message_key_se_deriva_deterministicamente() -> None:
    assert (
        derive_warning_message_key("W_NON_NUMERIC_COLUMNS")
        == "ingest.warnings.nonNumericColumns"
    )
    assert (
        derive_warning_message_key("W_ENCODING_REPAIRED")
        == "ingest.warnings.encodingRepaired"
    )
