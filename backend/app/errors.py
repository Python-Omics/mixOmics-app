"""Registro de códigos de error del backend de Pythomics.

El backend **no traduce**. Devuelve ``code`` + ``message_key`` + ``detail``
estructurado, y el renderer formatea el mensaje con ICU contra el catálogo
``frontend/src/i18n/{es,en}.json`` (S22, S28). Ningún mensaje escrito en
español viaja por la API: lo que viaja es un código estable y datos
estructurados que el renderer usa para interpolar sus propios textos.

Convención de ``message_key`` para errores:
``errors.<camelCaseDelCodigo>``, derivado programáticamente del código, por
ejemplo:

* ``E_DUPLICATE_SAMPLES`` → ``errors.duplicateSamples``
* ``E_NO_COMMON_SAMPLES`` → ``errors.noCommonSamples``
* ``E_R_NOT_AVAILABLE`` → ``errors.rNotAvailable``

La derivación es determinística: el mismo código produce siempre la misma
clave, sin escribirla a mano. Para agregar un código nuevo basta con
declararlo en :class:`ErrorCode`; la clave de i18n y el estado HTTP se
resuelven solos.

Los avisos de ingesta no son errores y no tienen estado HTTP. Usan códigos
propios en :class:`WarningCode` y la clave
``ingest.warnings.<camelCaseDelCodigo>``. Viajan en
``IngestResponse.warnings`` y el renderer los traduce con el ``message_key``
que acompaña a cada aviso.
"""

from enum import StrEnum
from typing import Any

from .schemas import ApiError, ErrorEnvelope


class ErrorCode(StrEnum):
    """Códigos de error canónicos del MVP (§5.4 del plan ODD).

    Cada código tiene un estado HTTP asociado en
    :data:`HTTP_STATUS_BY_CODE` y una clave de i18n derivada en
    :data:`MESSAGE_KEY_BY_CODE`.

    ``E_NOT_NUMERIC`` ya no se lanza desde la ingesta: esta acepta tablas
    categóricas y registra su clasificación. Se usa al validar un model
    request que requiera un bloque de variables numéricas.

    ``E_MALFORMED_FILE`` se lanza cuando las filas del archivo no coinciden
    con su encabezado. Sin esa validación, ``pandas`` consume los campos
    sobrantes de una fila como índice y desplaza en silencio los IDs de
    muestra y los valores (caso típico: un CSV con coma decimal).
    """

    # Validación de la carga (RB-14, RF-1)
    E_FILE_EXTENSION = "E_FILE_EXTENSION"
    E_EMPTY_FILE = "E_EMPTY_FILE"
    E_MALFORMED_FILE = "E_MALFORMED_FILE"
    E_MISSING_VALUES = "E_MISSING_VALUES"
    E_NOT_NUMERIC = "E_NOT_NUMERIC"

    # Integridad de las matrices (RB-1, RB-3, RF-2)
    E_DUPLICATE_SAMPLES = "E_DUPLICATE_SAMPLES"
    E_NO_COMMON_SAMPLES = "E_NO_COMMON_SAMPLES"
    E_BLOCK_ROWS_MISMATCH = "E_BLOCK_ROWS_MISMATCH"

    # Recursos inexistentes
    E_UNKNOWN_BLOCK = "E_UNKNOWN_BLOCK"
    E_UNKNOWN_DATASET = "E_UNKNOWN_DATASET"
    E_JOB_NOT_FOUND = "E_JOB_NOT_FOUND"

    # Precondiciones del modelo
    E_MODEL_UNKNOWN = "E_MODEL_UNKNOWN"
    E_TARGET_COLUMN_MISSING = "E_TARGET_COLUMN_MISSING"

    # Precondiciones de la alineación (RF-2, S39)
    E_TARGET_BLOCK_NOT_ALIGNED = "E_TARGET_BLOCK_NOT_ALIGNED"

    # Dependencias ausentes en el entorno
    E_R_NOT_AVAILABLE = "E_R_NOT_AVAILABLE"
    E_MIXOMICS_NOT_AVAILABLE = "E_MIXOMICS_NOT_AVAILABLE"

    # Fallos de ejecución
    E_WORKER_CRASHED = "E_WORKER_CRASHED"
    E_ANALYSIS_FAILED = "E_ANALYSIS_FAILED"

    # Genéricos: respaldo para lo que no tiene un código propio
    E_UNEXPECTED = "E_UNEXPECTED"
    E_NOT_IMPLEMENTED = "E_NOT_IMPLEMENTED"
    E_UNAUTHORIZED = "E_UNAUTHORIZED"


class WarningCode(StrEnum):
    """Códigos de avisos de ingesta que no interrumpen la carga.

    A diferencia de :class:`ErrorCode`, estos avisos no tienen estado HTTP.
    Se incluyen en ``IngestResponse.warnings``; cada uno lleva su
    ``message_key`` derivado con :func:`derive_warning_message_key` para que
    el renderer lo traduzca.
    """

    W_NON_NUMERIC_COLUMNS = "W_NON_NUMERIC_COLUMNS"
    W_ENCODING_REPAIRED = "W_ENCODING_REPAIRED"


#: Estado HTTP de cada código, según la columna HTTP de §5.4.
HTTP_STATUS_BY_CODE: dict[ErrorCode, int] = {
    ErrorCode.E_FILE_EXTENSION: 400,
    ErrorCode.E_EMPTY_FILE: 400,
    ErrorCode.E_MALFORMED_FILE: 400,
    ErrorCode.E_MISSING_VALUES: 400,
    ErrorCode.E_NOT_NUMERIC: 400,
    ErrorCode.E_DUPLICATE_SAMPLES: 409,
    ErrorCode.E_NO_COMMON_SAMPLES: 400,
    ErrorCode.E_BLOCK_ROWS_MISMATCH: 409,
    ErrorCode.E_UNKNOWN_BLOCK: 404,
    ErrorCode.E_UNKNOWN_DATASET: 404,
    ErrorCode.E_JOB_NOT_FOUND: 404,
    ErrorCode.E_MODEL_UNKNOWN: 422,
    ErrorCode.E_TARGET_COLUMN_MISSING: 422,
    ErrorCode.E_TARGET_BLOCK_NOT_ALIGNED: 422,
    ErrorCode.E_R_NOT_AVAILABLE: 503,
    ErrorCode.E_MIXOMICS_NOT_AVAILABLE: 503,
    ErrorCode.E_WORKER_CRASHED: 500,
    ErrorCode.E_ANALYSIS_FAILED: 500,
    ErrorCode.E_UNEXPECTED: 500,
    ErrorCode.E_NOT_IMPLEMENTED: 501,
    ErrorCode.E_UNAUTHORIZED: 401,
}


def derive_message_key(code: str) -> str:
    """Deriva la clave de i18n de un código de error.

    Regla: se quita el prefijo ``E_``, se pasa el resto a minúsculas y se
    une en camelCase; la clave final es ``errors.<camelCase>``.

    Ejemplos: ``E_DUPLICATE_SAMPLES`` → ``errors.duplicateSamples``,
    ``E_R_NOT_AVAILABLE`` → ``errors.rNotAvailable``.
    """
    sufijo = code.removeprefix("E_")
    partes = [parte for parte in sufijo.lower().split("_") if parte]
    if not partes:
        raise ValueError(f"No se puede derivar la clave de i18n del código {code!r}.")
    camel = partes[0] + "".join(parte.capitalize() for parte in partes[1:])
    return f"errors.{camel}"


#: Clave de i18n de cada código, derivada de forma determinística.
MESSAGE_KEY_BY_CODE: dict[ErrorCode, str] = {
    code: derive_message_key(code.value) for code in ErrorCode
}


def derive_warning_message_key(code: WarningCode | str) -> str:
    """Deriva la clave de i18n de un aviso de ingesta.

    Regla: se quita el prefijo ``W_``, se pasa el resto a minúsculas y se
    une en camelCase; la clave final es ``ingest.warnings.<camelCase>``.

    Ejemplos: ``W_NON_NUMERIC_COLUMNS`` →
    ``ingest.warnings.nonNumericColumns`` y ``W_ENCODING_REPAIRED`` →
    ``ingest.warnings.encodingRepaired``.
    """
    codigo = code.value if isinstance(code, WarningCode) else code
    sufijo = codigo.removeprefix("W_")
    partes = [parte for parte in sufijo.lower().split("_") if parte]
    if not partes:
        raise ValueError(f"No se puede derivar la clave de i18n del aviso {code!r}.")
    camel = partes[0] + "".join(parte.capitalize() for parte in partes[1:])
    return f"ingest.warnings.{camel}"


#: Clave de i18n de cada aviso, derivada de forma determinística.
WARNING_MESSAGE_KEY_BY_CODE: dict[WarningCode, str] = {
    code: derive_warning_message_key(code) for code in WarningCode
}


class PythomicsError(Exception):
    """Error del backend con código, clave de i18n y detalle estructurado.

    Es la excepción que lanza la API y el worker; el manejador de errores
    la convierte en el sobre :class:`~app.schemas.ErrorEnvelope` con el
    estado HTTP del código.
    """

    def __init__(
        self,
        code: ErrorCode | str,
        *,
        detail: dict[str, Any] | None = None,
        message_key: str | None = None,
    ) -> None:
        """Crea el error.

        Args:
            code: Código canónico (``ErrorCode`` o su valor en texto).
                Un código desconocido lanza ``ValueError``: es un error de
                programación, no un caso de runtime.
            detail: Datos estructurados del error (archivo, IDs, etc.).
            message_key: Clave de i18n explícita; por defecto se deriva del
                código con :func:`derive_message_key`.
        """
        self.code: ErrorCode = code if isinstance(code, ErrorCode) else ErrorCode(code)
        self.message_key: str = message_key or MESSAGE_KEY_BY_CODE[self.code]
        self.detail: dict[str, Any] = dict(detail or {})
        super().__init__(f"{self.code.value} ({self.message_key})")

    @property
    def http_status(self) -> int:
        """Estado HTTP asociado al código (§5.4)."""
        return HTTP_STATUS_BY_CODE[self.code]

    def to_api_error(self) -> ApiError:
        """Convierte la excepción en el error estructurado de la API."""
        return ApiError(
            code=self.code.value,
            message_key=self.message_key,
            detail=self.detail,
        )

    def to_envelope(self) -> ErrorEnvelope:
        """Convierte la excepción en el sobre de error de la API."""
        return ErrorEnvelope(error=self.to_api_error())


def build_api_error(
    code: ErrorCode | str,
    *,
    detail: dict[str, Any] | None = None,
    message_key: str | None = None,
) -> ApiError:
    """Construye el error estructurado ``code`` + ``message_key`` + ``detail``."""
    resolved: ErrorCode = code if isinstance(code, ErrorCode) else ErrorCode(code)
    return ApiError(
        code=resolved.value,
        message_key=message_key or MESSAGE_KEY_BY_CODE[resolved],
        detail=dict(detail or {}),
    )


def build_error_envelope(
    code: ErrorCode | str,
    *,
    detail: dict[str, Any] | None = None,
    message_key: str | None = None,
) -> ErrorEnvelope:
    """Construye el sobre de error estándar de la API: ``{"error": {...}}``."""
    return ErrorEnvelope(
        error=build_api_error(code, detail=detail, message_key=message_key)
    )
