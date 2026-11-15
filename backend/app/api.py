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
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse

from app.auth import TOKEN_HEADER, check_token
from app.capabilities import probe_capabilities_async
from app.datasets import DatasetStore
from app.errors import ErrorCode, PythomicsError
from app.ingest import SUPPORTED_EXTENSIONS, parse_block
from app.jobs import JobManager, JobPaths
from app.paths import resolve_data_dir, resolve_datasets_dir, resolve_jobs_dir
from app.schemas import (
    Alignment,
    AlignmentRequest,
    BlockRef,
    BlockSummary,
    Dataset,
    DatasetBlockInput,
    DatasetCreate,
    DatasetListResponse,
    DatasetSummary,
    DeleteResponse,
    FilesResponse,
    Health,
    IngestResponse,
    Job,
    JobAccepted,
    ModelRequest,
    TargetSpec,
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

# El registro de recetas vive en un subdirectorio del directorio de datos:
# un JSON por receta, con la forma y las decisiones, nunca las matrices.
app.state.DATASET_STORE = DatasetStore(resolve_datasets_dir())

# La cola de jobs es serial y vive en el mismo directorio de datos. El gestor
# solo lanza procesos hijo: este proceso nunca importa pythomics.models.
app.state.JOB_MANAGER = JobManager(resolve_jobs_dir(app.state.DATA_DIR))


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
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
)
def cargar_data(request: Request, file: UploadFile = File(...)) -> IngestResponse:
    """Recibe, guarda y valida un bloque CSV/TSV.

    La extensión se comprueba **antes** de escribir (RB-14). Después se
    guarda el archivo, se valida con :func:`app.ingest.parse_block` y se
    devuelve el resumen y la vista previa. Si la validación falla, el archivo
    inválido se elimina para no dejar basura en el directorio de datos.
    """
    data_dir = request.app.state.DATA_DIR
    nombre_seguro = _nombre_seguro(file.filename)
    extension = Path(nombre_seguro).suffix.lower()

    if extension not in SUPPORTED_EXTENSIONS:
        file.file.close()
        raise PythomicsError(
            ErrorCode.E_FILE_EXTENSION,
            detail={
                "file": nombre_seguro,
                "allowed_extensions": sorted(SUPPORTED_EXTENSIONS),
            },
        )

    ruta_archivo = Path(data_dir) / nombre_seguro

    try:
        with ruta_archivo.open("wb") as buffer_destino:
            shutil.copyfileobj(file.file, buffer_destino)
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"reason": str(exc)},
        ) from exc
    finally:
        file.file.close()

    try:
        parsed = parse_block(ruta_archivo, nombre_seguro)
    except PythomicsError:
        # La carga es una operación de guardado: si el bloque no supera la
        # validación, no debe quedar un archivo que luego se liste como válido.
        try:
            ruta_archivo.unlink(missing_ok=True)
        except OSError:
            # Preservar el error de validación original es más importante que
            # reemplazarlo por un fallo secundario al limpiar el directorio.
            pass
        raise

    return IngestResponse(
        block=BlockSummary(
            name=parsed.name,
            filename=parsed.filename,
            n_samples=parsed.n_samples,
            n_variables=parsed.n_variables,
            n_numeric_variables=parsed.n_numeric_variables,
            columns=parsed.columns,
            sample_id_column=parsed.sample_id_column,
        ),
        warnings=parsed.warnings,
        preview=parsed.preview,
    )


@app.delete(
    "/v1/archivos/",
    response_model=DeleteResponse,
    status_code=status.HTTP_200_OK,
)
def delete_archivos(request: Request, nombre_archivo: str) -> DeleteResponse:
    """Borra un archivo por nombre (va como query param, no como path)."""
    data_dir = request.app.state.DATA_DIR
    nombre_seguro = _nombre_seguro(nombre_archivo)
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


# ------------------------------------------------------------------------------
# Recetas de datos (T4): el dataset como recurso, nunca las matrices
# ------------------------------------------------------------------------------


@app.post(
    "/v1/datasets/",
    response_model=Dataset,
    status_code=status.HTTP_201_CREATED,
)
def crear_dataset(request: Request, payload: DatasetCreate) -> Dataset:
    """Crea una receta de datos: los archivos que componen el análisis.

    El cliente manda **nombres** de archivo, nunca rutas: el backend resuelve
    el archivo dentro de su propio directorio de datos, lo parsea con
    :func:`app.ingest.parse_block` y guarda solo la forma, los IDs de
    muestra y la clasificación por columna. Las matrices no se materializan
    en la API (S29): eso es del worker.

    El **rol** de cada bloque lo declara el cliente (``block`` o
    ``metadata``): no se deduce del dtype (S38).
    """
    data_dir = Path(request.app.state.DATA_DIR)
    store: DatasetStore = request.app.state.DATASET_STORE

    bloques = [
        _construir_bloque(data_dir, entrada) for entrada in payload.blocks
    ]

    target = payload.target
    if target is not None:
        _validar_target(bloques, target)

    return store.create(bloques, target)


@app.get(
    "/v1/datasets/",
    response_model=DatasetListResponse,
    status_code=status.HTTP_200_OK,
)
def listar_datasets(request: Request) -> DatasetListResponse:
    """Lista las recetas guardadas, con un resumen de cada una.

    El listado no arrastra los bloques: solo el identificador, cuantos
    bloques tiene y si ya tiene variable de clase.
    """
    store: DatasetStore = request.app.state.DATASET_STORE
    recetas = store.list()

    return DatasetListResponse(
        datasets=[
            DatasetSummary(
                id=receta.id,
                n_blocks=len(receta.blocks),
                target=receta.target,
            )
            for receta in recetas
        ],
        total=len(recetas),
    )


@app.get(
    "/v1/datasets/{dataset_id}/",
    response_model=Dataset,
    status_code=status.HTTP_200_OK,
)
def obtener_dataset(request: Request, dataset_id: str) -> Dataset:
    """Devuelve la receta completa: bloques, forma, IDs y decisiones."""
    store: DatasetStore = request.app.state.DATASET_STORE
    return store.get(dataset_id)


@app.post(
    "/v1/datasets/{dataset_id}/target/",
    response_model=Dataset,
    status_code=status.HTTP_200_OK,
)
def fijar_target(request: Request, dataset_id: str, target: TargetSpec) -> Dataset:
    """Fija (o cambia) la variable de clase de una receta.

    El bloque del target tiene que ser uno de los bloques de la receta. La
    **columna** no se valida acá: la valida el model request, que es el que
    sabe qué columnas existen (S38).
    """
    store: DatasetStore = request.app.state.DATASET_STORE
    receta = store.get(dataset_id)

    _validar_target(receta.blocks, target)
    receta.target = target

    return store.save(receta)


@app.post(
    "/v1/datasets/{dataset_id}/align/",
    response_model=Alignment,
    status_code=status.HTTP_200_OK,
)
def alinear_dataset(
    request: Request, dataset_id: str, payload: AlignmentRequest
) -> Alignment:
    """Alinea los bloques de una receta **por ID** y no por posición (RB-3).

    La intersección se calcula **desde la receta**: cada bloque ya tiene sus
    IDs de muestra, así que la API no abre ni materializa ninguna matriz
    (S29). El orden canónico es el del **primer bloque seleccionado**, que es
    determinista y es el orden que usa R.

    La decisión queda registrada en la receta: la alineación es auditable, no
    un cálculo silencioso (S29). La operación es **idempotente** (llamar dos
    veces con los mismos bloques da el mismo resultado) y **re-invocable**
    (llamarla con menos bloques realinea).
    """
    store: DatasetStore = request.app.state.DATASET_STORE
    receta = store.get(dataset_id)

    bloques = _bloques_seleccionados(receta, payload.blocks)
    _validar_bloque_del_target(receta, bloques)
    alineacion = _calcular_alineacion(bloques, payload.confirmed)

    receta.alignment = alineacion
    store.save(receta)

    return alineacion


@app.delete(
    "/v1/datasets/{dataset_id}/",
    response_model=DeleteResponse,
    status_code=status.HTTP_200_OK,
)
def borrar_dataset(request: Request, dataset_id: str) -> DeleteResponse:
    """Borra una receta. Los archivos de datos no se tocan."""
    store: DatasetStore = request.app.state.DATASET_STORE
    store.delete(dataset_id)
    return DeleteResponse(mensaje="Dataset eliminado.")


def _nombre_seguro(nombre: str | None) -> str:
    """Reduce un nombre de archivo a su base, igual en Windows y en Linux.

    ``os.path.basename`` solo separa con el separador del sistema: en Linux
    un nombre con barras invertidas (``..\\..\\x.csv``) se tomaría entero y
    quedaría como un archivo raro dentro del directorio de datos. Se
    normalizan las dos familias de separadores para que el resultado sea el
    mismo en cualquier sistema operativo.
    """
    return (nombre or "").replace("\\", "/").rsplit("/", 1)[-1]


def _resolver_bloque(data_dir: Path, nombre: str) -> Path:
    """Resuelve un nombre de archivo dentro del directorio de datos.

    El nombre tiene que ser **un nombre de archivo** del directorio de datos:
    nada de rutas y nada de ``..``. Un nombre que no resuelve a un archivo
    propio es ``E_UNKNOWN_BLOCK``; no se busca fuera del directorio.
    """
    if not nombre or nombre != Path(nombre).name:
        raise PythomicsError(
            ErrorCode.E_UNKNOWN_BLOCK,
            detail={"file": nombre},
        )

    candidato = data_dir / nombre

    try:
        base = data_dir.resolve()
        resuelto = candidato.resolve()
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNKNOWN_BLOCK,
            detail={"file": nombre, "reason": str(exc)},
        ) from exc

    if resuelto != base and base not in resuelto.parents:
        raise PythomicsError(
            ErrorCode.E_UNKNOWN_BLOCK,
            detail={"file": nombre},
        )

    if not candidato.is_file():
        raise PythomicsError(
            ErrorCode.E_UNKNOWN_BLOCK,
            detail={"file": nombre},
        )

    return candidato


def _construir_bloque(data_dir: Path, entrada: DatasetBlockInput) -> BlockRef:
    """Arma la referencia de un bloque a partir del archivo real.

    La forma, los IDs de muestra y la clasificación por columna salen del
    archivo parseado; el rol lo declara el cliente.
    """
    ruta = _resolver_bloque(data_dir, entrada.name)
    parseado = parse_block(ruta, entrada.name)

    return BlockRef(
        name=entrada.name,
        role=entrada.role,
        path=str(ruta),
        n_samples=parseado.n_samples,
        n_variables=parseado.n_variables,
        n_numeric_variables=parseado.n_numeric_variables,
        categorical_columns=list(parseado.categorical_columns),
        sample_ids=list(parseado.sample_ids),
    )


def _validar_target(bloques: list[BlockRef], target: TargetSpec) -> None:
    """Comprueba que el bloque del target sea uno de los bloques de la receta.

    La columna no se valida acá: la validación de la columna y de su tipo
    ocurre en el model request (S38).
    """
    nombres = {bloque.name for bloque in bloques}

    if target.block not in nombres:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={
                "block": target.block,
                "available_blocks": sorted(nombres),
            },
        )


def _bloques_seleccionados(receta: Dataset, nombres: list[str]) -> list[BlockRef]:
    """Devuelve los bloques de la receta pedidos por el cliente, en su orden.

    El orden de la petición importa: el **primer bloque seleccionado** fija el
    orden canónico de las muestras (el que usa R).

    Un nombre que no es un bloque de la receta es ``E_UNKNOWN_BLOCK``: no se
    alinea contra un bloque que no existe. Un nombre repetido se cuenta una
    sola vez.
    """
    por_nombre = {bloque.name: bloque for bloque in receta.blocks}
    elegidos: list[BlockRef] = []
    ya_elegidos: set[str] = set()

    for nombre in nombres:
        bloque = por_nombre.get(nombre)
        if bloque is None:
            raise PythomicsError(
                ErrorCode.E_UNKNOWN_BLOCK,
                detail={
                    "block": nombre,
                    "available_blocks": sorted(por_nombre),
                },
            )
        if nombre in ya_elegidos:
            continue
        ya_elegidos.add(nombre)
        elegidos.append(bloque)

    return elegidos


def _validar_bloque_del_target(receta: Dataset, bloques: list[BlockRef]) -> None:
    """Exige que el bloque de la variable de clase esté en la alineación.

    Si el archivo de phenotypes no se alinea por ID, el vector de clase
    tendría que venir por posición y la clase se asignaría a la muestra
    equivocada: el modelo corre y las métricas no significan nada (S39).

    Solo aplica a las recetas supervisadas: una receta sin variable de clase
    se puede alinar con los bloques que el usuario elija.
    """
    target = receta.target
    if target is None:
        return

    alineados = {bloque.name for bloque in bloques}
    if target.block in alineados:
        return

    raise PythomicsError(
        ErrorCode.E_TARGET_BLOCK_NOT_ALIGNED,
        detail={
            "block": target.block,
            "aligned_blocks": sorted(alineados),
        },
    )


def _calcular_alineacion(
    bloques: list[BlockRef], confirmed: bool
) -> Alignment:
    """Calcula la intersección de IDs y el reporte de descartadas.

    No abre ningún archivo: los IDs de muestra de cada bloque ya están en la
    receta (S29).

    ``bloques`` nunca llega vacío: la petición exige al menos un bloque y un
    nombre que no pertenece a la receta es un error, no un bloque omitido.
    """
    comunes = set(bloques[0].sample_ids)
    for bloque in bloques[1:]:
        comunes &= set(bloque.sample_ids)

    if not comunes:
        raise PythomicsError(
            ErrorCode.E_NO_COMMON_SAMPLES,
            detail={
                "blocks": [bloque.name for bloque in bloques],
                "n_common": 0,
            },
        )

    # Orden canónico: el del primer bloque, filtrado a la intersección.
    muestra_ids = [
        identificador
        for identificador in bloques[0].sample_ids
        if identificador in comunes
    ]

    # Descartadas: lo que le sobra a cada bloque. Todos los bloques
    # alineados aparecen en el diccionario, aunque no descarten nada: la UI
    # muestra el recuento de forma uniforme.
    descartadas = {
        bloque.name: [
            identificador
            for identificador in bloque.sample_ids
            if identificador not in comunes
        ]
        for bloque in bloques
    }

    return Alignment(
        sample_ids=muestra_ids,
        discarded=descartadas,
        confirmed=confirmed,
    )


@app.get(
    "/v1/jobs/{job_id}/",
    response_model=Job,
    status_code=status.HTTP_200_OK,
)
def obtener_job(request: Request, job_id: str) -> Job:
    """Devuelve el estado, el progreso y el resultado de un job.

    El identificador se valida antes de construir la ruta del directorio. Los
    archivos del protocolo se leen en cada consulta, de modo que el resultado
    y el error no dependen solo del estado en memoria.
    """
    manager: JobManager = request.app.state.JOB_MANAGER
    return manager.get(job_id)


@app.delete(
    "/v1/jobs/{job_id}/",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def cancelar_job(request: Request, job_id: str) -> JobAccepted:
    """Cancela un job.

    Si el cálculo ya está corriendo, se mata el proceso hijo. Como R vive
    embebido en ese proceso, no hay que terminar un proceso de R aparte.
    """
    manager: JobManager = request.app.state.JOB_MANAGER
    manager.cancel(job_id)
    return JobAccepted(job_id=job_id)


@app.get("/v1/files/{job_id}/{name}.png")
def obtener_figura(request: Request, job_id: str, name: str) -> FileResponse:
    """Sirve una figura PNG que pertenece al directorio del job.

    El identificador y el nombre se validan antes de resolver la ruta. La
    comprobación final de contención impide que un symlink o un nombre con
    traversal haga salir la lectura del directorio del job.
    """
    manager: JobManager = request.app.state.JOB_MANAGER
    paths = JobPaths.for_job(manager.root, job_id)

    if (
        not name
        or name != Path(name).name
        or "/" in name
        or "\\" in name
    ):
        raise PythomicsError(
            ErrorCode.E_JOB_NOT_FOUND,
            detail={"job_id": job_id, "name": name},
        )

    candidato = paths.directory / f"{name}.png"
    try:
        raiz = manager.root.resolve()
        base = paths.directory.resolve()
        resuelto = candidato.resolve()
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_JOB_NOT_FOUND,
            detail={"job_id": job_id, "name": name, "reason": str(exc)},
        ) from exc

    if (
        base.parent != raiz
        or base not in resuelto.parents
        or not resuelto.is_file()
    ):
        raise PythomicsError(
            ErrorCode.E_JOB_NOT_FOUND,
            detail={"job_id": job_id, "name": name},
        )

    return FileResponse(resuelto, media_type="image/png")


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


@app.post(
    "/v1/model/",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ejecutar_modelo(
    request: Request,
    payload: ModelRequest,
) -> JobAccepted:
    """Acepta un modelo y lo entrega a la cola serial de jobs.

    La API solo valida la receta y crea la especificación del trabajo. La
    materialización de las matrices y el ajuste del modelo ocurren en un
    proceso hijo, que se consulta con ``GET /v1/jobs/{job_id}/``.
    """
    store: DatasetStore = request.app.state.DATASET_STORE
    receta = store.get(payload.dataset_id)
    if payload.target is not None:
        _validar_target(receta.blocks, payload.target)

    capabilities = await probe_capabilities_async()
    if payload.model_type == "DIABLO":
        if not capabilities.r:
            raise PythomicsError(
                ErrorCode.E_R_NOT_AVAILABLE,
                detail={"model_type": payload.model_type},
            )
        if not capabilities.mixomics:
            raise PythomicsError(
                ErrorCode.E_MIXOMICS_NOT_AVAILABLE,
                detail={"model_type": payload.model_type},
            )
    elif not capabilities.pythomics:
        raise PythomicsError(
            ErrorCode.E_R_NOT_AVAILABLE,
            detail={
                "model_type": payload.model_type,
                "capability": "pythomics",
            },
        )

    manager: JobManager = request.app.state.JOB_MANAGER
    job_id = manager.create(receta, payload)
    return JobAccepted(job_id=job_id)


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
