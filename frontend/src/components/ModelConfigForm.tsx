import { type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useProject } from '../lib/project-state';
import type { ModelType, ModelConfig } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Props = {
  onValidChange?: (isValid: boolean) => void;
};

/**
 * Función de fragmento de react-intl: recibe las partes del mensaje que
 * caen dentro de una etiqueta (`<code>`) y devuelve el nodo.
 */
type Chunks = (chunks: string[]) => ReactNode;

/**
 * Opciones de modelo. La descripción vive en el catálogo de mensajes
 * (`descriptionKey`): el copy es traducible, el nombre del modelo no.
 */
const MODEL_OPTIONS: Array<{
  value: ModelType;
  label: string;
  descriptionKey: MessageKey;
  requiresKeepX: boolean;
  requiresClasses: boolean;
}> = [
  {
    value: 'PCA',
    label: 'PCA',
    descriptionKey: 'model.descPCA',
    requiresKeepX: false,
    requiresClasses: false,
  },
  {
    value: 'PLS-DA',
    label: 'PLS-DA',
    descriptionKey: 'model.descPLSDA',
    requiresKeepX: false,
    requiresClasses: true,
  },
  {
    value: 'sPLS-DA',
    label: 'sPLS-DA',
    descriptionKey: 'model.descSPLSDA',
    requiresKeepX: true,
    requiresClasses: true,
  },
  {
    value: 'DIABLO',
    label: 'DIABLO',
    descriptionKey: 'model.descDIABLO',
    requiresKeepX: true,
    requiresClasses: true,
  },
];

/**
 * Form de configuración de modelo. Maneja su propia validación
 * (los inputs) y sincroniza con el estado global del proyecto.
 */
export function ModelConfigForm({ onValidChange }: Props) {
  const { state, setModelConfig } = useProject();
  const cfg = state.modelConfig;
  const t = useTranslate();
  const intl = useIntl();

  /**
   * Traduce un mensaje con marcado en línea.
   *
   * `useTranslate()` solo admite valores primitivos, así que las etiquetas
   * con marcado usan `intl.formatMessage` con funciones de fragmento. El
   * tipo de la clave se sigue validando contra el catálogo.
   */
  const rich = (id: MessageKey, values: Record<string, Chunks>) =>
    intl.formatMessage({ id }, values);

  /** Términos técnicos en monoespaciada (keepX). */
  const code: Chunks = (chunks) => (
    <code className="font-mono text-pharma-700">{chunks}</code>
  );

  const selectedOption = MODEL_OPTIONS.find((o) => o.value === cfg.model_type);
  const requiresKeepX = selectedOption?.requiresKeepX ?? false;
  const requiresFile = state.files.length > 0;

  const isValid =
    cfg.model_type !== undefined &&
    cfg.n_components >= 1 &&
    cfg.n_components <= 10 &&
    cfg.filename.trim().length > 0 &&
    (!requiresKeepX || (cfg.keepX !== undefined && cfg.keepX >= 1));

  // Notificar al padre (efecto secundario intencional al renderizar)
  if (onValidChange && isValid !== (cfg as ModelConfig & { __valid?: boolean }).__valid) {
    queueMicrotask(() => onValidChange(isValid));
    (cfg as ModelConfig & { __valid?: boolean }).__valid = isValid;
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t('model.formLabel')}
    >
      <div>
        <label htmlFor="model_type" className="label">
          {t('model.typeLabel')}
        </label>
        <select
          id="model_type"
          className="input"
          value={cfg.model_type}
          onChange={(e) => {
            const next = e.target.value as ModelType;
            const opt = MODEL_OPTIONS.find((o) => o.value === next);
            setModelConfig({
              model_type: next,
              // Si el nuevo modelo no requiere keepX, lo limpiamos
              keepX: opt?.requiresKeepX ? cfg.keepX ?? 50 : undefined,
            });
          }}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {selectedOption && (
          <p className="text-xs text-slate-500 mt-1">
            {t(selectedOption.descriptionKey)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="filename" className="label">
            {t('model.fileLabel')}
          </label>
          <select
            id="filename"
            className="input"
            value={cfg.filename}
            onChange={(e) => setModelConfig({ filename: e.target.value })}
            disabled={!requiresFile}
          >
            <option value="">
              {requiresFile
                ? t('model.chooseFile')
                : t('model.loadFileFirst')}
            </option>
            {state.files.map((f) => (
              <option key={f.filename} value={f.filename}>
                {f.filename}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="n_components" className="label">
            {t('model.componentsLabel')}
          </label>
          <input
            id="n_components"
            type="number"
            min={1}
            max={10}
            className="input"
            value={cfg.n_components}
            onChange={(e) =>
              setModelConfig({ n_components: Number(e.target.value) || 1 })
            }
          />
        </div>
      </div>

      {requiresKeepX && (
        <div>
          <label htmlFor="keepX" className="label">
            {rich('model.keepXLabel', { code })}
          </label>
          <input
            id="keepX"
            type="number"
            min={1}
            max={1000}
            className="input"
            value={cfg.keepX ?? 50}
            onChange={(e) =>
              setModelConfig({ keepX: Number(e.target.value) || 1 })
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            {t('model.keepXHelp')}
          </p>
        </div>
      )}

      {!isValid && (
        <p
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2"
        >
          {t('model.invalidMissing')}{' '}
          {!requiresFile && `${t('model.invalidNoFile')} `}
          {cfg.filename.trim().length === 0 &&
            requiresFile &&
            `${t('model.invalidNoSelection')} `}
          {cfg.n_components < 1 || cfg.n_components > 10
            ? `${t('model.invalidComponents')} `
            : ''}
          {requiresKeepX && (cfg.keepX === undefined || cfg.keepX < 1)
            ? t('model.invalidKeepX')
            : ''}
        </p>
      )}
    </form>
  );
}
