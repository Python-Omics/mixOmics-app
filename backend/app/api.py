"""API local de Pythomics.

Capas:

- El **renderer** nunca habla HTTP con este servidor: todo pasa por el proxy
  del proceso Electron (``window.pyxAPI`` -> ``api:request`` -> fetch a
  ``127.0.0.1:8501``).
- Esta API **valida, orquesta y serializa**. No calcula: el cálculo vive en el
  worker (T7), que es el único proceso que importa ``pythomics`` y R.
- Los errores se devuelven **como código**, nunca como mensaje traducido: el
  renderer resuelve el ``message_key`` contra su catálogo de i18n (S22).

Las formas de request y response viven en :mod:`app.schemas` y los códigos de
error en :mod:`app.errors`.
"""

import os
import shutil

from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse

from app.auth import TOKEN_HEADER, check_token
from app.capabilities import probe_capabilities_async
from app.errors import ErrorCode, PythomicsError
from app.paths import resolve_data_dir
from app.schemas import (
    DeleteResponse,
    FilesResponse,
    Health,
    UploadResponse,
)


async def require_token(
    x_pythomics_token: str | None = Header(default=None, alias=TOKEN_HEADER),
) -> None:
    """Exige el token compartido que envia el proceso Electron.

    CORS cerrado impide que una pagina web **lea** la API, pero no que le
    **escriba**: el navegador manda la peticion y solo bloquea la lectura de
    la respuesta. Sin este token, cualquier pagina abierta por el usuario
    podria subir o pisar los archivos del backend. Ver ``app.auth``.

    Es **async** a proposito: una dependencia sincrona se ejecuta en el
    threadpool de FastAPI, que tiene 40 hilos. Con 40 peticiones
    simultaneas, cada una retiene un hilo y la API entera se congela: hasta
    el endpoint mas rapido se queda sin hilo. Siendo async, la comprobacion
    corre en el event loop y no consume hilo.
    """
    if not check_token(x_pythomics_token):
        raise PythomicsError(ErrorCode.E_UNAUTHORIZED)


app = FastAPI(
    title="API de mixOmics",
    version="1.0.0",
    dependencies=[Depends(require_token)],
)

# ---------------------------------------------------------------------------
# CORS: deliberadamente ausente.
#
# El renderer NUNCA habla HTTP con el backend: todo pasa por el proxy del
# proceso Electron (window.pyxAPI -> api:request -> fetch a 127.0.0.1:8501).
# O sea, no hay ningún consumidor cross-origin legítimo.
#
# Antes había allow_origins=["*"] junto a allow_credentials=True, que además
# de ser innecesario exponía el backend: Starlette refleja el Origin de
# cualquier página que el usuario tenga abierta, y esa página podía leer las
# respuestas de 127.0.0.1:8501 (los archivos cargados y los resultados).
# Con el backend guardando datos del usuario, eso no se deja abierto.
#
# Si alguna vez hace falta acceso desde el navegador, se agrega una lista
# explícita de orígenes — nunca "*".
# ---------------------------------------------------------------------------

# La ruta de datos se resuelve al IMPORTAR el módulo, no en main.py. Así
# `uvicorn app.api:app` arranca con el mismo estado que `python main.py`.
app.state.DATA_DIR = resolve_data_dir()


@app.exception_handler(PythomicsError)
async def pythomics_error_handler(
    request: Request, exc: PythomicsError
) -> JSONResponse:
    """Convierte un error del dominio en el sobre estándar de la API.

    El sobre es ``{"error": {"code", "message_key", "detail"}}``. El renderer
    traduce el ``message_key``; el ``detail`` lleva los datos estructurados
    (archivo, IDs duplicados, cuántas muestras se descartaron).
    """
    return JSONResponse(
        status_code=exc.http_status,
        content=exc.to_envelope().model_dump(),
    )


# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------


@app.get("/v1/health", response_model=Health, status_code=status.HTTP_200_OK)
async def health() -> Health:
    """Estado del backend y capacidades del entorno.

    ``capabilities`` dice qué se puede ejecutar **en esta máquina**: si R o
    mixOmics faltan, la UI deshabilita DIABLO en vez de fallar en seco (S26).

    La sonda corre en un subproceso, con **single-flight**: ante una ráfaga
    de peticiones en cache frío se lanza un solo subproceso, no uno por
    peticion. La espera ocurre en el event loop (el cerrojo es de asyncio),
    asi que las peticiones que esperan no retienen un hilo del threadpool.
    Ver :mod:`app.capabilities`.
    """
    return Health(
        status="ok",
        version="1.0.0",
        data_dir=str(app.state.DATA_DIR),
        capabilities=await probe_capabilities_async(),
    )


@app.get(
    "/v1/archivos/",
    response_model=FilesResponse,
    status_code=status.HTTP_200_OK,
)
def get_archivos(request: Request) -> FilesResponse:
    """Lista los archivos cargados en el backend.

    Es **sincrono**: lee el directorio, y esa E/S bloquea. FastAPI corre los
    endpoints sincronos en su threadpool, que es lo que corresponde.
    """
    data_dir = request.app.state.DATA_DIR

    try:
        elementos = os.listdir(data_dir)
        archivos = [
            nombre
            for nombre in elementos
            if os.path.isfile(os.path.join(data_dir, nombre))
        ]
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"reason": str(exc)},
        ) from exc

    return FilesResponse(archivos=archivos, total=len(archivos), ruta=str(data_dir))


@app.post(
    "/v1/archivos/",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def cargar_data(request: Request, file: UploadFile = File(...)) -> UploadResponse:
    """Recibe un archivo y lo guarda en el directorio de datos.

    Todavía **no valida** la extensión (.csv/.tsv, RB-14) ni los IDs de
    muestra duplicados (RB-1): eso es la ingesta, tarea T3. Acá solo se guarda
    el archivo.
    """
    data_dir = request.app.state.DATA_DIR
    nombre_seguro = os.path.basename(file.filename or "")
    ruta_archivo = os.path.join(data_dir, nombre_seguro)

    try:
        with open(ruta_archivo, "wb") as buffer_destino:
            shutil.copyfileobj(file.file, buffer_destino)
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"reason": str(exc)},
        ) from exc
    finally:
        file.file.close()

    return UploadResponse(mensaje="Archivo subido", nombre=nombre_seguro)


@app.delete(
    "/v1/archivos/",
    response_model=DeleteResponse,
    status_code=status.HTTP_200_OK,
)
def delete_archivos(request: Request, nombre_archivo: str) -> DeleteResponse:
    """Borra un archivo por nombre (va como query param, no como path)."""
    data_dir = request.app.state.DATA_DIR
    nombre_seguro = os.path.basename(nombre_archivo)
    ruta_archivo = os.path.join(data_dir, nombre_seguro)

    if not os.path.exists(ruta_archivo):
        raise PythomicsError(
            ErrorCode.E_UNKNOWN_BLOCK,
            detail={"file": nombre_seguro},
        )

    try:
        os.remove(ruta_archivo)
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"reason": str(exc)},
        ) from exc

    return DeleteResponse(mensaje="Archivo eliminado.")


@app.post("/v1/reporte/", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def crear_reporte() -> None:
    """Genera el reporte PDF.

    Todavía no implementado: la biblioteca expone ``BioReportPDF``, pero exige
    un ``BioAnnotator`` que consulta la red, lo que choca con RB-9 y RNF-S-3.
    """
    raise PythomicsError(
        ErrorCode.E_NOT_IMPLEMENTED,
        detail={"endpoint": "/v1/reporte/"},
    )


@app.post("/v1/model/", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def ejecutar_modelo() -> None:
    """Ejecuta un modelo multivariado.

    Todavía no implementado (T7-T9). El contrato ya está definido: recibe un
    :class:`~app.schemas.ModelRequest` y devuelve ``202`` con un ``job_id``;
    el cálculo corre en el worker y se consulta con ``GET /v1/jobs/{job_id}/``.
    """
    raise PythomicsError(
        ErrorCode.E_NOT_IMPLEMENTED,
        detail={"endpoint": "/v1/model/"},
    )


@app.post("/v1/model_llm/", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def ejecutar_modelo_llm() -> None:
    """Análisis preliminar con un LLM sobre los biomarcadores.

    Todavía no implementado, y fuera del MVP: un LLM externo solo puede
    recibir identificadores genéricos y métricas agregadas, con el
    consentimiento del usuario (RB-9, RNF-S-3).
    """
    raise PythomicsError(
        ErrorCode.E_NOT_IMPLEMENTED,
        detail={"endpoint": "/v1/model_llm/"},
    )
