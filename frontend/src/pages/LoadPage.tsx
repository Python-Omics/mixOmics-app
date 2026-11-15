import { useState, type ReactNode } from 'react';
import { useIntl, type PrimitiveType } from 'react-intl';
import { FileDropzone } from '../components/FileDropzone';
import { FileList } from '../components/FileList';
import {
  api,
  extractApiError,
  type ApiErrorPayload,
  type ApiResponse,
} from '../lib/api';
import { useProject, type UploadedFile, type PreviewData } from '../lib/project-state';
import { useTranslate } from '../i18n';
import esCatalog from '../i18n/es.json';
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

/** Firma de `useTranslate()`, para poder pasar `t` como argumento. */
type Translate = (key: MessageKey, values?: Record<string, PrimitiveType>) => string;

/**
 * Todas las claves `errors.*` del catálogo.
 *
 * La fuente de verdad es `es.json` (ver `i18n/messages.ts`): si una clave
 * desaparece del catálogo, esta unión la pierde y el mapa de abajo deja de
 * compilar.
 */
type CatalogErrorKey = Extract<MessageKey, `errors.${string}`>;

/**
 * Clave de i18n de cada código de error del backend.
 *
 * La derivación es la misma que aplica el backend (`errors.<camelCaseDelCodigo>`,
 * ver `derive_message_key()` en `backend/app/errors.py`), así que el mapa y
 * `ErrorCode` no pueden desincronizarse sin que la compilación falle.
 */
const ERROR_MESSAGE_KEYS = [
  ['E_FILE_EXTENSION', 'errors.fileExtension'],
  ['E_EMPTY_FILE', 'errors.emptyFile'],
  ['E_NOT_NUMERIC', 'errors.notNumeric'],
  ['E_DUPLICATE_SAMPLES', 'errors.duplicateSamples'],
  ['E_NO_COMMON_SAMPLES', 'errors.noCommonSamples'],
  ['E_BLOCK_ROWS_MISMATCH', 'errors.blockRowsMismatch'],
  ['E_UNKNOWN_BLOCK', 'errors.unknownBlock'],
  ['E_UNKNOWN_DATASET', 'errors.unknownDataset'],
  ['E_JOB_NOT_FOUND', 'errors.jobNotFound'],
  ['E_MODEL_UNKNOWN', 'errors.modelUnknown'],
  ['E_TARGET_COLUMN_MISSING', 'errors.targetColumnMissing'],
  ['E_R_NOT_AVAILABLE', 'errors.rNotAvailable'],
  ['E_MIXOMICS_NOT_AVAILABLE', 'errors.mixomicsNotAvailable'],
  ['E_WORKER_CRASHED', 'errors.workerCrashed'],
  ['E_ANALYSIS_FAILED', 'errors.analysisFailed'],
  ['E_UNEXPECTED', 'errors.unexpected'],
  ['E_NOT_IMPLEMENTED', 'errors.notImplemented'],
  ['E_UNAUTHORIZED', 'errors.unauthorized'],
] as const satisfies readonly (readonly [string, CatalogErrorKey])[];

/** Mapa código de error → clave de i18n. */
const ERROR_MESSAGE_KEY_BY_CODE = new Map<string, CatalogErrorKey>(
  ERROR_MESSAGE_KEYS,
);

/** Claves `errors.*` del catálogo que el mapa no cubre. */
type UnmappedCatalogErrorKey = Exclude<
  CatalogErrorKey,
  (typeof ERROR_MESSAGE_KEYS)[number][1]
>;

/**
 * Aserción de compilación: el mapa tiene que cubrir todas las claves
 * `errors.*` del catálogo.
 *
 * Si el catálogo crece y el mapa no, el tipo de esta constante pasa a ser
 * `never` y la asignación no compila: el build falla en vez de dejar una
 * clave de error sin traducir.
 */
const CATALOG_IN_SYNC: UnmappedCatalogErrorKey extends never ? true : never =
  true;

/**
 * Todas las claves del catálogo, en runtime.
 *
 * Sirve para validar las claves que llegan del backend (`message_key`):
 * solo se resuelve una clave que exista de verdad en el catálogo.
 */
const CATALOG_KEYS: ReadonlySet<string> = new Set(Object.keys(esCatalog));

/**
 * Extrae el `detail` de FastAPI: un string o la lista de errores de
 * validación (422).
 *
 * Es el formato que sigue usando FastAPI para la validación de Pydantic y
 * para las rutas inexistentes.
 */
function extractFastApiDetail(data: unknown): string | null {
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

/**
 * Resuelve la clave de catálogo de un error estructurado del backend.
 *
 * Primero se respeta el `message_key` que manda el backend (si existe en el
 * catálogo); si no, se usa el mapa código → clave del renderer; si no hay
 * ninguna, `null` (el caller muestra el texto genérico).
 */
function resolveErrorMessageKey(payload: ApiErrorPayload): MessageKey | null {
  // `CATALOG_IN_SYNC` es una aserción de compilación: en runtime siempre es
  // `true` (si el mapa y el catálogo no coincidieran, el build ya falló).
  if (!CATALOG_IN_SYNC) return null;

  if (CATALOG_KEYS.has(payload.messageKey)) {
    return payload.messageKey as MessageKey;
  }
  return ERROR_MESSAGE_KEY_BY_CODE.get(payload.code) ?? null;
}

/**
 * Arma los valores de interpolación de un error del backend.
 *
 * Salen del `detail` estructurado (solo primitivos: los arrays de IDs se
 * unen con comas) y se completa con el archivo de la operación en curso,
 * para que los mensajes que nombran el archivo siempre puedan interpolar
 * `{file}`.
 */
function buildErrorValues(
  detail: Record<string, unknown> | undefined,
  context: { filename?: string } = {},
): Record<string, PrimitiveType> {
  const values: Record<string, PrimitiveType> = {};

  for (const [key, value] of Object.entries(detail ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') {
      values[key] = value;
    } else if (Array.isArray(value)) {
      const joined = value.filter((item) => typeof item === 'string').join(', ');
      if (joined) values[key] = joined;
    }
  }

  if (context.filename && values.file === undefined) {
    values.file = context.filename;
  }

  return values;
}

/**
 * Traduce el mensaje de un error del backend.
 *
 * `t()` devuelve la clave cruda cuando el catálogo no puede formatear el
 * mensaje (por ejemplo, si falta un valor de interpolación): en ese caso se
 * cae al texto genérico, para que el usuario nunca vea una clave.
 */
function translateErrorMessage(
  t: Translate,
  key: MessageKey,
  values: Record<string, PrimitiveType>,
): string {
  const text = t(key, values);
  return text === key ? t('common.error') : text;
}

/**
 * Arma el texto de error de una respuesta no exitosa.
 *
 * Tres formas, en este orden:
 *   1. el sobre del backend (`{ error: { code, message_key, detail } }`): se
 *      resuelve la clave de i18n y se interpolan los datos del `detail`;
 *   2. la forma de FastAPI (`{ detail: "..." }`): se muestra el texto tal
 *      cual, porque el backend no lo traduce;
 *   3. la lista de validación de Pydantic (`{ detail: [...] }`): se unen los
 *      mensajes de validación.
 *
 * Devuelve null si no hay nada que mostrar.
 */
function buildErrorMessage(
  res: ApiResponse<unknown>,
  t: Translate,
  context: { filename?: string } = {},
): string | null {
  const apiError = res.apiError ?? extractApiError(res.data);

  if (apiError) {
    const key = resolveErrorMessageKey(apiError);
    if (!key) return t('common.error');
    return translateErrorMessage(t, key, buildErrorValues(apiError.detail, context));
  }

  return extractFastApiDetail(res.data);
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
        const detalle = buildErrorMessage(res, t, { filename: file.filename });
        const partes = [`HTTP ${res.status}`];
        if (detalle) partes.push(detalle);
        if (res.error) partes.push(res.error);
        setStatus({
          kind: 'error',
          // El mensaje del backend se traduce contra el catálogo; el status
          // y el error de red se muestran como vienen.
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
        const detalle = buildErrorMessage(res, t, { filename });
        const partes = [`HTTP ${res.status}`];
        if (detalle) partes.push(detalle);
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
