import { useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { FileDropzone } from '../components/FileDropzone';
import { FileList } from '../components/FileList';
import { api } from '../lib/api';
import { useProject, type UploadedFile, type PreviewData } from '../lib/project-state';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Props = {
  onNext: () => void;
};

type FileWithPreview = UploadedFile & { preview: PreviewData };

/**
 * Función de fragmento de react-intl: recibe las partes del mensaje que
 * caen dentro de una etiqueta (`<code>`) y devuelve el nodo.
 */
type Chunks = (chunks: string[]) => ReactNode;

/**
 * Extrae el `detail` de un cuerpo de error de FastAPI.
 * Acepta un string o la lista de errores de validación (422).
 */
function extractDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) return null;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const textos = detail
      .map((item) =>
        item && typeof item === 'object' && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .filter((t) => t.length > 0);
    return textos.length > 0 ? textos.join('; ') : null;
  }
  return null;
}

export function LoadPage({ onNext }: Props) {
  const { state, addFile, removeFile, setModelConfig } = useProject();
  const [status, setStatus] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
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

  const handleFileAdded = async (file: FileWithPreview) => {
    addFile(file);
    setModelConfig({ filename: file.filename });

    // Subida real: POST /v1/archivos/ con multipart/form-data.
    try {
      const res = await api.uploadFile(file.filename, file.content ?? '');

      if (res.ok) {
        const mensaje = res.data?.mensaje?.trim();
        setStatus({
          kind: 'info',
          text: mensaje
            ? mensaje
            : t('load.uploadOk', { filename: file.filename }),
        });
      } else {
        const detail = extractDetail(res.data);
        const partes = [`HTTP ${res.status}`];
        if (detail) partes.push(detail);
        if (res.error) partes.push(res.error);
        setStatus({
          kind: 'error',
          // El `detail` del backend no se traduce: se interpola tal cual.
          text: t('load.uploadError', {
            filename: file.filename,
            detail: partes.join(' — '),
          }),
        });
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        text: t('load.backendUnreachable', { detail: (err as Error).message }),
      });
    }
  };

  const handleRemove = async (filename: string) => {
    removeFile(filename);

    // Borrado real: DELETE /v1/archivos/?nombre_archivo=...
    try {
      const res = await api.deleteFile(filename);
      if (res.ok) {
        const mensaje = res.data?.mensaje?.trim();
        setStatus({
          kind: 'info',
          text: mensaje ? mensaje : t('load.removeOk', { filename }),
        });
      } else {
        const detail = extractDetail(res.data);
        const partes = [`HTTP ${res.status}`];
        if (detail) partes.push(detail);
        if (res.error) partes.push(res.error);
        setStatus({
          kind: 'warn',
          text: t('load.removeWarn', {
            filename,
            detail: partes.join(' — '),
          }),
        });
      }
    } catch (err) {
      setStatus({
        kind: 'warn',
        text: t('load.removeUnreachable', {
          filename,
          detail: (err as Error).message,
        }),
      });
    }
  };

  const canContinue = state.files.length > 0;

  return (
    <div className="max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-pharma-700">
            {t('load.title')}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {rich('load.description', { code })}
          </p>
        </div>
        <span
          className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-500 bg-pharma-100 border border-pharma-200 rounded-full px-3 py-1 mt-0.5"
          role="status"
          aria-live="polite"
        >
          {t('load.filesCount', { count: state.files.length })}
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
          {t('load.next')}
        </button>
      </footer>
    </div>
  );
}
