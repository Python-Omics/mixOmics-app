# Backend mixOmics-app

[Universidad de Concepción](https://img.shields.io/badge/Universidad_de_Concepción-UdeC-yellow)]

Esta parte es un ejecutable, lo principal es entender que hace el backend y los endpoints que se utilizan. 
Se piensa dejar esto para que el front sepa que datos entregar y en que formato.

## Endpoints

| Endpoint | Método |Descripción |
|----------|--------|------------|
|`/v1/health`| GET | Enpoint para comprobar conexión|
|`/v1/archivos/`| GET | Endpoint para listar archivos subidos|
|`/v1/reporte/`| POST | Endpoint para generar reportes|
|`/v1/cargar/`| POST | Endpoint para cargar archivos|
|`/v1/model/`| POST | Endpoint para encolar un análisis y recibir su `job_id`|
|`/v1/jobs/{job_id}/`| GET | Endpoint para consultar el estado, el progreso y el resultado de un job|
|`/v1/jobs/{job_id}/`| DELETE | Endpoint para cancelar un job y terminar su proceso hijo|
|`/v1/files/{job_id}/{name}.png`| GET | Endpoint para servir una figura generada por un job|
|`/v1/model_llm/`| POST | Endpoint para obtener un análisis preliminar de los datos con LLM a través de biomarcadores|
|`/v1/archivos/`| DELETE | Endpoint para borrar archivos|
|`/v1/datasets/`| POST | Endpoint para crear una receta de datos (bloques y variable de clase)|
|`/v1/datasets/`| GET | Endpoint para listar las recetas guardadas|
|`/v1/datasets/{dataset_id}/`| GET | Endpoint para obtener una receta de datos|
|`/v1/datasets/{dataset_id}/target/`| POST | Endpoint para fijar (o cambiar) la variable de clase de una receta|
|`/v1/datasets/{dataset_id}/align/`| POST | Endpoint para alinear los bloques de una receta por ID de muestra (RF-2)|
|`/v1/datasets/{dataset_id}/`| DELETE | Endpoint para borrar una receta de datos|

---

## Recetas de datos (datasets)

Un dataset es una **receta**, nunca las matrices: el backend guarda las rutas de
los archivos, su forma, los IDs de muestra, la clasificación de columnas
(numéricas o categóricas) y las decisiones tomadas (variable de clase). Las
matrices crudas no se materializan en la API; el worker es el único que las
carga.

| Concepto | Detalle |
|----------|---------|
| Identificador | `ds_` + 12 hexadecimales (`ds_a1b2c3d4e5f6`). Se valida con un patrón estricto **antes** de construir cualquier ruta: un identificador con otro formato nunca llega al disco |
| Persistencia | Un JSON por receta en `<data_dir>/datasets/<id>.json`, escrito de forma atómica (a un `.tmp` y luego renombrado) |
| Bloques | El cliente manda el **nombre** del archivo, nunca la ruta. El backend resuelve el nombre dentro de su propio directorio de datos y lo parsea con la misma validación de la ingesta |
| Rol del bloque | Lo declara el cliente (`block` o `metadata`); no se deduce del tipo de las columnas |
| Variable de clase | `target` = bloque + columna. En la alta se comprueba que el bloque sea uno de la receta; la columna se valida en la solicitud de modelo |
| Errores | `E_UNKNOWN_BLOCK` (404) si el nombre no resuelve a un archivo propio, `E_UNKNOWN_DATASET` (404) si la receta no existe, `E_TARGET_COLUMN_MISSING` (422) si el bloque del target no está en la receta |

---

## Alineación multi-bloque (RF-2)

`POST /v1/datasets/{dataset_id}/align/` alinea los bloques de una receta **por
ID de muestra y no por posición** (RB-3). La alineación es una **decisión
auditable**: queda registrada en la receta (`alignment`), no es un cálculo
silencioso.

**No materializa matrices.** La intersección se calcula desde la receta: cada
bloque ya tiene sus IDs de muestra, así que la API no abre ningún archivo
(S29). El worker es el único que carga los datos.

| Concepto | Detalle |
|----------|---------|
| Solicitud | `{"blocks": ["gene.csv", "lipid.csv"], "confirmed": true}`. `blocks` es la lista de nombres de los bloques a alinear, en orden, con al menos un elemento |
| Conjunto alineado | Los IDs de muestra presentes en **todos** los bloques seleccionados (intersección) |
| Orden canónico | El del **primer bloque seleccionado**, filtrado a la intersección. Es determinista y es el orden que usa R, así que la paridad numérica no depende del orden de los archivos |
| Descartes | Por bloque, los IDs que ese bloque tiene y que no están en la intersección. **Todos** los bloques alineados aparecen en el diccionario, aunque su lista esté vacía, para que la UI muestre el recuento de forma uniforme |
| Confirmación | `confirmed` registra si el usuario confirmó la alineación. Queda en la receta |
| Idempotencia | Llamarlo dos veces con los mismos bloques da el mismo resultado |
| Re-invocación | Llamarlo con menos bloques realinea: la intersección se recalcula con los bloques de la nueva llamada |
| Errores | `E_UNKNOWN_BLOCK` (404) si un nombre no es un bloque de la receta, `E_NO_COMMON_SAMPLES` (400) si la intersección queda vacía, `E_TARGET_BLOCK_NOT_ALIGNED` (422) si la receta tiene variable de clase y su bloque no está entre los alineados, `E_UNKNOWN_DATASET` (404) si la receta no existe |

**El bloque de la variable de clase tiene que estar alineado (S39).** Si el
archivo de phenotypes no se alinea por ID, el vector de clase tendría que
venir por posición y la clase se asignaría a la muestra equivocada: el modelo
corre y las métricas no significan nada. El backend lo rechaza con
`E_TARGET_BLOCK_NOT_ALIGNED` en vez de dejar pasar el error silencioso.

Respuesta (`Alignment`):

```json
{
  "sample_ids": ["S01", "S02", "..."],
  "discarded": {"gene.csv": ["S37"], "lipid.csv": ["S41", "S42"], "meta.csv": []},
  "confirmed": true
}
```

---

## Jobs y worker

`POST /v1/model/` recibe un `ModelRequest` y responde `202` con
`{"job_id": "job_<12 hex>"}`. El cálculo se ejecuta en un **proceso hijo**:
`python -m app.worker <spec.json>`, lanzado con el mismo intérprete de Python
que corre la API y con `backend/` como directorio de trabajo.

La cola es **serial**: solo un análisis se ejecuta a la vez. Los demás jobs
permanecen en `queued`, lo que evita multiplicar el pico de memoria y respeta
el límite de 4 GB. Los estados son `queued`, `running`, `completed`, `failed`
y `cancelled`.

| Endpoint | Comportamiento |
|----------|----------------|
| `POST /v1/model/` | Valida la receta, crea el directorio del job y encola el trabajo. Si el modelo necesita una dependencia que no está disponible, responde `503` con el sobre de error uniforme |
| `GET /v1/jobs/{job_id}/` | Devuelve el `Job` con estado, progreso, resultado y error. Lee `progress.json`, `result.json` y `error.json` del disco |
| `DELETE /v1/jobs/{job_id}/` | Responde `202`. Si el proceso hijo está corriendo, lo termina; R queda incluido en ese mismo proceso |
| `GET /v1/files/{job_id}/{name}.png` | Sirve un PNG contenido en el directorio del job. El identificador y el nombre se validan antes de resolver la ruta |

El proceso de la API **nunca importa `pythomics.models` ni `rpy2`**. La
disponibilidad se comprueba en un subproceso separado y el cálculo que carga
la biblioteca analítica ocurre únicamente en el worker hijo.

### Protocolo de archivos

Cada job vive en `<DATA_DIR>/jobs/<job_id>/`. El identificador tiene un
formato estricto (`job_` más 12 hexadecimales) y se valida antes de
construir cualquier ruta.

| Archivo | Contenido |
|---------|-----------|
| `spec.json` | Especificación completa: identificadores, receta, bloques, alineación, target, modelo y rutas de salida. Es legible para depurar el trabajo |
| `progress.json` | Etapa actual (`load`, `align`, `preprocess`, `fit`, `transform` o `figures`), índice base 0 y total de 6 etapas. Se reescribe de forma atómica |
| `result.json` | Resultado serializable del análisis |
| `error.json` | Error estructurado cuando el trabajo falla |
| `worker.log` | Salida estándar y de error del proceso hijo |

El preprocesamiento queda fuera del MVP: la etapa `preprocess` deja
constancia, pero no transforma los datos. `NipalsPCA` conserva sus valores
predeterminados (`center=True`, `scale=False`).

---

A futuro se podrían añadir más endpoints, pero puedes utilizar el docs de swagger para ver los endpoints existentes y testear.
