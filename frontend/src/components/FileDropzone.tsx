import {
  useCallback,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useIntl } from 'react-intl';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { FileIcon } from './icons';

export type SelectedFile = {
  filename: string;
  size: number;
  uploadedAt: number;
  /** Ruta local resuelta por Electron; el renderer no lee el archivo. */
  path: string;
};

type Props = {
  onFileAdded: (file: SelectedFile) => void | Promise<void>;
};

const ACCEPTED_EXT = ['.csv', '.tsv'] as const;

/**
 * Función de fragmento de react-intl: recibe las partes del mensaje que
 * caen dentro de una etiqueta (`<code>`) y devuelve el nodo.
 */
type Chunks = (chunks: string[]) => ReactNode;

export function FileDropzone({ onFileAdded }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  /** Extensiones de archivo en monoespaciada (.csv, .tsv). */
  const code: Chunks = (chunks) => (
    <code className="font-mono text-pharma-700">{chunks}</code>
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setUploading(true);

      try {
        for (const file of Array.from(files)) {
          const lower = file.name.toLowerCase();
          const ext = ACCEPTED_EXT.find((e) => lower.endsWith(e));
          if (!ext) {
            setError(
              t('file.unsupportedFormat', { filename: file.name }),
            );
            continue;
          }

          if (file.size === 0) {
            setError(t('file.emptyFile', { filename: file.name }));
            continue;
          }

          // Solo se resuelve la ruta. El archivo se lee en el proceso
          // Electron, nunca como texto dentro del renderer.
          const path = window.pyxAPI.getPathForFile(file);
          if (!path) {
            setError(t('file.pathUnavailable', { filename: file.name }));
            continue;
          }

          await onFileAdded({
            filename: file.name,
            size: file.size,
            uploadedAt: Date.now(),
            path,
          });
        }
      } finally {
        setUploading(false);
      }
    },
    [onFileAdded, t],
  );

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = ''; // permite re-cargar el mismo archivo
  };

  return (
    <div>
      <label
        htmlFor="file-input"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`block border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-pharma-400 bg-pharma-100'
            : 'border-pharma-200 hover:border-pharma-400 hover:bg-pharma-50'
        }`}
        aria-label={t('file.dropLabel')}
      >
        <input
          id="file-input"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          multiple
          onChange={onChange}
          className="sr-only"
          aria-describedby="file-help"
        />
        <div className="mb-3 text-pharma-500">
          <FileIcon className="w-12 h-12 mx-auto" />
        </div>
        <p className="text-slate-700 font-medium">
          {rich('file.dropTitle', { code })}
        </p>
        <p id="file-help" className="text-sm text-slate-500 mt-1">
          {uploading ? t('file.uploading') : t('file.dropHelp')}
        </p>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}