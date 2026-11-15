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
    categorical_columns: list[str]
    sample_ids: list[str]
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
            vacío, sus filas no coinciden con el encabezado o hay IDs
            duplicados.
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

    # Una celda vacía es un dato faltante, y el MVP no preprocesa.
    # `NipalsPCA` no falla con `NaN`: lo absorbe en los momentos y devuelve
    # scores plausibles pero incorrectos. Rechazar acá, con un motivo
    # claro, es mejor que dejar que el cálculo produzca basura en
    # silencio (decisión del operador, L18 del plan).
    missing_by_column = _count_missing_by_column(frame)
    missing_columns = [
        name for name, count in missing_by_column.items() if count > 0
    ]
    total_missing = sum(missing_by_column.values())
    if total_missing > 0:
        raise PythomicsError(
            ErrorCode.E_MISSING_VALUES,
            detail={
                "file": filename,
                "total_cells": total_missing,
                "affected_columns": len(missing_columns),
                "columns": missing_columns,
            },
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
        categorical_columns=non_numeric_columns,
        sample_ids=sample_ids,
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
    """Lee el contenido como tabla normalizada y valida el ancho de las filas.

    Se usa ``csv.reader`` en vez de dejar que ``pandas`` infiera la forma.
    ``pandas`` consume en silencio los campos sobrantes de una fila como
    índice del frame, lo que desplaza los IDs de muestra y los valores sin
    avisar: un CSV con coma decimal (``1,5``) queda con los IDs equivocados
    y una columna constante, sin ningún error. Validando el ancho antes de
    construir la tabla, ese caso se rechaza en vez de corromper los datos.

    Criterio de normalización:

    - una fila con **más** campos que el encabezado y contenido en los
      sobrantes es ambigua: se rechaza;
    - una fila con más campos pero todos los sobrantes vacíos es el artefacto
      de la coma final: se recorta;
    - una fila con **menos** campos se completa con celdas vacías, igual que
      una celda vacía explícita.
    """
    try:
        rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    except csv.Error as exc:
        raise PythomicsError(
            ErrorCode.E_MALFORMED_FILE,
            detail={"file": filename, "reason": str(exc)},
        ) from exc

    # Las líneas en blanco no son registros (mismo criterio que pandas).
    rows = [row for row in rows if row]
    if not rows:
        raise PythomicsError(
            ErrorCode.E_EMPTY_FILE,
            detail={"file": filename},
        )

    header = _unique_columns([str(cell) for cell in rows[0]])
    width = len(header)
    normalized: list[list[str]] = []

    for line_number, row in enumerate(rows[1:], start=2):
        values = [str(cell) for cell in row]
        if len(values) > width:
            extra = values[width:]
            if all(cell.strip() == "" for cell in extra):
                values = values[:width]
            else:
                raise PythomicsError(
                    ErrorCode.E_MALFORMED_FILE,
                    detail={
                        "file": filename,
                        "line": line_number,
                        "expected_fields": width,
                        "found_fields": len(values),
                    },
                )
        elif len(values) < width:
            values = values + [""] * (width - len(values))
        normalized.append(values)

    return pd.DataFrame(normalized, columns=header, dtype=str)


def _unique_columns(header: list[str]) -> list[str]:
    """Hace únicos los nombres de columna repetidos, como hace pandas."""
    seen: dict[str, int] = {}
    unique: list[str] = []
    for name in header:
        count = seen.get(name, 0)
        seen[name] = count + 1
        unique.append(name if count == 0 else f"{name}.{count}")
    return unique


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


def _count_missing_by_column(frame: pd.DataFrame) -> dict[str, int]:
    """Cuenta las celdas vacías de cada columna.

    Una celda vacía es un dato faltante: al materializar la matriz se
    convierte en ``NaN`` y la política para tratarla (imputar, descartar la
    muestra o fallar) se decide en el preprocesamiento (RF-3), no en la
    ingesta. Aquí solo se informa el hecho, con su magnitud: dos celdas
    vacías y el cuarenta por ciento de las celdas vacías son problemas
    distintos, y la vista previa (5 filas) no lo distingue.

    Una fila con menos campos que el encabezado cuenta como celdas vacías
    en las columnas que faltan: es el mismo dato faltante, escrito de otra
    forma.
    """
    counts = frame.eq("").sum()
    return {str(name): int(count) for name, count in counts.items()}


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
