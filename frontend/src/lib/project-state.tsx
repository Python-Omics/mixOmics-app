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

export type ModelResult = unknown;

export type ProjectState = {
  files: UploadedFile[];
  modelConfig: ModelConfig;
  result: ModelResult | null;
};

const defaultConfig: ModelConfig = {
  model_type: 'PCA',
  n_components: 2,
  keepX: 50,
  filename: '',
};

type ProjectContextValue = {
  state: ProjectState;
  addFile: (file: UploadedFile) => void;
  removeFile: (filename: string) => void;
  setModelConfig: (patch: Partial<ModelConfig>) => void;
  setResult: (result: ModelResult | null) => void;
  reset: () => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectState>({
    files: [],
    modelConfig: defaultConfig,
    result: null,
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

  const setModelConfig = useCallback((patch: Partial<ModelConfig>) => {
    setState((s) => ({ ...s, modelConfig: { ...s.modelConfig, ...patch } }));
  }, []);

  const setResult = useCallback((result: ModelResult | null) => {
    setState((s) => ({ ...s, result }));
  }, []);

  const reset = useCallback(() => {
    setState({ files: [], modelConfig: defaultConfig, result: null });
  }, []);

  return (
    <ProjectContext.Provider
      value={{ state, addFile, removeFile, setModelConfig, setResult, reset }}
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