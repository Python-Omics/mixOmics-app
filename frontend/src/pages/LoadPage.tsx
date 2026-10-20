import { useState } from 'react';
import { FileDropzone } from '../components/FileDropzone';
import { FileList } from '../components/FileList';
import { useProject, type UploadedFile, type PreviewData } from '../lib/project-state';

type Props = {
  onNext: () => void;
};

type FileWithPreview = UploadedFile & { preview: PreviewData };

export function LoadPage({ onNext }: Props) {
  const { state, addFile, removeFile, setModelConfig } = useProject();
  const [status, setStatus] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);

  const handleFileAdded = async (file: FileWithPreview) => {
    addFile(file);
    setModelConfig({ filename: file.filename });

    // Llamada simbólica al backend. En esta POC el endpoint /v1/cargar/
    // está como placeholder (devuelve null), así que el frontend sigue
    // funcionando aunque el backend no haga nada todavía.
    try {
      const res = await window.pyxAPI.api.post('/v1/cargar/', {
        filename: file.filename,
        content: file.content ?? '',
      });

      if (res.ok) {
        if (res.data !== null && res.data !== undefined) {
          setStatus({
            kind: 'info',
            text: `Backend confirmó recepción de ${file.filename}.`,
          });
        } else {
          setStatus({
            kind: 'warn',
            text: `Archivo ${file.filename} listo localmente. (Endpoint /v1/cargar/ pendiente de implementar en el backend.)`,
          });
        }
      } else {
        setStatus({
          kind: 'error',
          text: `El backend respondió con error: HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        text: `No se pudo contactar el backend: ${(err as Error).message}`,
      });
    }
  };

  const handleRemove = (filename: string) => {
    removeFile(filename);
    setStatus(null);
  };

  const canContinue = state.files.length > 0;

  return (
    <div className="max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-pharma-700">
            Cargar datos ómicos
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Sube uno o más archivos{' '}
            <code className="font-mono text-pharma-700">.csv</code> o{' '}
            <code className="font-mono text-pharma-700">.tsv</code> con tus
            matrices (expresión, proteómica, metabolómica o variables clínicas).
            Filas = muestras, columnas = variables.
          </p>
        </div>
        <span
          className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-500 bg-pharma-100 border border-pharma-200 rounded-full px-3 py-1 mt-0.5"
          role="status"
          aria-live="polite"
        >
          {state.files.length} archivo{state.files.length === 1 ? '' : 's'}{' '}
          cargados
        </span>
      </header>

      <FileDropzone onFileAdded={handleFileAdded} />

      {status && (
        <p
          role="status"
          className={`text-sm rounded px-3 py-2 border ${
            status.kind === 'error'
              ? 'text-red-700 bg-red-50 border-red-200'
              : status.kind === 'warn'
                ? 'text-amber-800 bg-amber-50 border-amber-200'
                : 'text-slate-700 bg-pharma-50 border-pharma-200'
          }`}
        >
          {status.text}
        </p>
      )}

      <FileList files={state.files} onRemove={handleRemove} />

      <footer className="flex justify-end pt-2">
        <button
          type="button"
          className="btn-primary"
          onClick={onNext}
          disabled={!canContinue}
        >
          Siguiente →
        </button>
      </footer>
    </div>
  );
}