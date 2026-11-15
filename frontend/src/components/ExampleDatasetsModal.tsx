import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { CloseIcon } from './icons';
import { useProject, type FileRole } from '../lib/project-state';
import { api } from '../lib/api';
import { EXAMPLE_DATASETS, type ExampleDataset } from '../lib/example-datasets';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

const MODEL_BADGE: Record<ExampleDataset['suggestedModel'], string> = {
  PCA: 'PCA',
  'PLS-DA': 'PLS-DA',
  'sPLS-DA': 'sPLS-DA',
  DIABLO: 'DIABLO',
};

/**
 * Función de fragmento de react-intl: recibe las partes del mensaje que
 * caen dentro de una etiqueta (`<code>`, `<strong>`) y devuelve el nodo.
 */
type Chunks = (chunks: string[]) => ReactNode;

/**
 * Archivo que quedó cargado en el backend, con su rol.
 *
 * El rol lo declara el catálogo del dataset (el `metaFile` es la tabla de
 * fenotipo), no el dtype de sus columnas: los fenotipos de mixOmics vienen
 * codificados como enteros.
 */
type LoadedFile = {
  filename: string;
  role: FileRole;
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; id: string }
  | { kind: 'error'; message: string; loaded: LoadedFile[] };

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
  const t = useTranslate();
  const intl = useIntl();

  /**
   * Traduce un mensaje con marcado en línea.
   *
   * `useTranslate()` solo admite valores primitivos, así que los párrafos
   * con marcado usan `intl.formatMessage` con funciones de fragmento. El
   * tipo de la clave se sigue validando contra el catálogo.
   */
  const rich = (id: MessageKey, values: Record<string, Chunks>) =>
    intl.formatMessage({ id }, values);

  /** Términos técnicos en monoespaciada (mixOmics). */
  const code: Chunks = (chunks) => (
    <code className="font-mono text-pharma-700">{chunks}</code>
  );

  /** Énfasis del texto (la parte en negrita del mensaje). */
  const strong: Chunks = (chunks) => <strong>{chunks}</strong>;

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

    // Orden de subida: primero los bloques numéricos y al final la tabla
    // de metadata (el fenotipo). Al backend le da igual, pero en la UI el
    // phenotype queda a la vista al final.
    const allFiles = [
      dataset.primaryFile,
      ...(dataset.additionalFiles ?? []),
      ...(dataset.metaFile ? [dataset.metaFile] : []),
    ];

    // 1) Descarga de los assets estáticos. Van en paralelo porque no
    //    dependen entre sí, pero un fallo NO aborta el lote: se anota y se
    //    sigue con los demás.
    const downloaded = await Promise.all(
      allFiles.map(async (filename) => {
        try {
          const res = await fetch(`/datasets/${filename}`);
          if (!res.ok) {
            throw new Error(
              t('datasets.httpError', { status: res.status, filename }),
            );
          }
          const text = await res.text();
          if (!text.trim()) {
            throw new Error(t('datasets.emptyFile', { filename }));
          }
          return { filename, text, error: null as string | null };
        } catch (err) {
          return { filename, text: null, error: (err as Error).message };
        }
      }),
    );

    // 2) Subida secuencial (el orden define el orden en la UI) y tolerante
    //    a fallos: un archivo que falla se reporta y el lote sigue.
    const failures: { filename: string; message: string }[] = [];
    const loaded: LoadedFile[] = [];
    let modelFile = '';

    for (const item of downloaded) {
      if (item.text === null) {
        failures.push({
          filename: item.filename,
          message: item.error ?? '',
        });
        continue;
      }
      const { filename, text } = item;
      try {
        // Los datasets de ejemplo son assets estáticos de Vite: no tienen
        // una ruta local que Electron pueda abrir. Se envían como contenido
        // por el fallback del canal de subida y el backend devuelve el
        // preview y el resumen de ingesta.
        const upload = await api.uploadFile('', filename, text);
        if (!upload.ok || !upload.data) {
          throw new Error(upload.apiError?.code ?? `HTTP ${upload.status}`);
        }

        const summary = upload.data;
        // El rol lo declara el catálogo del dataset: `metaFile` es la tabla
        // de fenotipo (variable de clase), el resto son matrices de
        // variables del modelo.
        const role: FileRole =
          dataset.metaFile && filename === dataset.metaFile
            ? 'metadata'
            : 'block';
        addFile({
          filename: summary.block.filename || filename,
          size: text.length,
          uploadedAt: Date.now(),
          preview: summary.preview,
          block: summary.block,
          warnings: summary.warnings,
          role,
          // Excepción consciente: el texto existe solo para este asset
          // estático, que el renderer descarga por HTTP. Nunca se usa para
          // archivos elegidos por el usuario.
          content: text,
        });

        loaded.push({
          filename: summary.block.filename || filename,
          role,
        });
        // El modelo se configura sobre una matriz de variables: la tabla de
        // metadata alimenta la variable de clase, no las variables.
        if (role === 'block' && !modelFile) {
          modelFile = summary.block.filename || filename;
        }
      } catch (err) {
        failures.push({ filename, message: (err as Error).message });
      }
    }

    // Solo un bloque numérico se preselecciona para el modelo.
    // (Los demás quedan en el FileList y el biólogo decide
    // qué hacer con ellos cuando implementemos multi-bloque.)
    setModelConfig({
      filename: modelFile,
      model_type: dataset.suggestedModel,
    });

    if (failures.length > 0) {
      // Los archivos que sí entraron quedan en el proyecto: el error se
      // reporta, pero el lote no se descarta.
      setState({
        kind: 'error',
        message: t('datasets.loadError', {
          name: dataset.name,
          detail: failures
            .map((f) => `${f.filename}: ${f.message}`)
            .join('; '),
        }),
        loaded,
      });
      return;
    }

    setState({ kind: 'idle' });
    onClose();
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
              {t('datasets.title')}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              {rich('datasets.subtitle', { code })}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-ghost text-slate-500 hover:text-slate-700"
            aria-label={t('datasets.closeLabel')}
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {state.kind === 'error' && (
          <div
            role="alert"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3"
          >
            <p>{state.message}</p>
            {state.loaded.length > 0 && (
              <ul className="list-disc pl-4 mt-1">
                {state.loaded.map((file) => (
                  <li key={file.filename}>
                    <span className="font-mono">{file.filename}</span>
                    {file.role === 'metadata' && (
                      <span className="italic">
                        {' '}
                        {t('ingest.metadataBlock')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ul
          className="space-y-2 max-h-[50vh] overflow-y-auto pr-1"
          aria-label={t('datasets.listLabel')}
        >
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
                        {t('datasets.extraBlocks', {
                          count: ds.additionalFiles.length,
                        })}
                      </span>
                    )}
                    {/*
                      La tabla de metadata (fenotipo) se distingue de los
                      bloques numéricos: el catálogo del dataset declara
                      cuál es su `metaFile`.
                    */}
                    {ds.metaFile && (
                      <span className="text-xs text-slate-500 italic">
                        {t('ingest.metadataBlock')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t(ds.descriptionKey)}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {ds.nSamples} × {ds.nFeatures}
                    {ds.metaColumns && ds.metaColumns.length > 0 && (
                      <>
                        {t('datasets.metaColumns', {
                          columns: ds.metaColumns.join(', '),
                        })}
                      </>
                    )}
                  </p>
                  {ds.metaFile && (
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      {ds.metaFile}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleLoad(ds)}
                  disabled={disabled}
                  className="btn-primary shrink-0"
                  aria-label={t('datasets.loadLabel', { name: ds.name })}
                >
                  {isLoading ? t('datasets.loading') : t('datasets.load')}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {rich('datasets.footerNote', { strong })}
          </p>
          {onOpenTutorial && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTutorial();
              }}
              className="btn-primary shrink-0"
              aria-label={t('datasets.howToLabel')}
            >
              {t('datasets.howTo')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
