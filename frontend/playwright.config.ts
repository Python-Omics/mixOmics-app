import { defineConfig } from '@playwright/test';
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
  w.__fileTextCalled = false;

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

  w.pyxAPI = {
    getBackendStatus: () => Promise.resolve(mockStatus),
    restartBackend: () => Promise.resolve({ ok: false, error: 'mock' }),
    getPathForFile: (file: File) => `/tmp/pythomics-mock/${file.name}`,
    api: {
      request: <T = unknown>(method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        return Promise.resolve(
          asResponse<T>({ ok: false, status: 0, error: 'no backend in test' }),
        );
      },
      get: <T = unknown>(path: string) => {
        calls.push({ method: 'GET', path });
        if (DATASET_PATH.test(path)) {
          return Promise.resolve(
            asResponse<T>(
              dataset
                ? ok(200, dataset)
                : { ok: false, status: 404, error: 'dataset no encontrado' },
            ),
          );
        }
        if (JOB_PATH.test(path)) {
          return Promise.resolve(asResponse<T>(ok(200, buildJob())));
        }
        return Promise.resolve(
          asResponse<T>({ ok: false, status: 0, error: 'no backend in test' }),
        );
      },
      post: <T = unknown>(path: string, body?: unknown) => {
        calls.push({ method: 'POST', path, body });
        if (path === DATASETS_PATH) {
          if (options.datasetResponse) {
            return Promise.resolve(asResponse<T>(options.datasetResponse));
          }
          const bloques =
            (body as { blocks?: DatasetBlockInput[] })?.blocks ?? [];
          dataset = buildDataset(bloques);
          return Promise.resolve(asResponse<T>(ok(201, dataset)));
        }
        if (ALIGN_PATH.test(path)) {
          if (options.alignResponse) {
            return Promise.resolve(asResponse<T>(options.alignResponse));
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
          return Promise.resolve(asResponse<T>(ok(200, alignment)));
        }
        if (TARGET_PATH.test(path)) {
          if (options.targetResponse) {
            return Promise.resolve(asResponse<T>(options.targetResponse));
          }
          target = (body ?? null) as TargetSpec | null;
          if (dataset) dataset = { ...dataset, target };
          return Promise.resolve(
            asResponse<T>(
              dataset
                ? ok(200, dataset)
                : { ok: false, status: 404, error: 'dataset no encontrado' },
            ),
          );
        }
        if (path === '/v1/model/') {
          if (options.modelResponse) {
            return Promise.resolve(asResponse<T>(options.modelResponse));
          }
          return Promise.resolve(asResponse<T>(ok(202, { job_id: JOB_ID })));
        }
        return Promise.resolve(
          asResponse<T>({ ok: false, status: 0, error: 'no backend in test' }),
        );
      },
      delete: <T = unknown>(path: string) => {
        calls.push({ method: 'DELETE', path });
        if (JOB_PATH.test(path)) {
          cancelled = true;
          return Promise.resolve(asResponse<T>(ok(202, { job_id: JOB_ID })));
        }
        return Promise.resolve(
          asResponse<T>({ ok: false, status: 0, error: 'no backend in test' }),
        );
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
        if (options.uploadResponse) {
          return Promise.resolve(
            options.uploadResponse,
          ) as Promise<ApiResponse<UploadResponse>>;
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
        return Promise.resolve({
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
        });
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
