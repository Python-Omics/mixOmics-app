import type { IngestWarning } from '../lib/types';
import type { FileRole, UploadedFile } from '../lib/project-state';
import { useTranslate, type Translate } from '../i18n';
import { CATALOG_KEYS, type MessageKey } from '../i18n/messages';

/**
 * Claves de warning de ingesta que la UI conoce.
 *
 * El backend puede agregar códigos nuevos. Para no mostrar una clave cruda,
 * una clave desconocida cae en el mensaje genérico aunque esté en el
 * catálogo.
 */
const SUPPORTED_INGEST_WARNING_KEYS: ReadonlySet<string> = new Set([
  'ingest.warnings.nonNumericColumns',
  'ingest.warnings.encodingRepaired',
]);

/**
 * Resuelve la `message_key` de un warning contra el catálogo.
 *
 * Devuelve null si la clave no existe o si el renderer todavía no conoce ese
 * tipo de warning; en ambos casos la UI muestra un texto genérico.
 */
function resolveWarningMessageKey(messageKey: string): MessageKey | null {
  if (
    !CATALOG_KEYS.has(messageKey) ||
    !SUPPORTED_INGEST_WARNING_KEYS.has(messageKey)
  ) {
    return null;
  }
  return messageKey as MessageKey;
}

/**
 * Traduce un warning de ingesta sin exponer nunca su clave cruda.
 */
function translateWarning(t: Translate, warning: IngestWarning): string {
  const key = resolveWarningMessageKey(warning.message_key);
  if (!key) return t('ingest.warningGeneric');

  const text = t(key, {
    columns: warning.columns?.join(', ') ?? '',
  });
  return text === key ? t('ingest.warningGeneric') : text;
}

type Props = {
  /** Archivo al que pertenece la descripción. */
  file: UploadedFile;
  /**
   * Callback para cambiar el rol del archivo (bloque de variables o tabla
   * de metadata). Lo inyecta la página que tiene el estado del proyecto.
   */
  onRoleChange?: (filename: string, role: FileRole) => void;
};

/**
 * Descripción de un archivo cargado.
 *
 * Resume lo que el backend informó de la ingesta (dimensiones, columna de
 * IDs, variables numéricas) y deja cambiar el rol del archivo.
 *
 * No es una tarjeta propia: se compone DENTRO de la tarjeta del archivo,
 * al lado de la preview, para que quede claro a qué archivo pertenece.
 */
export function FileDetails({ file, onRoleChange }: Props) {
  const t = useTranslate();
  const block = file.block;

  // Sin resumen de ingesta no hay nada que describir.
  if (!block) return null;

  return (
    <section aria-label={t('ingest.summaryTitle')} className="space-y-3">
      <div>
        <h3 className="font-semibold text-pharma-700">{block.name}</h3>
        <p className="text-sm text-slate-600 mt-1">
          {t('ingest.dimensions', {
            samples: block.n_samples,
            variables: block.n_variables,
          })}
        </p>
        {/*
          Clasificación del bloque:
            - el rol lo declara el origen del archivo (`role`): la
              tabla de metadata (fenotipo) se anuncia como tal;
            - `n_numeric_variables < n_variables` informa cuántas
              columnas son numéricas por dtype (el backend además
              avisa por su cuenta con un warning).
        */}
        {file.role === 'metadata' && (
          <p className="text-sm text-slate-600 mt-1">
            {t('ingest.metadataBlock')}
          </p>
        )}
        {block.n_numeric_variables < block.n_variables && (
          <p className="text-sm text-slate-600 mt-1">
            {t('ingest.numericVariables', {
              count: block.n_numeric_variables,
            })}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-1">
          {t('ingest.sampleIdColumn', {
            column: block.sample_id_column,
          })}
        </p>
      </div>

      {/*
        Control de rol: el usuario decide si el archivo aporta variables
        al modelo o si es la tabla de metadata del estudio. El rol NO lo
        deduce el dtype (ver `FileRole` en `lib/project-state.tsx`): una
        tabla de metadata puede tener todas sus columnas numéricas.

        `aria-pressed` comunica si el archivo está marcado como tabla de
        metadata; la etiqueta dice la acción disponible.
      */}
      <button
        type="button"
        className="btn-secondary w-full justify-center"
        aria-pressed={file.role === 'metadata'}
        onClick={() =>
          onRoleChange?.(
            file.filename,
            file.role === 'metadata' ? 'block' : 'metadata',
          )
        }
      >
        {file.role === 'metadata'
          ? t('ingest.markAsBlock')
          : t('ingest.markAsMetadata')}
      </button>

      {file.warnings && file.warnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <h4 className="text-sm font-medium text-amber-900">
            {t('ingest.warningsTitle')}
          </h4>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {file.warnings.map((warning, index) => (
              <li
                key={`${warning.code}-${index}`}
                className="text-sm text-amber-900"
              >
                {translateWarning(t, warning)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
