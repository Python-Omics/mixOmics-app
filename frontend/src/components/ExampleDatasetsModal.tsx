import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './icons';
import { useProject, type PreviewData } from '../lib/project-state';
import { EXAMPLE_DATASETS, type ExampleDataset } from '../lib/example-datasets';

const MODEL_BADGE: Record<ExampleDataset['suggestedModel'], string> = {
  PCA: 'PCA',
  'PLS-DA': 'PLS-DA',
  'sPLS-DA': 'sPLS-DA',
  DIABLO: 'DIABLO',
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; id: string }
  | { kind: 'error'; message: string };

function parseCsvPreview(text: string, sep: string): PreviewData {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const sample = lines.slice(0, 6).map((line) => line.split(sep));
  const rows = lines.length;
  const cols = sample[0]?.length ?? 0;
  return { rows, cols, sample };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenTutorial?: () => void;
};

/**
 * Modal con los datasets de ejemplo pre-empaquetados de mixOmics.
 *
 * Accesibilidad: role="dialog", aria-modal, cierre con Escape, foco
 * inicial en cerrar, backdrop clickeable.
 */
export function ExampleDatasetsModal({ open, onClose, onOpenTutorial }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { addFile, setModelConfig } = useProject();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleLoad = async (dataset: ExampleDataset) => {
    setState({ kind: 'loading', id: dataset.id });
    try {
      // Traemos todos los bloques del dataset en paralelo:
      // el principal + los adicionales (si hay). El biólogo no tiene que
      // hacer nada más para tener el set completo listo para DIABLO.
      const allFiles = [dataset.primaryFile, ...(dataset.additionalFiles ?? [])];

      const responses = await Promise.all(
        allFiles.map(async (filename) => {
          const res = await fetch(`/datasets/${filename}`);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} al pedir ${filename}`);
          }
          const text = await res.text();
          return { filename, text };
        }),
      );

      for (const { filename, text } of responses) {
        if (!text.trim()) {
          throw new Error(`El archivo ${filename} está vacío`);
        }
        const sep = filename.endsWith('.tsv') ? '\t' : ',';
        const preview = parseCsvPreview(text, sep);
        addFile({
          filename,
          size: text.length,
          uploadedAt: Date.now(),
          preview,
        });
      }

      // Solo el principal se preselecciona para el modelo.
      // (Los adicionales quedan en el FileList y el biólogo decide
      // qué hacer con ellos cuando implementemos multi-bloque.)
      setModelConfig({
        filename: dataset.primaryFile,
        model_type: dataset.suggestedModel,
      });

      setState({ kind: 'idle' });
      onClose();
    } catch (err) {
      setState({
        kind: 'error',
        message: `No se pudo cargar ${dataset.name}: ${(err as Error).message}`,
      });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="example-datasets-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative card w-full max-w-2xl p-6 bg-white shadow-xl">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2
              id="example-datasets-title"
              className="text-lg font-semibold text-pharma-700"
            >
              Probar con dataset de ejemplo
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Datasets reales de <code className="font-mono text-pharma-700">mixOmics</code> pre-empaquetados.
              Listos para usarse.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-ghost text-slate-500 hover:text-slate-700"
            aria-label="Cerrar datasets de ejemplo"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {state.kind === 'error' && (
          <p
            role="alert"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3"
          >
            {state.message}
          </p>
        )}

        <ul className="space-y-2 max-h-[50vh] overflow-y-auto pr-1" aria-label="Lista de datasets de ejemplo">
          {EXAMPLE_DATASETS.map((ds) => {
            const isLoading = state.kind === 'loading' && state.id === ds.id;
            const disabled = state.kind === 'loading';
            return (
              <li
                key={ds.id}
                className="flex items-center justify-between gap-3 bg-pharma-50 rounded-md border border-pharma-200 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-sm text-pharma-700 font-semibold">
                      {ds.name}
                    </code>
                    <span className="text-xs px-1.5 py-0.5 bg-white text-pharma-700 border border-pharma-200 rounded font-medium">
                      {MODEL_BADGE[ds.suggestedModel]}
                    </span>
                    {ds.additionalFiles && ds.additionalFiles.length > 0 && (
                      <span className="text-xs text-slate-500">
                        +{ds.additionalFiles.length} bloque
                        {ds.additionalFiles.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{ds.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {ds.nSamples} × {ds.nFeatures}
                    {ds.metaColumns && ds.metaColumns.length > 0 && (
                      <> · clase: {ds.metaColumns.join(', ')}</>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleLoad(ds)}
                  disabled={disabled}
                  className="btn-primary shrink-0"
                  aria-label={`Cargar dataset ${ds.name}`}
                >
                  {isLoading ? 'Cargando…' : 'Cargar'}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            El botón <strong>Cargar</strong> trae todos los bloques del dataset.
            Para multi-bloque (DIABLO) el set completo ya queda listo.
          </p>
          {onOpenTutorial && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTutorial();
              }}
              className="btn-ghost text-xs"
            >
              ¿Cómo usar? →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
