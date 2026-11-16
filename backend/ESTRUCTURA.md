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

## Figuras

Las figuras se generan **en el worker**, nunca en la API: el proceso de
FastAPI no importa matplotlib ni `pythomics.visualizations` (S30). La etapa
`figures` del pipeline dibuja las figuras que corresponden al modelo.

| Modelo | Figuras | Biblioteca |
|--------|---------|------------|
| PCA | Un **sample plot** por bloque de variables (PC1 contra PC2) | `pythomics.visualizations.plot_pca` |
| DIABLO | Un **loading plot** (las variables con mayor \|loading\| por bloque) y un **círculo de correlaciones** | `pythomics.visualizations.plot_biomarkers` y `plot_circos` |

El sample plot **no** sirve para el DIABLO: `plot_pca` usa `model.variates_`,
que el wrapper de DIABLO no expone (sus variates salen de `transform()`).
El loading plot y el círculo sí usan la API de DIABLO/PLS
(`model.names_`, `model.get_biomarkers`, `model.loadings_`, `model.X_dict_` y
`model.transform`).

| Concepto | Detalle |
|----------|---------|
| Qué figura | El sample plot (PC1 contra PC2) de cada bloque de variables del PCA; el loading plot y el círculo de correlaciones del DIABLO |
| Dónde vive | En el directorio del job, como `<nombre>.png` |
| Cómo se llama | `scores_<bloque>` para el sample plot del PCA; `biomarkers` y `circos` para las figuras del DIABLO. `Figure.name` es el nombre **sin** extensión (es el que se pide en la URL) y `Figure.path` es el archivo relativo al directorio del job |
| Cómo se sirve | `GET /v1/files/{job_id}/{name}.png`, que solo sirve archivos del directorio del job |
| Con variable de clase | El sample plot se colorea por la clase: el frame de metadatos lleva la columna del target, con el índice en los IDs canónicos de muestra. En el círculo, cada clase tiene su color en el anillo de expresión |
| Sin variable de clase | El frame de metadatos va vacío, pero con **una fila por muestra**: la biblioteca concatena los scores con los metadatos, y un número de filas distinto deja filas en blanco en el gráfico |
| Un solo componente | El sample plot del PCA es bidimensional: con un solo componente no se genera figura (queda avisado en el `worker.log`) y el resultado del análisis no se pierde. El DIABLO sí dibuja sus dos figuras con un solo componente |

---

## DIABLO (RF-8)

El DIABLO es el modelo **supervisado** multi-bloque. Se ajusta con
`pythomics.models.DIABLOWrapper`, que llama a `block.splsda` de mixOmics en
R: el resultado **es** el de R, así que la paridad con mixOmics es inherente
y no se mide aparte (L20).

Como el cálculo ocurre en R, la API degrada a `503` antes de encolar cuando
la máquina no tiene R o no tiene el paquete `mixOmics` (S26). Si R falla
**durante** el job, el job queda en `failed` con un error claro
(`E_ANALYSIS_FAILED`) y la salida de R queda en el `worker.log` del job.

| Concepto | Detalle |
|----------|---------|
| Bloques de variables | Solo los bloques con rol `block`. La tabla de phenotypes aporta la clase, no variables |
| Variable de clase | Es obligatoria: sin `target` la solicitud se rechaza con `E_TARGET_COLUMN_MISSING` (422) y no se encola ningún job. La columna tiene que existir en su bloque; si no, el job falla con el mismo código |
| Orden de las muestras | El vector de clase sale del bloque **alineado**, así que viene en el orden canónico de `alignment.sample_ids`: la clase nunca se asigna a la muestra equivocada (S39) |
| Columna de clase | Nunca es una variable del modelo, aunque su bloque tenga rol `block` |
| `design` | Matriz p×p (p = cantidad de bloques). Sin ella se usa el valor predeterminado de mixOmics (ceros en la diagonal y unos en el resto) y se registra en la provenance |
| `keepX` | Lista por bloque, con un valor por componente (la convención de mixOmics). Un bloque desconocido o una lista de otra longitud es un error del request, no un silencio de R |
| Semilla | La semilla pedida o una generada, registrada en la provenance (RB-6) |

### Resultado

| Campo | Contenido |
|-------|-----------|
| `scores` | Los variates de cada bloque: filas = muestras (en el orden canónico), columnas = componentes |
| `loadings` | El peso de cada variable en cada componente, por bloque |
| `biomarkers` | Las variables que el modelo seleccionó en cada bloque y en cada componente (`get_biomarkers`), con su loading |
| `correlations` | Una matriz por par de bloques, con la clave `"bloqueA|bloqueB"`: la correlación entre los variates de A y los de B (una fila por componente de A, una columna por componente de B) |
| `provenance` | Los parámetros efectivos: `model_type`, `estimator`, `center`, `scale`, `n_components`, `preprocessing`, `blocks`, `target`, `design` y `keepX`. Además, la versión de R y la de mixOmics |

---

## Trazabilidad del análisis (provenance)

El resultado trae una `provenance` que permite **repetir y auditar** el
análisis (RB-7, S16, S24). Todo su contenido es JSON.

| Campo | Contenido |
|-------|-----------|
| `pythomics_version` | Versión instalada de la librería (`importlib.metadata`) |
| `seed` | Semilla efectiva: la pedida o la generada y registrada (RB-6) |
| `params` | Parámetros **efectivos** del modelo: `model_type`, `estimator`, `center`, `scale`, `n_components`, `preprocessing`, `blocks` y `target`. En el MVP el preprocesamiento son los valores predeterminados de mixOmics (`center=True`, `scale=False`); el preprocesamiento configurable está diferido. El DIABLO suma `design` y `keepX` |
| `preprocessing` | Receta de preprocesamiento aplicada: vacía en el MVP |
| `r_version` y `mixomics_version` | Versión de R y del paquete mixOmics: solo el DIABLO las informa, porque es el único modelo que corre en R |
| `data_files` | Un registro por archivo de datos que entró al trabajo: nombre, rol (`block` o `metadata`), huella **SHA-256** y tamaño en bytes |
| `data_fingerprint` | SHA-256 que resume todos los archivos, en el orden de la receta. Es igual en dos corridas que usaron los mismos archivos y distinta en cuanto uno cambia |
| `created_at` | Marca de tiempo ISO 8601 |

La huella de los datos es lo que liga un resultado a los archivos **exactos**
que lo produjeron: si el archivo cambia en disco, la huella cambia y se nota
que el resultado es de otra corrida.

---

A futuro se podrían añadir más endpoints, pero puedes utilizar el docs de swagger para ver los endpoints existentes y testear.
