import { useProject } from '../lib/project-state';
import type { ModelType, ModelConfig } from '../lib/types';

type Props = {
  onValidChange?: (isValid: boolean) => void;
};

const MODEL_OPTIONS: Array<{
  value: ModelType;
  label: string;
  description: string;
  requiresKeepX: boolean;
  requiresClasses: boolean;
}> = [
  {
    value: 'PCA',
    label: 'PCA',
    description: 'Análisis de componentes principales (no supervisado).',
    requiresKeepX: false,
    requiresClasses: false,
  },
  {
    value: 'PLS-DA',
    label: 'PLS-DA',
    description: 'PLS para clasificación supervisada.',
    requiresKeepX: false,
    requiresClasses: true,
  },
  {
    value: 'sPLS-DA',
    label: 'sPLS-DA',
    description: 'PLS-DA + selección de variables (LASSO). Biomarcadores.',
    requiresKeepX: true,
    requiresClasses: true,
  },
  {
    value: 'DIABLO',
    label: 'DIABLO',
    description: 'Integración multi-bloque supervisada (block sPLS-DA).',
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
      aria-label="Configuración del modelo"
    >
      <div>
        <label htmlFor="model_type" className="label">
          Tipo de modelo
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
            {selectedOption.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="filename" className="label">
            Archivo de datos
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
                ? '— Elige un archivo —'
                : '— Carga un archivo en el paso 1 —'}
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
            Nº de componentes
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
            <code className="font-mono text-pharma-700">keepX</code> — variables por componente
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
            Cantidad de variables que el LASSO retiene por componente (1–1000).
          </p>
        </div>
      )}

      {!isValid && (
        <p
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2"
        >
          Faltan datos para ejecutar el análisis.{' '}
          {!requiresFile && 'Carga al menos un archivo en el paso 1. '}
          {cfg.filename.trim().length === 0 && requiresFile && 'Elige un archivo. '}
          {cfg.n_components < 1 || cfg.n_components > 10
            ? 'Nº de componentes debe estar entre 1 y 10. '
            : ''}
          {requiresKeepX && (cfg.keepX === undefined || cfg.keepX < 1)
            ? 'Indica keepX.'
            : ''}
        </p>
      )}
    </form>
  );
}