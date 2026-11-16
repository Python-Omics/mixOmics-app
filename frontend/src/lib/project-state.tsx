import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type {
  IngestWarning,
  ModelConfig,
  ModelResult,
  UploadResponse,
} from './types';

/**
 * Estado del "proyecto" del biólogo en la sesión actual.
 * Persiste solo en memoria (RNF-S-3: no se sube nada al backend).
 */

/** Vista previa producida por el backend durante la ingesta. */
export type PreviewData = {
  columns: string[];
  rows: string[][];
};

/**
 * Rol de un archivo dentro del proyecto.
 *
 * - `block`: matriz de variables del modelo (PCA, DIABLO).
 * - `metadata`: tabla de fenotipo (variable de clase, genotipo, dieta, ...).
 *
 * El rol NO se deduce del dtype de las columnas ni del nombre del archivo:
 * los fenotipos de mixOmics vienen codificados como enteros (`genotype` 1/2,
 * `diet` 1/3/5), así que una tabla de metadata puede tener todas sus
 * columnas numéricas. Lo determina el origen del archivo: para los datasets
 * de ejemplo, el `metaFile` del catálogo (`lib/example-datasets.ts`).
 *
 * El usuario puede corregirlo a mano desde la pantalla de carga: el control
 * de rol (`setFileRole`) cambia el archivo entre `block` y `metadata`.
 */
export type FileRole = 'block' | 'metadata';

export type UploadedFile = {
  filename: string;
  size: number;
  uploadedAt: number;
  /**
   * Rol del archivo en el proyecto: matriz de variables o tabla de
   * metadata (fenotipo).
   */
  role: FileRole;
  /** Vista previa devuelta por el backend. */
  preview?: PreviewData;
  /**
   * Ruta del archivo en disco. Es lo que usan los archivos que el usuario
   * elige o arrastra: el renderer NUNCA los lee, el proceso Electron los
   * lee del disco y los sube.
   */
  path?: string;
  /**
   * Texto crudo. SOLO para los datasets de ejemplo pre-empaquetados: son
   * assets estáticos que el renderer descarga por HTTP, así que no hay una
   * ruta en disco que el backend pueda leer. Nunca para archivos del usuario.
   */
  content?: string;
  /** Metadatos del bloque devueltos por la ingesta. */
  block?: UploadResponse['block'];
  /** Advertencias no bloqueantes devueltas por la ingesta. */
  warnings?: IngestWarning[];
};

export type ProjectState = {
  files: UploadedFile[];
  modelConfig: ModelConfig;
  /**
   * Resultado del último análisis.
   *
   * El tipo real vive en `lib/types.ts` (calcado de
   * `backend/app/schemas.py`): no puede haber dos `ModelResult`.
   */
  result: ModelResult | null;
  /**
   * Identificador de la receta de datos en el backend (S3).
   *
   * La sesión vive en el backend: el renderer solo guarda el identificador
   * para poder recuperarla (`GET /v1/datasets/{id}/`) si el usuario vuelve a
   * la pantalla de configuración.
   */
  datasetId: string | null;
  /**
   * Identificador del job de análisis (S4).
   *
   * Permite reengancharse a un job en curso aunque el usuario recargue la
   * ventana (G5): el polling se retoma con este identificador.
   */
  jobId: string | null;
  /**
   * Semilla del análisis (RB-6).
   *
   * Se genera una vez por proyecto y viaja en cada solicitud de modelo, así
   * que dos corridas del mismo proyecto son reproducibles.
   */
  seed: number;
};

const defaultConfig: ModelConfig = {
  model_type: 'PCA',
  n_components: 2,
  keepX: 50,
  filename: '',
};

/**
 * Semilla inicial del proyecto.
 *
 * El rango es el de una semilla de R con signo de 32 bits: es lo que
 * `set.seed()` acepta sin recortar.
 */
function initialSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

type ProjectContextValue = {
  state: ProjectState;
  addFile: (file: UploadedFile) => void;
  removeFile: (filename: string) => void;
  setFileRole: (filename: string, role: FileRole) => void;
  setModelConfig: (patch: Partial<ModelConfig>) => void;
  setResult: (result: ModelResult | null) => void;
  setDatasetId: (datasetId: string | null) => void;
  setJobId: (jobId: string | null) => void;
  reset: () => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectState>({
    files: [],
    modelConfig: defaultConfig,
    result: null,
    datasetId: null,
    jobId: null,
    seed: initialSeed(),
  });

  const addFile = useCallback((file: UploadedFile) => {
    setState((s) => {
      // Si ya existe, lo reemplazamos (re-upload)
      const without = s.files.filter((f) => f.filename !== file.filename);
      return { ...s, files: [...without, file] };
    });
  }, []);

  const removeFile = useCallback((filename: string) => {
    setState((s) => ({
      ...s,
      files: s.files.filter((f) => f.filename !== filename),
    }));
  }, []);

  /**
   * Cambia el rol de un archivo subido.
   *
   * El rol lo declara el usuario, no el dtype: un archivo puede aportar las
   * variables del modelo o ser la tabla de metadata del estudio. Si el rol
   * pedido es el que ya tiene, no se toca nada.
   *
   * Al cambiar el rol, la receta guardada en el backend queda vieja (tiene
   * el rol anterior): se limpia su identificador para que la próxima visita
   * a Configurar cree una receta nueva con los roles correctos.
   */
  const setFileRole = useCallback((filename: string, role: FileRole) => {
    setState((s) => {
      const archivo = s.files.find((f) => f.filename === filename);
      if (!archivo || archivo.role === role) return s;
      return {
        ...s,
        files: s.files.map((f) =>
          f.filename === filename ? { ...f, role } : f,
        ),
        datasetId: null,
      };
    });
  }, []);

  const setModelConfig = useCallback((patch: Partial<ModelConfig>) => {
    setState((s) => ({ ...s, modelConfig: { ...s.modelConfig, ...patch } }));
  }, []);

  const setResult = useCallback((result: ModelResult | null) => {
    setState((s) => ({ ...s, result }));
  }, []);

  const setDatasetId = useCallback((datasetId: string | null) => {
    setState((s) => ({ ...s, datasetId }));
  }, []);

  const setJobId = useCallback((jobId: string | null) => {
    setState((s) => ({ ...s, jobId }));
  }, []);

  const reset = useCallback(() => {
    setState({
      files: [],
      modelConfig: defaultConfig,
      result: null,
      datasetId: null,
      jobId: null,
      seed: initialSeed(),
    });
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        state,
        addFile,
        removeFile,
        setFileRole,
        setModelConfig,
        setResult,
        setDatasetId,
        setJobId,
        reset,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject debe usarse dentro de <ProjectProvider>');
  }
  return ctx;
}