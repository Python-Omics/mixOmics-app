"""Ingesta y validación de bloques tabulares del backend de Pythomics.

La función :func:`parse_block` es pura y sin estado: recibe un archivo ya
guardado y devuelve un :class:`ParsedBlock`. No muta el directorio de datos,
no conserva estado entre llamadas y no importa ``pythomics`` ni ``rpy2``;
por eso puede mudarse al worker sin cambiar el contrato (S31).

La convención de los archivos es fija: una fila por muestra, una columna por
variable y la primera columna contiene el ID textual de la muestra. La ingesta
no juzga el rol del bloque: registra qué columnas son numéricas y qué columnas
contienen texto. Un archivo mixto produce un aviso; una tabla de phenotypes
formada solo por texto es válida y no produce ninguno (RF-1).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.errors import (
    ErrorCode,
    PythomicsError,
    WarningCode,
    derive_warning_message_key,
)
from app.schemas import IngestWarning, PreviewData

#: Extensiones admitidas por RF-1 y RB-14.
SUPPORTED_EXTENSIONS = frozenset({".csv", ".tsv"})

#: Límites de la vista previa definida por el contrato de ingesta.
PREVIEW_MAX_ROWS = 5
PREVIEW_MAX_COLUMNS = 8

#: Máximo de IDs duplicados incluidos en el detalle del error.
MAX_REPORTED_DUPLICATES = 50

#: Máximo de nombres de variables expuestos en el resumen del bloque.
MAX_REPORTED_COLUMNS = 100

_DECIMAL_COMMA_RE = re.compile(r"^[+-]?\d+,\d+$")


@dataclass(frozen=True, slots=True)
class ParsedBlock:
    """Resumen validado de un bloque tabular."""

    name: str
    filename: str
    n_samples: int
    n_variables: int
    n_numeric_variables: int
    columns: list[str]
    sample_id_column: str
    warnings: list[IngestWarning]
    preview: PreviewData


def parse_block(path: Path, filename: str) -> ParsedBlock:
    """Valida un archivo CSV/TSV y devuelve su resumen de ingesta.

    La función no guarda ni borra el archivo. La capa HTTP se encarga de
    persistirlo y de eliminarlo si la validación falla.

    Args:
        path: Ruta del archivo que se debe leer.
        filename: Nombre seguro del archivo, usado para la extensión, el
            nombre del bloque y los mensajes de error.

    Returns:
        Un :class:`ParsedBlock` con la forma, los avisos y la vista previa.

    Raises:
        PythomicsError: Si la extensión no está soportada, el archivo está
            vacío o hay IDs duplicados.
    """
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise PythomicsError(
            ErrorCode.E_FILE_EXTENSION,
            detail={
                "file": filename,
                "allowed_extensions": sorted(SUPPORTED_EXTENSIONS),
            },
        )

    try:
        raw_content = path.read_bytes()
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"file": filename, "reason": str(exc)},
        ) from exc

    text, encoding_warning = _decode_content(raw_content, filename)
    delimiter = _detect_delimiter(text, filename)
    frame = _read_frame(text, delimiter, filename)

    if frame.empty or len(frame.columns) == 0:
        raise PythomicsError(
            ErrorCode.E_EMPTY_FILE,
            detail={"file": filename},
        )

    sample_id_column = str(frame.columns[0])
    sample_ids = [_stringify(value) for value in frame.iloc[:, 0].tolist()]
    _validate_unique_sample_ids(sample_ids, filename)

    variable_columns = list(frame.columns[1:])
    numeric_columns, non_numeric_columns = _classify_variable_columns(
        frame,
        variable_columns,
        delimiter,
    )
    n_variables = len(variable_columns)
    n_numeric_variables = len(numeric_columns)

    warnings: list[IngestWarning] = []
    if encoding_warning is not None:
        warnings.append(encoding_warning)
    if 0 < n_numeric_variables < n_variables:
        warnings.append(
            IngestWarning(
                code=WarningCode.W_NON_NUMERIC_COLUMNS.value,
                message_key=derive_warning_message_key(
                    WarningCode.W_NON_NUMERIC_COLUMNS
                ),
                columns=non_numeric_columns,
                detail={},
            )
        )

    preview = _build_preview(frame, sample_id_column)

    return ParsedBlock(
        name=Path(filename).stem,
        filename=filename,
        n_samples=len(frame),
        n_variables=n_variables,
        n_numeric_variables=n_numeric_variables,
        columns=[
            str(column) for column in variable_columns[:MAX_REPORTED_COLUMNS]
        ],
        sample_id_column=sample_id_column,
        warnings=warnings,
        preview=preview,
    )


def _decode_content(
    raw_content: bytes,
    filename: str,
) -> tuple[str, IngestWarning | None]:
    """Decodifica UTF-8 y repara con Latin-1 cuando no es posible."""
    try:
        # ``utf-8-sig`` también acepta UTF-8 normal y elimina su BOM inicial.
        text = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_content.decode("latin-1")
        warning = IngestWarning(
            code=WarningCode.W_ENCODING_REPAIRED.value,
            message_key=derive_warning_message_key(WarningCode.W_ENCODING_REPAIRED),
            columns=[],
            detail={"file": filename, "encoding": "latin-1"},
        )
        return text, warning

    return text, None


def _detect_delimiter(text: str, filename: str) -> str:
    """Detecta coma, tabulador o punto y coma sin depender del nombre."""
    if text.strip():
        try:
            return csv.Sniffer().sniff(text, delimiters=",\t;").delimiter
        except csv.Error:
            pass

    # Sniffer no puede detectar una única columna. El fallback por extensión
    # mantiene el caso de archivo de una columna sin romperlo.
    return "\t" if Path(filename).suffix.lower() == ".tsv" else ","


def _read_frame(text: str, delimiter: str, filename: str) -> pd.DataFrame:
    """Lee el contenido como texto para conservar los valores del preview."""
    try:
        return pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            engine="python",
            dtype=str,
            keep_default_na=False,
        )
    except pd.errors.EmptyDataError as exc:
        raise PythomicsError(
            ErrorCode.E_EMPTY_FILE,
            detail={"file": filename},
        ) from exc
    except pd.errors.ParserError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"file": filename, "reason": str(exc)},
        ) from exc


def _validate_unique_sample_ids(sample_ids: list[str], filename: str) -> None:
    """Rechaza IDs repetidos dentro del mismo bloque (RB-1)."""
    seen: set[str] = set()
    duplicated: list[str] = []
    for sample_id in sample_ids:
        if sample_id in seen and sample_id not in duplicated:
            duplicated.append(sample_id)
        seen.add(sample_id)

    if duplicated:
        raise PythomicsError(
            ErrorCode.E_DUPLICATE_SAMPLES,
            detail={
                "file": filename,
                "duplicates": duplicated[:MAX_REPORTED_DUPLICATES],
                "duplicate_count": len(duplicated),
            },
        )


def _classify_variable_columns(
    frame: pd.DataFrame,
    variable_columns: list[object],
    delimiter: str,
) -> tuple[list[object], list[str]]:
    """Separa columnas numéricas y no numéricas, admitiendo valores faltantes."""
    numeric_columns: list[object] = []
    non_numeric_columns: list[str] = []

    for column in variable_columns:
        values = frame[column]
        if _uses_decimal_comma(values, delimiter):
            comparable = values.str.replace(",", ".", regex=False)
        else:
            comparable = values

        converted = pd.to_numeric(comparable, errors="coerce")
        non_empty = comparable.str.strip().ne("")
        is_numeric = bool(
            non_empty.empty
            or (converted[non_empty].notna().all())
        )
        if is_numeric:
            numeric_columns.append(column)
        else:
            non_numeric_columns.append(str(column))

    return numeric_columns, non_numeric_columns


def _uses_decimal_comma(values: pd.Series, delimiter: str) -> bool:
    """Indica si una columna usa coma decimal de forma no ambigua."""
    if delimiter == ",":
        return False
    return values.astype(str).str.strip().str.match(_DECIMAL_COMMA_RE).any()


def _build_preview(frame: pd.DataFrame, sample_id_column: str) -> PreviewData:
    """Construye una vista previa acotada, con todos los valores como texto."""
    preview_frame = frame.iloc[:PREVIEW_MAX_ROWS, :PREVIEW_MAX_COLUMNS]
    columns = [str(column) for column in preview_frame.columns]
    rows = [
        [_stringify(value) for value in row]
        for row in preview_frame.itertuples(index=False, name=None)
    ]
    return PreviewData(columns=columns, rows=rows)


def _stringify(value: object) -> str:
    """Convierte un valor de pandas a texto estable para el contrato JSON."""
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value)
