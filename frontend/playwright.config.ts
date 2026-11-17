import { defineConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Alignment,
  ApiCallRecord,
  ApiResponse,
  Dataset,
  DatasetBlockInput,
  FigurePayload,
  Job,
  JobError,
  ModelResult,
  ProgressStage,
  PyxAPI,
  TargetSpec,
  UploadResponse,
} from './src/lib/types';

/**
 * Mock del preload de Electron para los tests E2E en browser.
 *
 * `window.pyxAPI` queda disponible con respuestas deterministas: la subida
 * devuelve un resumen de ingesta exitoso, la receta de datos responde como
 * el backend (receta → alineación → target → job) y el job avanza por las
 * etapas del pipeline en cada consulta de polling. Cada llamada queda
 * registrada en `window.__apiCalls` para que los tests puedan verificar
 * contra qué rutas pega el frontend.
 *
 * OJO: Playwright NO tiene `addInitScript` como opción de `use` (la opción
 * se ignora en silencio y el mock nunca llegaba al browser). Por eso la
 * función se exporta y se inyecta por página con `page.addInitScript(...)`
 * desde el `beforeEach` del spec.
 *
 * OJO: la función se SERIALIZA y se evalúa dentro del browser: no puede
 * referenciar constantes del módulo (se rompería con "X is not defined").
 * Por eso todo lo que usa vive dentro de `installApiMock`.
 */
export type InstallApiMockOptions = {
  /** Respuesta alternativa para la subida, usada por tests de error/warning. */
  uploadResponse?: ApiResponse<unknown>;
  /**
   * Overrides del resumen del bloque en la respuesta por defecto de la
   * subida.
   *
   * Permite simular un bloque con columnas no numéricas (por ejemplo
   * `{ n_variables: 4, n_numeric_variables: 3, columns: [...] }`) sin
   * duplicar el mock.
   */
  block?: Partial<UploadResponse['block']>;
  /** Respuesta alternativa de `POST /v1/datasets/`. */
  datasetResponse?: ApiResponse<unknown>;
  /** Respuesta alternativa de `POST /v1/datasets/{id}/align/`. */
  alignResponse?: ApiResponse<unknown>;
  /** Respuesta alternativa de `POST /v1/datasets/{id}/target/`. */
  targetResponse?: ApiResponse<unknown>;
  /** Respuesta alternativa de `POST /v1/model/`. */
  modelResponse?: ApiResponse<unknown>;
  /**
   * Etapas por las que pasa el job, una por consulta de polling.
   *
   * Terminado el ciclo, el job pasa a `completed` con el resultado. Con una
   * sola etapa, el job termina en la segunda consulta: los tests que no
   * necesitan ver el progreso van rápido.
   */
  jobStages?: ProgressStage[];
  /** Si viene, el job termina en `failed` con ese error. */
  jobError?: JobError;
  /** Figura que devuelve el canal `api:file`. */
  figure?: FigurePayload;
};

/**
 * Identificadores fijos del mock: los tests los assertan.
 *
 * Los valores están repetidos dentro de `installApiMock` porque la función
 * se serializa al browser y no puede leer el módulo.
 */
export const MOCK_DATASET_ID = 'ds_mock000001';
export const MOCK_JOB_ID = 'job_mock000001';

/**
 * Registro de una respuesta que sirvió el mock.
 *
 * El test de costura (el contrato compartido con el backend real) compara
 * estas respuestas con las que declara `backend/tests/contract.json`: si el
 * mock deja de servir la forma que el renderer lee, el contrato y el backend
 * real se separan y el test falla.
 */
export type ApiResponseRecord = {
  method: string;
  path: string;
  status: number;
  data?: unknown;
};

export function installApiMock(options: InstallApiMockOptions = {}) {
  /** PNG de 16×16 que devuelve el canal de figuras por defecto. */
  const FIGURE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOQq4giCTGMahjVMHw1AABckfAByYZiHQAAAABJRU5ErkJggg==';
  const DATASET_ID = 'ds_mock000001';
  const JOB_ID = 'job_mock000001';

  /** Ruta de la receta: `POST /v1/datasets/`. */
  const DATASETS_PATH = '/v1/datasets/';
  /** Ruta de la alineación: `POST /v1/datasets/{id}/align/`. */
  const ALIGN_PATH = /^\/v1\/datasets\/[^/]+\/align\/$/;
  /** Ruta del target: `POST /v1/datasets/{id}/target/`. */
  const TARGET_PATH = /^\/v1\/datasets\/[^/]+\/target\/$/;
  /** Ruta de una receta: `GET /v1/datasets/{id}/`. */
  const DATASET_PATH = /^\/v1\/datasets\/[^/]+\/$/;
  /** Ruta de un job: `GET|DELETE /v1/jobs/{id}/`. */
  const JOB_PATH = /^\/v1\/jobs\/[^/]+\/$/;

  /** Etapas por defecto: el ciclo completo del pipeline. */
  const DEFAULT_JOB_STAGES: ProgressStage[] = [
    'queued',
    'load',
    'align',
    'preprocess',
    'fit',
    'transform',
    'figures',
  ];

  /** Arma una respuesta OK con el cuerpo del backend. */
  function ok<T>(status: number, data: T): ApiResponse<T> {
    return { ok: true, status, data };
  }

  /**
   * Reinterpreta una respuesta concreta como la respuesta genérica que
   * declara el puente IPC (`ApiResponse<T>` con `T` sin resolver).
   */
  function asResponse<T>(res: ApiResponse<unknown>): ApiResponse<T> {
    return res as ApiResponse<T>;
  }

  const w = window as unknown as {
    pyxAPI: PyxAPI;
    __apiCalls?: ApiCallRecord[];
    __apiResponses?: ApiResponseRecord[];
    __fileTextCalled?: boolean;
  };
  const mockStatus = {
    running: false,
    port: 8501,
    logPath: null,
    startError: null,
  };
  // Registro de llamadas al backend (lo consultan los tests).
  const calls: ApiCallRecord[] = [];
  w.__apiCalls = calls;
  // Registro de las respuestas que sirvió el mock (lo consulta el test de
  // costura: las compara con el contrato compartido con el backend real).
  const responses: ApiResponseRecord[] = [];
  w.__apiResponses = responses;
  w.__fileTextCalled = false;

  /**
   * Registra la respuesta que el mock acaba de servir.
   *
   * Se registra el cuerpo tal como lo ve el renderer: es el mismo que
   * comparan los tests con el contrato compartido.
   */
  function registrar(method: string, path: string, res: ApiResponse<unknown>) {
    responses.push({ method, path, status: res.status, data: res.data });
  }

  const originalText = File.prototype.text;
  File.prototype.text = function () {
    w.__fileTextCalled = true;
    return originalText.call(this);
  };

  /** Resúmenes de ingesta, por nombre de archivo. */
  const uploaded = new Map<string, UploadResponse['block']>();
  /** Receta creada (o recuperada) en el mock. */
  let dataset: Dataset | null = null;
  /** Variable de clase fijada en la receta. */
  let target: TargetSpec | null = null;
  /** Etapa del job en la que está el polling. */
  let poll = 0;
  /** Si el job fue cancelado con `DELETE /v1/jobs/{id}/`. */
  let cancelled = false;

  /**
   * IDs de muestra de un bloque simulado.
   *
   * El primer bloque tiene dos muestras y el resto una: la intersección
   * deja una muestra en común y una descartada, así la sección de
   * alineación tiene algo real que mostrar.
   */
  function sampleIdsFor(index: number): string[] {
    return index === 0 ? ['S1', 'S2'] : ['S1'];
  }

  /** Construye la receta a partir de los bloques que pide el cliente. */
  function buildDataset(blocks: DatasetBlockInput[]): Dataset {
    return {
      id: DATASET_ID,
      blocks: blocks.map((bloque, index) => {
        const resumen = uploaded.get(bloque.name);
        return {
          name: bloque.name,
          role: bloque.role,
          path: bloque.name,
          n_samples: resumen?.n_samples ?? 2,
          n_variables: resumen?.n_variables ?? 1,
          n_numeric_variables: resumen?.n_numeric_variables ?? 1,
          categorical_columns: [],
          sample_ids: sampleIdsFor(index),
        };
      }),
      alignment: null,
      preprocessing: [],
      target,
    };
  }

  /** Resultado del análisis que devuelve el job terminado. */
  function buildResult(): ModelResult {
    const bloques = dataset?.blocks ?? [];
    const nombres = bloques.map((b) => b.name);
    const primerBloque = nombres[0] ?? 'demo.csv';
    const correlaciones: Record<string, number[][]> = {};
    if (nombres.length >= 2) {
      correlaciones[`${nombres[0]}|${nombres[1]}`] = [
        [0.87, 0.23],
        [0.05, 0.56],
      ];
    }
    return {
      model_type: 'PCA',
      blocks: nombres,
      n_components: 2,
      explained_variance_ratio: [0.61, 0.24],
      scores: { [primerBloque]: [[0.12, -0.3], [0.4, 0.2]] },
      loadings: {
        [primerBloque]: [
          { variable_id: 'feature_1', loading: 0.42, component: 1 },
        ],
      },
      biomarkers: [
        {
          variable_id: 'feature_1',
          loading: 0.42,
          // El backend manda `stability: null` cuando el modelo no la
          // reporta: la UI tiene que tratarla como ausente.
          stability: null as unknown as undefined,
          component: 1,
          block: primerBloque,
        },
        {
          variable_id: 'feature_2',
          loading: 0.31,
          stability: 0.87,
          component: 1,
          block: primerBloque,
        },
      ],
      correlations: correlaciones,
      figures: [
        {
          kind: 'pca',
          path: 'scores_demo.png',
          name: 'scores_demo',
          mime: 'image/png',
          width: 1069,
          height: 870,
        },
      ],
      provenance: {
        pythomics_version: '0.1.0a1',
        r_version: null,
        mixomics_version: null,
        seed: 42,
        peak_rss_mb: 512,
        params: { model_type: 'PCA', n_components: 2, center: true },
        preprocessing: [],
        data_files: [
          {
            name: primerBloque,
            role: 'block',
            sha256: 'a'.repeat(64),
            size_bytes: 128,
          },
        ],
        data_fingerprint: 'b'.repeat(64),
        created_at: '2025-01-01T00:00:00Z',
      },
    };
  }

  /** Estado del job para la consulta de polling número `poll`. */
  function buildJob(): Job {
    if (cancelled) {
      return {
        job_id: JOB_ID,
        status: 'cancelled',
        progress: null,
        result: null,
        error: null,
      };
    }
    if (options.jobError) {
      return {
        job_id: JOB_ID,
        status: 'failed',
        progress: null,
        result: null,
        error: options.jobError,
      };
    }

    const etapas = options.jobStages ?? DEFAULT_JOB_STAGES;
    const indice = poll;
    poll += 1;

    if (indice < etapas.length) {
      const stage = etapas[indice];
      return {
        job_id: JOB_ID,
        status: stage === 'queued' ? 'queued' : 'running',
        progress: { stage, index: indice, total: etapas.length },
        result: null,
        error: null,
      };
    }

    return {
      job_id: JOB_ID,
      status: 'completed',
      progress: { stage: 'figures', index: etapas.length, total: etapas.length },
      result: buildResult(),
      error: null,
    };
  }

  /** Respuesta del GET, según la ruta. */
  function responderGet(path: string): ApiResponse<unknown> {
    if (DATASET_PATH.test(path)) {
      return dataset
        ? ok(200, dataset)
        : { ok: false, status: 404, error: 'dataset no encontrado' };
    }
    if (JOB_PATH.test(path)) {
      return ok(200, buildJob());
    }
    return { ok: false, status: 0, error: 'no backend in test' };
  }

  /** Respuesta del POST, según la ruta. */
  function responderPost(path: string, body?: unknown): ApiResponse<unknown> {
    if (path === DATASETS_PATH) {
      if (options.datasetResponse) {
        return options.datasetResponse;
      }
      const bloques = (body as { blocks?: DatasetBlockInput[] })?.blocks ?? [];
      dataset = buildDataset(bloques);
      return ok(201, dataset);
    }
    if (ALIGN_PATH.test(path)) {
      if (options.alignResponse) {
        return options.alignResponse;
      }
      const confirmado =
        (body as { confirmed?: boolean } | undefined)?.confirmed === true;
      const nombres = (dataset?.blocks ?? []).map((b) => b.name);
      const discarded: Record<string, string[]> = {};
      nombres.forEach((nombre, index) => {
        discarded[nombre] = index === 0 ? [] : ['S2'];
      });
      const alignment: Alignment = {
        sample_ids: ['S1'],
        discarded,
        confirmed: confirmado,
      };
      if (dataset) dataset.alignment = alignment;
      return ok(200, alignment);
    }
    if (TARGET_PATH.test(path)) {
      if (options.targetResponse) {
        return options.targetResponse;
      }
      target = (body ?? null) as TargetSpec | null;
      if (dataset) dataset = { ...dataset, target };
      return dataset
        ? ok(200, dataset)
        : { ok: false, status: 404, error: 'dataset no encontrado' };
    }
    if (path === '/v1/model/') {
      if (options.modelResponse) {
        return options.modelResponse;
      }
      return ok(202, { job_id: JOB_ID });
    }
    return { ok: false, status: 0, error: 'no backend in test' };
  }

  /** Respuesta del DELETE, según la ruta. */
  function responderDelete(path: string): ApiResponse<unknown> {
    if (JOB_PATH.test(path)) {
      cancelled = true;
      return ok(202, { job_id: JOB_ID });
    }
    return { ok: false, status: 0, error: 'no backend in test' };
  }

  /** Respuesta de la subida multipart: el backend espera el campo `file`. */
  function responderUpload(filename: string): ApiResponse<unknown> {
    if (options.uploadResponse) {
      return options.uploadResponse;
    }
    // El bloque por defecto tiene una sola variable, numérica. Los tests
    // pueden reconfigurarlo (por ejemplo, con columnas no numéricas).
    const overrides = options.block ?? {};
    const block: UploadResponse['block'] = {
      name: overrides.name ?? filename,
      filename: overrides.filename ?? filename,
      n_samples: overrides.n_samples ?? 2,
      n_variables: overrides.n_variables ?? 1,
      n_numeric_variables: overrides.n_numeric_variables ?? 1,
      columns: overrides.columns ?? ['feature_1'],
      sample_id_column: overrides.sample_id_column ?? 'sample_id',
    };
    uploaded.set(block.filename, block);
    return {
      ok: true,
      status: 201,
      data: {
        block,
        warnings: [],
        preview: {
          columns: ['sample_id', 'feature_1'],
          rows: [
            ['S1', '1.0'],
            ['S2', '2.0'],
          ],
        },
      } satisfies UploadResponse,
    };
  }

  w.pyxAPI = {
    getBackendStatus: () => Promise.resolve(mockStatus),
    restartBackend: () => Promise.resolve({ ok: false, error: 'mock' }),
    getPathForFile: (file: File) => `/tmp/pythomics-mock/${file.name}`,
    api: {
      request: <T = unknown>(method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        const respuesta: ApiResponse<unknown> = {
          ok: false,
          status: 0,
          error: 'no backend in test',
        };
        registrar(method, path, respuesta);
        return Promise.resolve(asResponse<T>(respuesta));
      },
      get: <T = unknown>(path: string) => {
        calls.push({ method: 'GET', path });
        const respuesta = responderGet(path);
        registrar('GET', path, respuesta);
        return Promise.resolve(asResponse<T>(respuesta));
      },
      post: <T = unknown>(path: string, body?: unknown) => {
        calls.push({ method: 'POST', path, body });
        const respuesta = responderPost(path, body);
        registrar('POST', path, respuesta);
        return Promise.resolve(asResponse<T>(respuesta));
      },
      delete: <T = unknown>(path: string) => {
        calls.push({ method: 'DELETE', path });
        const respuesta = responderDelete(path);
        registrar('DELETE', path, respuesta);
        return Promise.resolve(asResponse<T>(respuesta));
      },
      // Subida multipart: el backend espera el campo `file`.
      upload: (sourcePath: string, filename: string, content?: string) => {
        calls.push({
          method: 'POST',
          path: '/v1/archivos/',
          filename,
          sourcePath,
          content,
        });
        const respuesta = responderUpload(filename);
        registrar('POST', '/v1/archivos/', respuesta);
        return Promise.resolve(
          respuesta,
        ) as Promise<ApiResponse<UploadResponse>>;
      },
      // Canal de figuras: el renderer arma el `blob:` URL con este base64.
      getFigure: (jobId: string, name: string) => {
        calls.push({ method: 'GET', path: `/v1/files/${jobId}/${name}.png` });
        return Promise.resolve(
          ok(200, options.figure ?? { mime: 'image/png', dataBase64: FIGURE_BASE64 }),
        );
      },
    },
    onBackendLog: () => () => {},
    onBackendExit: () => () => {},
    onBackendError: () => () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA DEL RENDERER (V8, vía el protocolo de DevTools)
// ─────────────────────────────────────────────────────────────────────────────
//
// Los E2E de Playwright miden la cobertura del renderer con la API de V8
// (`page.coverage`), pero ese hook exige un FIXTURE que envuelva a la
// página y los specs importan `test` de '@playwright/test': para usarlo
// habría que tocar `tests/e2e/*.spec.ts` (y el mock `installApiMock` que
// ellos importan desde este archivo).
//
// Lo que SÍ se puede, sin tocar un solo test, es hablarle al navegador por
// el protocolo de DevTools (CDP) desde un REPORTER: es la misma API que usa
// `page.coverage` por debajo (`Profiler.startPreciseCoverage`), pero desde
// el otro lado del cable.
//
// El reporter se apoya en tres cosas:
//
//   1. `--remote-debugging-port`: Playwright lanza Chromium con un pipe
//      privado; el puerto abre además la API HTTP/CDP del navegador.
//   2. `Target.setAutoAttach` con `waitForDebuggerOnStart`: las páginas
//      nuevas quedan EN PAUSA hasta que el reporter active el profiler, así
//      que no se pierde el script inicial de cada test.
//   3. `Profiler.takePreciseCoverage`: los contadores de V8. Cada `take` los
//      reinicia, así que hay que SUMAR las consultas.
//
// Lo que se mide es el código que el dev server de Vite sirve (`/src/**`),
// con sus source maps: los offsets de V8 se traducen a líneas del archivo
// original (.tsx/.ts), no del JavaScript transpilado.
//
// Se activa con `PW_COVERAGE=1` (ver el script `npm run test:coverage`).

/** ¿Se pidió medir la cobertura? */
const COVERAGE_ENABLED = process.env.PW_COVERAGE === '1';

/** Puerto del endpoint de DevTools que abre Chromium para el reporter. */
const COVERAGE_CDP_PORT = Number(
  process.env.PW_COVERAGE_CDP_PORT ?? '9333',
);

/** Prefijo de las rutas del dev server que se consideran código de la app. */
const COVERAGE_SOURCE_PREFIX = '/src/';

/** Extensiones que se cuentan como código (el resto son datos: JSON, CSS). */
const COVERAGE_CODE_EXTENSIONS = ['.ts', '.tsx'];

/** Rango de cobertura de V8. */
type V8Range = {
  startOffset: number;
  endOffset: number;
  count: number;
};

/** Función de un script, con sus rangos. */
type V8Function = {
  functionName: string;
  ranges: V8Range[];
};

/** Script cargado por la página. */
type V8Script = {
  scriptId: string;
  url: string;
  functions: V8Function[];
};

/** Cobertura de un script, acumulada entre varias consultas. */
type ScriptCoverage = {
  url: string;
  /** Rangos acumulados, por clave `inicio-fin`. */
  ranges: Map<string, V8Range>;
};

/** Cobertura de un archivo del proyecto, ya en líneas originales. */
type FileCoverage = {
  path: string;
  /** Líneas del archivo original y cuántas veces se ejecutaron. */
  lines: Map<number, number>;
};

/**
 * Cliente mínimo del protocolo de DevTools sobre WebSocket.
 *
 * Solo lo que hace falta: enviar comandos con id y resolver las respuestas
 * por id, y recibir los eventos. Las sesiones aplanadas (`flatten: true`)
 * viajan en el mismo socket, con el `sessionId` en el mensaje.
 */
class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  private readonly handlers: ((message: any) => void)[] = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(JSON.stringify(message.error)));
        } else {
          waiter.resolve(message.result);
        }
        return;
      }
      for (const handler of this.handlers) handler(message);
    });
  }

  /** Espera a que el socket esté abierto. */
  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', () =>
        reject(new Error('No se pudo abrir el socket de DevTools')),
      );
    });
  }

  /** Registra un listener de eventos. */
  on(handler: (message: any) => void): void {
    this.handlers.push(handler);
  }

  /** Envía un comando y espera su respuesta. */
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> {
    const id = ++this.nextId;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  /** Cierra el socket. */
  close(): void {
    try {
      this.socket.close();
    } catch {
      // si ya estaba cerrado, no hay nada que hacer
    }
  }
}

/** Alfabeto base64 de la.source map (VLQ). */
const VL64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Suelta un timer para que no mantenga vivo el proceso.
 *
 * En Node el `setInterval` devuelve un `Timeout` con `unref()`; en el
 * navegador (o en un tipo que no lo tenga) no hace nada.
 */
function unref(timer: unknown): void {
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

/** Decodifica un segmento VLQ de source map. */
function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = VL64.indexOf(char);
    if (digit < 0) continue;
    const continues = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continues) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Traduce las líneas generadas (0-based) a las líneas originales (0-based).
 *
 * De cada línea generada se toma el PRIMER segmento con información de
 * origen: alcanza para el mapa a nivel de línea, que es lo que se reporta.
 */
function decodeSourceMapLines(mappings: string): (number | null)[] {
  const result: (number | null)[] = [];
  let originalLine = 0;
  for (const lineText of mappings.split(';')) {
    let first: number | null = null;
    for (const segment of lineText.split(',')) {
      if (!segment) continue;
      const fields = decodeVlq(segment);
      if (fields.length < 4) continue;
      originalLine += fields[2];
      if (first === null) first = originalLine;
    }
    result.push(first);
  }
  return result;
}

/** Offset de inicio de cada línea de un texto. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Índice de la línea que contiene un offset (búsqueda binaria). */
function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Convierte la cobertura acumulada de un script en líneas del archivo
 * original.
 *
 * `served` es el JavaScript que sirve el dev server y `mapLines` el mapa de
 * líneas originales. Sin source map (`mapLines` nulo) se usa el archivo
 * servido tal cual (identity mapping).
 */
function toFileCoverage(
  served: string,
  mapLines: (number | null)[] | null,
  originalPath: string,
  ranges: V8Range[],
): FileCoverage {
  const starts = lineStarts(served);
  // De más interno a más externo: el rango con inicio mayor que contiene el
  // offset es el que manda (V8 anida los rangos).
  const ordered = [...ranges].sort((a, b) => b.startOffset - a.startOffset);

  const generatedHits = new Map<number, number>();
  for (let line = 0; line < starts.length; line += 1) {
    const offset = starts[line];
    let count = 0;
    for (const range of ordered) {
      if (range.startOffset <= offset && offset < range.endOffset) {
        count = range.count;
        break;
      }
    }
    generatedHits.set(line, count);
  }

  const lines = new Map<number, number>();
  if (mapLines) {
    for (const [generated, count] of generatedHits) {
      const original = mapLines[generated];
      if (original === undefined || original === null) continue;
      const previous = lines.get(original);
      if (previous === undefined || count > previous) lines.set(original, count);
    }
  } else {
    for (const [generated, count] of generatedHits) lines.set(generated, count);
  }

  return { path: originalPath, lines };
}

/**
 * Recolector de cobertura del renderer.
 *
 * Habla CDP con el Chromium que lanza Playwright, activa el profiler de V8
 * en cada página y va sumando los contadores. Al terminar, traduce los
 * offsets a líneas originales (con los source maps del dev server) y
 * escribe el reporte.
 */
class RendererCoverage {
  private client: CdpClient | null = null;
  private readonly sessions = new Set<string>();
  private readonly scripts = new Map<string, ScriptCoverage>();
  /** Fuente servida y su source map, por URL. */
  private readonly sources = new Map<
    string,
    { text: string; mapLines: (number | null)[] | null; originalPath: string }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private harvesting = false;
  private lastReport = 0;
  private statAttach = 0;
  private statHarvest = 0;
  private statOk = 0;
  private statScripts = 0;
  private statDead = 0;

  /** Arranca el sondeo del navegador y la recolección periódica. */
  start(): void {
    void this.connect();
    this.timer = setInterval(() => {
      void this.harvest();
    }, 150);
    // El reporte se escribe cada tanto: si el proceso muere de golpe, en
    // disco queda la última medición (el dev server ya está apagado y no
    // se podrían volver a bajar los source maps).
    this.reportTimer = setInterval(() => {
      this.writeReport();
    }, 2_000);
    // Los timers no son un motivo para que el proceso quede vivo.
    unref(this.timer);
    unref(this.reportTimer);
  }

  private reportTimer: ReturnType<typeof setInterval> | null = null;

  /** Espera a que aparezca el endpoint de DevTools y se conecta. */
  private async connect(): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${COVERAGE_CDP_PORT}/json/version`,
        );
        const info = await response.json();
        if (info.webSocketDebuggerUrl) {
          await this.attach(String(info.webSocketDebuggerUrl));
          return;
        }
      } catch {
        // el navegador todavía no está listo: se reintenta
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.warn(
      '[cobertura] No se encontró el endpoint de DevTools: se omite la medición.',
    );
  }

  /** Conecta al navegador y activa el auto-attach de las páginas. */
  private async attach(browserWsUrl: string): Promise<void> {
    const client = new CdpClient(browserWsUrl);
    await client.ready();
    this.client = client;

    client.on((message) => {
      if (message.method === 'Target.attachedToTarget') {
        void this.onAttached(
          String(message.params.sessionId),
          message.params.targetInfo ?? {},
        );
      }
      if (message.method === 'Target.detachedFromTarget') {
        this.sessions.delete(String(message.params.sessionId));
      }
    });

    await client.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }

  /** Activa el profiler en una página nueva y la deja seguir. */
  private async onAttached(
    sessionId: string,
    targetInfo: { type?: string },
  ): Promise<void> {
    this.statAttach += 1;
    try {
      if (targetInfo.type === 'page') {
        await this.client?.send('Profiler.enable', {}, sessionId);
        await this.client?.send(
          'Profiler.startPreciseCoverage',
          { detailed: true, allowTriggeredUpdates: false },
          sessionId,
        );
        this.sessions.add(sessionId);
      }
    } catch {
      // si el profiler no se puede activar, la página sigue igual
    } finally {
      // La página quedó en pausa esperando: hay que soltarla SIEMPRE.
      await this.client
        ?.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
        .catch(() => undefined);
    }
  }

  /** Toma la cobertura de todas las páginas abiertas y la suma. */
  private async harvest(): Promise<void> {
    if (this.harvesting || !this.client) return;
    this.harvesting = true;
    this.statHarvest += 1;
    try {
      for (const sessionId of [...this.sessions]) {
        try {
          const result = await this.client.send(
            'Profiler.takePreciseCoverage',
            {},
            sessionId,
          );
          const scripts: V8Script[] = result?.result ?? [];
          this.statOk += 1;
          this.statScripts += scripts.length;
          for (const script of scripts) this.accumulate(script);
        } catch {
          // La página se cerró con su sesión: se descarta y se sigue con
          // las demás (si no, una sesión muerta vaciaría la medición de
          // todas las otras).
          this.sessions.delete(sessionId);
          this.statDead += 1;
        }
      }
    } finally {
      this.harvesting = false;
    }
  }

  /** Suma los contadores de un script a lo ya acumulado. */
  private accumulate(script: V8Script): void {
    const url = script.url;
    if (!url.includes(COVERAGE_SOURCE_PREFIX)) return;
    // Solo código: los catálogos de i18n (JSON) y el CSS son datos.
    if (!COVERAGE_CODE_EXTENSIONS.some((ext) => url.split('?')[0].endsWith(ext))) {
      return;
    }
    let entry = this.scripts.get(url);
    if (!entry) {
      entry = { url, ranges: new Map() };
      this.scripts.set(url, entry);
      // La fuente (y su source map) se baja una sola vez, mientras el dev
      // server sigue arriba.
      void this.loadSource(url);
    }
    for (const fn of script.functions) {
      for (const range of fn.ranges) {
        const key = `${range.startOffset}-${range.endOffset}`;
        const previous = entry.ranges.get(key);
        entry.ranges.set(key, {
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          count: (previous?.count ?? 0) + range.count,
        });
      }
    }
  }

  /** Cierra la recolección y escribe el reporte. */
  async finish(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    await this.harvest();
    this.client?.close();
    this.writeReport();
  }

  /** Escribe el reporte (lcov + resumen + HTML) en `frontend/coverage/`. */
  writeReport(force = false): void {
    if (process.env.PW_COVERAGE_DUMP) {
      try {
        const dump: any = {};
        for (const [url, entry] of this.scripts.entries()) {
          dump[url] = [...entry.ranges.values()];
        }
        writeFileSync(process.env.PW_COVERAGE_DUMP, JSON.stringify(dump, null, 1), 'utf8');
        console.log('[stat] attach', this.statAttach, 'cycles', this.statHarvest, 'ok', this.statOk, 'scripts', this.statScripts, 'dead', this.statDead, 'sessions', this.sessions.size);
      } catch {}
    }
    if (this.scripts.size === 0) return;
    const now = Date.now();
    if (!force && now - this.lastReport < 1_500) return;
    this.lastReport = now;

    const files: FileCoverage[] = [];
    for (const entry of this.scripts.values()) {
      const source = this.sources.get(entry.url);
      if (!source) continue;
      files.push(
        toFileCoverage(
          source.text,
          source.mapLines,
          source.originalPath,
          [...entry.ranges.values()],
        ),
      );
    }
    if (files.length === 0) return;

    const report = buildReport(files);
    const outputDir = path.join(process.cwd(), 'coverage');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, 'lcov.info'), report.lcov, 'utf8');
    writeFileSync(
      path.join(outputDir, 'summary.json'),
      `${JSON.stringify(report.summary, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(path.join(outputDir, 'index.html'), report.html, 'utf8');
    console.log(
      `[cobertura] Renderer: ${report.summary.covered}/${report.summary.total} líneas ` +
        `(${report.summary.percent}%). Reporte en coverage/index.html`,
    );
  }

  /** Baja el JavaScript que sirve el dev server y su source map. */
  private async loadSource(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const text = await response.text();
      const info = await this.readSourceInfo(url, text);
      this.sources.set(url, { text, ...info });
    } catch {
      // sin fuente no hay reporte para ese archivo
    }
  }

  /**
   * Arma el mapa de líneas originales de un módulo.
   *
   * Vite sirve el source map INLINE (base64) al final del módulo; si no
   * estuviera, se busca el `.map` externo.
   */
  private async readSourceInfo(
    url: string,
    text: string,
  ): Promise<{
    mapLines: (number | null)[] | null;
    originalPath: string;
  }> {
    const fallbackPath = new URL(url).pathname.replace(/^\//, '');
    const inline = text.match(
      /sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/,
    );
    let raw: string | null = null;
    if (inline) {
      raw = Buffer.from(inline[1], 'base64').toString('utf8');
    } else {
      const external = text.match(/sourceMappingURL=(\S+)/);
      if (external) {
        try {
          const response = await fetch(new URL(external[1], url));
          if (response.ok) raw = await response.text();
        } catch {
          raw = null;
        }
      }
    }
    if (!raw) return { mapLines: null, originalPath: fallbackPath };

    try {
      const map = JSON.parse(raw);
      const mappings = String(map.mappings ?? '');
      const mapLines = decodeSourceMapLines(mappings);
      const source = Array.isArray(map.sources) ? map.sources[0] : undefined;
      let originalPath = fallbackPath;
      if (typeof source === 'string') {
        const resolved = new URL(source, url).pathname.replace(/^\//, '');
        if (resolved) originalPath = resolved;
      }
      return { mapLines, originalPath };
    } catch {
      return { mapLines: null, originalPath: fallbackPath };
    }
  }
}

/** Resumen de cobertura por archivo y total. */
type CoverageSummary = {
  total: number;
  covered: number;
  percent: number;
  files: { path: string; total: number; covered: number; percent: number }[];
};

/** Arma el lcov, el resumen JSON y el HTML legible. */
function buildReport(files: FileCoverage[]): {
  lcov: string;
  summary: CoverageSummary;
  html: string;
} {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const rows = sorted.map((file) => {
    const total = file.lines.size;
    const covered = [...file.lines.values()].filter((count) => count > 0).length;
    return {
      path: file.path,
      total,
      covered,
      percent: total === 0 ? 0 : Math.round((covered / total) * 100),
    };
  });
  const total = rows.reduce((acc, row) => acc + row.total, 0);
  const covered = rows.reduce((acc, row) => acc + row.covered, 0);
  const percent = total === 0 ? 0 : Math.round((covered / total) * 100);

  const lcovParts: string[] = [];
  for (const file of sorted) {
    lcovParts.push(`SF:${file.path}`);
    const entries = [...file.lines.entries()].sort((a, b) => a[0] - b[0]);
    for (const [line, count] of entries) {
      lcovParts.push(`DA:${line + 1},${count}`);
    }
    lcovParts.push(`LF:${file.lines.size}`);
    lcovParts.push(
      `LH:${[...file.lines.values()].filter((count) => count > 0).length}`,
    );
    lcovParts.push('end_of_record');
  }

  const htmlRows = rows
    .map(
      (row) =>
        `<tr><td><code>${row.path}</code></td><td>${row.covered}/${row.total}</td>` +
        `<td>${row.percent}%</td></tr>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Cobertura del renderer — Pythomics</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1f2937; }
  h1 { font-size: 1.25rem; }
  table { border-collapse: collapse; margin-top: 1rem; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: .4rem .8rem; text-align: left; }
  th { background: #f9fafb; }
  .total { font-weight: 600; }
</style>
</head>
<body>
<h1>Cobertura del renderer (E2E de Playwright)</h1>
<p class="total">Total: ${covered}/${total} líneas (${percent}%)</p>
<table>
  <thead><tr><th>Archivo</th><th>Líneas cubiertas</th><th>%</th></tr></thead>
  <tbody>
${htmlRows}
  </tbody>
</table>
</body>
</html>
`;

  return {
    lcov: `${lcovParts.join('\n')}\n`,
    summary: { total, covered, percent, files: rows },
    html,
  };
}

/**
 * Config de Playwright para tests E2E del frontend.
 *
 * Apunta al dev server de Vite (no a Electron) porque en el browser
 * no existe `window.pyxAPI` (esa superficie solo se inyecta desde el
 * preload de Electron). El mock se inyecta con `installApiMock` para
 * que el frontend no rompa al intentar hablar con el backend.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // El puerto de DevTools es lo que permite al recolector hablar con el
    // navegador (ver la sección de cobertura de arriba). Solo se abre
    // cuando se pidió medir.
    launchOptions: COVERAGE_ENABLED
      ? { args: [`--remote-debugging-port=${COVERAGE_CDP_PORT}`] }
      : undefined,
  },

  // Arranca Vite antes de correr los tests. reuseExistingServer=false
  // garantiza que siempre se levante uno fresco (evita falsos negativos
  // cuando un server previo se quedó colgado).
  webServer: {
    command: 'npm run dev:vite',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Arranque del recolector de cobertura
// ─────────────────────────────────────────────────────────────────────────────
//
// El recolector vive en el proceso PRINCIPAL del runner (el que abre el
// navegador y el dev server): es el único que puede hablar con el endpoint
// de DevTools.
//
// OJO: este módulo lo importan también los specs (`installApiMock`), así que
// se carga en cada worker. `TEST_WORKER_INDEX` está seteado solo en los
// workers: en el proceso principal no existe, y ahí es donde tiene que
// arrancar el recolector (una sola vez).
if (COVERAGE_ENABLED && !process.env.TEST_WORKER_INDEX) {
  const collector = new RendererCoverage();
  collector.start();
  // Al salir se escribe el reporte una última vez (de forma sincrónica: en
  // el hook `exit` no hay tiempo para esperas).
  process.once('exit', () => collector.writeReport(true));
  process.once('SIGINT', () => {
    void collector.finish();
  });
  process.once('SIGTERM', () => {
    void collector.finish();
  });
}
