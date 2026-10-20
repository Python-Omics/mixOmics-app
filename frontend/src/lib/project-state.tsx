import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { ModelConfig } from './types';

/**
 * Estado del "proyecto" del biólogo en la sesión actual.
 * Persiste solo en memoria (RNF-S-3: no se sube nada al backend).
 */

export type PreviewData = {
  rows: number;
  cols: number;
  sample: string[][];
};

export type UploadedFile = {
  filename: string;
  size: number;
  uploadedAt: number;
  /** Preview local (no se persiste, opcional) */
  preview?: PreviewData;
  /**
   * Contenido crudo del CSV (UTF-8). Opcional — se popula solo cuando el
   * FileDropzone quiere que el backend pueda reenviarlo (POST /v1/cargar/).
   * Para esta POC, los CSVs son chicos, así que tenerlo en memoria es OK.
   */
  content?: string;
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