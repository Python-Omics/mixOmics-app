import { useEffect, useRef } from 'react';
import { buildKeepXSelection } from '../lib/api';
import { useProject } from '../lib/project-state';
import type {
  BackendModelType,
  BlockRef,
  KeepXValues,
} from '../lib/types';
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
  /** Bloques de la receta: de acá salen los nombres y las dimensiones. */
  blocks: BlockRef[];
};

/**
 * Parámetros propios de cada modelo.
 *
 * `n_components` es común y vive fuera del registro. Cada parámetro declara
 * cómo se renderiza; al sumar un modelo nuevo alcanza con registrar sus
 * parámetros acá, sin cambiar el formulario completo.
 */
type ParameterDef = {
  kind: 'keepX';
  labelKey: MessageKey;
  helpKey: MessageKey;
};

const MODEL_PARAMETERS: Record<BackendModelType, ParameterDef[]> = {
  PCA: [],
  DIABLO: [
    {
      kind: 'keepX',
      labelKey: 'model.keepXLabel',
      helpKey: 'model.keepXHelp',
    },
  ],
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

/** Acota un valor de keepX al rango válido del bloque. */
function parseKeepXValue(raw: string, max: number): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(0, Math.trunc(parsed)));
}

type KeepXParameterProps = {
  definition: Extract<ParameterDef, { kind: 'keepX' }>;
  blocks: BlockRef[];
  values: KeepXValues;
  onChange: (block: string, raw: string) => void;
};

/**
 * Control simple de selección de variables.
 *
 * Hay un único input por bloque: el número indica cuántas variables se
 * seleccionan por componente. El request repite ese valor para todos los
 * componentes del modelo.
 */
function KeepXParameter({
  definition,
  blocks,
  values,
  onChange,
}: KeepXParameterProps) {
  const t = useTranslate();
  const helpId = 'model-keepx-help';
  const variableBlocks = blocks.filter((block) => block.role === 'block');

  return (
    <fieldset className="space-y-3" aria-describedby={helpId}>
      <legend className="label">{t(definition.labelKey)}</legend>
      <p id={helpId} className="text-xs text-slate-500">
        {t(definition.helpKey)}
      </p>

      <ul className="space-y-2">
        {variableBlocks.map((block, blockIndex) => {
          const inputId = `model-keepx-${blockIndex}`;
          const infoId = `model-keepx-info-${blockIndex}`;
          const value = values[block.name];

          return (
            <li
              key={block.name}
              className="flex flex-wrap items-end justify-between gap-3 border-t border-pharma-200 pt-3"
            >
              <div id={infoId}>
                <span className="block font-mono text-sm font-medium text-slate-800">
                  {block.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {t('model.keepXBlockVariables', {
                    count: block.n_variables,
                  })}
                </span>
                <span className="block text-xs text-slate-500">
                  {t('model.keepXRange', { max: block.n_variables })}
                </span>
              </div>
              {/*
                El label del input es `sr-only`, y Tailwind posiciona
                `sr-only` en `absolute`. Sin un ancestro posicionado, su
                bloque contenedor es el viewport: el `overflow: auto` de
                <main> no lo recorta y el label se escapa del área
                scrolleable — el documento crece y aparece una segunda
                barra de scroll (la de la página) con un rectángulo
                vacío debajo del shell. Con `relative` el wrapper pasa a
                ser su bloque contenedor y el recorte de <main> vuelve a
                aplicar.
              */}
              <div className="relative w-24">
                <label htmlFor={inputId} className="sr-only">
                  {t('model.keepXInputLabel', { block: block.name })}
                </label>
                <input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={block.n_variables}
                  step={1}
                  className="input"
                  value={value ?? ''}
                  aria-describedby={`${helpId} ${infoId}`}
                  onChange={(event) =>
                    onChange(block.name, event.target.value)
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Form de configuración de modelo. Maneja su propia validación (los inputs)
 * y sincroniza con el estado global del proyecto.
 */
export function ModelConfigForm({
  onValidChange,
  supervisedAvailable,
  blocks,
}: Props) {
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
  const parametros = MODEL_PARAMETERS[modelo] ?? [];
  const keepXSelection = buildKeepXSelection(
    cfg.keepXValues,
    blocks,
    cfg.n_components,
  );

  const isValid =
    cfg.n_components >= 1 &&
    cfg.n_components <= 10 &&
    (!requiereClase || supervisedAvailable === true) &&
    (modelo !== 'DIABLO' || keepXSelection.valid);

  /** Actualiza un input y acota su valor al número de variables del bloque. */
  const cambiarKeepX = (blockName: string, raw: string) => {
    const block = blocks.find((candidate) => candidate.name === blockName);
    if (!block) return;

    const value = parseKeepXValue(raw, block.n_variables);
    const keepXValues = { ...cfg.keepXValues };
    if (value === null) {
      delete keepXValues[blockName];
    } else {
      keepXValues[blockName] = value;
    }
    setModelConfig({ keepXValues });
  };

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

      {parametros.map((parameter) => {
        if (parameter.kind === 'keepX') {
          return (
            <KeepXParameter
              key={parameter.kind}
              definition={parameter}
              blocks={blocks}
              values={cfg.keepXValues}
              onChange={cambiarKeepX}
            />
          );
        }
        return null;
      })}

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
