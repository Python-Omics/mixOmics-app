"""Registro de códigos de error del backend de Pythomics.

El backend **no traduce**. Devuelve ``code`` + ``message_key`` + ``detail``
estructurado, y el renderer formatea el mensaje con ICU contra el catálogo
``frontend/src/i18n/{es,en}.json`` (S22, S28). Ningún mensaje escrito en
español viaja por la API: lo que viaja es un código estable y datos
estructurados que el renderer usa para interpolar sus propios textos.

Convención de ``message_key``: ``errors.<camelCaseDelCodigo>``, derivado
programáticamente del código, por ejemplo:

* ``E_DUPLICATE_SAMPLES`` → ``errors.duplicateSamples``
* ``E_NO_COMMON_SAMPLES`` → ``errors.noCommonSamples``
* ``E_R_NOT_AVAILABLE`` → ``errors.rNotAvailable``

La derivación es determinística: el mismo código produce siempre la misma
clave, sin escribirla a mano. Para agregar un código nuevo basta con
declararlo en :class:`ErrorCode`; la clave de i18n y el estado HTTP se
resuelven solos.
"""

from enum import StrEnum
from typing import Any

from .schemas import ApiError, ErrorEnvelope


class ErrorCode(StrEnum):
    """Códigos de error canónicos del MVP (§5.4 del plan ODD).

    Cada código tiene un estado HTTP asociado en
    :data:`HTTP_STATUS_BY_CODE` y una clave de i18n derivada en
    :data:`MESSAGE_KEY_BY_CODE`.
    """

    # Validación de la carga (RB-14, RF-1)
    E_FILE_EXTENSION = "E_FILE_EXTENSION"
    E_EMPTY_FILE = "E_EMPTY_FILE"
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


#: Estado HTTP de cada código, según la columna HTTP de §5.4.
HTTP_STATUS_BY_CODE: dict[ErrorCode, int] = {
    ErrorCode.E_FILE_EXTENSION: 400,
    ErrorCode.E_EMPTY_FILE: 400,
    ErrorCode.E_NOT_NUMERIC: 400,
    ErrorCode.E_DUPLICATE_SAMPLES: 409,
    ErrorCode.E_NO_COMMON_SAMPLES: 400,
    ErrorCode.E_BLOCK_ROWS_MISMATCH: 409,
    ErrorCode.E_UNKNOWN_BLOCK: 404,
    ErrorCode.E_UNKNOWN_DATASET: 404,
    ErrorCode.E_JOB_NOT_FOUND: 404,
    ErrorCode.E_MODEL_UNKNOWN: 422,
    ErrorCode.E_TARGET_COLUMN_MISSING: 422,
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
