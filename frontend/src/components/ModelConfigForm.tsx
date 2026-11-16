import { useEffect, useRef } from 'react';
import { useProject } from '../lib/project-state';
import type { BackendModelType } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Props = {
  onValidChange?: (isValid: boolean) => void;
  /**
   * Si el modelo supervisado puede ejecutarse.
   *
   * El DIABLO es supervisado: sin variable de clase el backend rechaza la
   * solicitud con `E_TARGET_COLUMN_MISSING`. La pantalla de configuración
   * sabe si hay una columna elegida y lo pasa por acá.
   */
  supervisedAvailable?: boolean;
};

/**
 * Opciones de modelo. Solo las que el backend acepta (S6, S31).
 *
 * El sPLS-DA mono-bloque está diferido a MVP+1: ofrecerlo sería prometer un
 * modelo que nadie implementa.
 *
 * La descripción vive en el catálogo de mensajes (`descriptionKey`): el copy
 * es traducible, el nombre del modelo no (nomenclatura científica en
 * inglés, RNF-U-3).
 */
const MODEL_OPTIONS: Array<{
  value: BackendModelType;
  label: string;
  descriptionKey: MessageKey;
  requiresClasses: boolean;
}> = [
  {
    value: 'PCA',
    label: 'PCA',
    descriptionKey: 'model.descPCA',
    requiresClasses: false,
  },
  {
    value: 'DIABLO',
    label: 'DIABLO',
    descriptionKey: 'model.descDIABLO',
    requiresClasses: true,
  },
];

/**
 * Form de configuración de modelo. Maneja su propia validación (los inputs)
 * y sincroniza con el estado global del proyecto.
 */
export function ModelConfigForm({ onValidChange, supervisedAvailable }: Props) {
  const { state, setModelConfig } = useProject();
  const cfg = state.modelConfig;
  const t = useTranslate();

  /**
   * El tipo de modelo vive en el estado del proyecto, que es compartido con
   * otras pantallas. Como el contrato del backend solo acepta PCA y DIABLO
   * (S6), un valor que no esté en el contrato se normaliza a PCA: el
   * catálogo de datasets de ejemplo sugiere `sPLS-DA` para uno de ellos.
   */
  const soportado = MODEL_OPTIONS.some((opcion) => opcion.value === cfg.model_type);
  useEffect(() => {
    if (!soportado) {
      setModelConfig({ model_type: 'PCA' });
    }
  }, [soportado, setModelConfig]);

  const selected = MODEL_OPTIONS.find((opcion) => opcion.value === cfg.model_type);
  const modelo: BackendModelType = selected?.value ?? 'PCA';
  const requiereClase = selected?.requiresClasses ?? false;

  const isValid =
    cfg.n_components >= 1 &&
    cfg.n_components <= 10 &&
    (!requiereClase || supervisedAvailable === true);

  // Aviso al padre cuando la validez cambia (no en cada render).
  const ultimaValidez = useRef<boolean | null>(null);
  useEffect(() => {
    if (!onValidChange) return;
    if (ultimaValidez.current === isValid) return;
    ultimaValidez.current = isValid;
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t('model.formLabel')}
    >
      <div
        role="radiogroup"
        aria-label={t('model.typeLabel')}
        className="flex flex-wrap items-center gap-4"
      >
        {MODEL_OPTIONS.map((opcion) => (
          <label key={opcion.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="model_type"
              value={opcion.value}
              checked={modelo === opcion.value}
              onChange={() => setModelConfig({ model_type: opcion.value })}
            />
            <span className="font-medium text-slate-800">{opcion.label}</span>
          </label>
        ))}
      </div>

      {selected && (
        <p className="text-xs text-slate-500">
          {t(selected.descriptionKey)}
        </p>
      )}

      <div className="max-w-xs">
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

      {!isValid && (
        <p
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2"
        >
          {t('model.invalidMissing')}{' '}
          {cfg.n_components < 1 || cfg.n_components > 10
            ? `${t('model.invalidComponents')} `
            : ''}
          {requiereClase && !supervisedAvailable
            ? t('model.invalidNoTarget')
            : ''}
        </p>
      )}
    </form>
  );
}
