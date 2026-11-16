import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelConfigForm } from '../components/ModelConfigForm';
import { api, buildErrorMessage, type ApiResponse } from '../lib/api';
import { useProject } from '../lib/project-state';
import type {
  Alignment,
  BackendModelType,
  Dataset,
  ModelRequest,
  TargetSpec,
} from '../lib/types';
import { useTranslate } from '../i18n';

type Props = {
  onBack: () => void;
  onNext: () => void;
};

/**
 * Pantalla de configuración del análisis.
 *
 * Tiene tres secciones (L23): **dataset**, **alineación** y **modelo**. El
 * preprocesamiento no aparece: está diferido (L18).
 *
 * El flujo es el que exige el backend (S3, S4):
 *
 *   1. al entrar se crea la receta de datos con los bloques del proyecto;
 *   2. la alineación se calcula sola (por ID, no por posición: RB-3);
 *   3. el usuario la confirma: sin esa confirmación el model request falla;
 *   4. el usuario elige la variable de clase (obligatoria para DIABLO);
 *   5. se encola el modelo y se navega a la pantalla de resultados.
 *
 * Si la receta ya existe (el usuario vuelve a esta pantalla), se recupera
 * con `GET /v1/datasets/{id}/`: no se crea una receta nueva.
 */
export function ConfigurePage({ onBack, onNext }: Props) {
  const { state, setDatasetId, setJobId, setResult } = useProject();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [target, setTarget] = useState<TargetSpec | null>(null);
  const [targetBlock, setTargetBlock] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const [modelValid, setModelValid] = useState(false);
  const [preparando, setPreparando] = useState(true);
  const [ejecutando, setEjecutando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslate();

  /** Traduce el error de una respuesta no exitosa del backend. */
  const describirError = useCallback(
    (res: ApiResponse<unknown>) => {
      const detalle = buildErrorMessage(res, t);
      return t('configure.backendError', {
        status: res.status,
        detail: detalle ? ` — ${detalle}` : '',
      });
    },
    [t],
  );

  /**
   * Prepara la receta: la crea si no existe y calcula la alineación.
   *
   * El guard con `useRef` evita el doble arranque de `StrictMode` (que
   * monta, desmonta y vuelve a montar los efectos en desarrollo): sin él se
   * crearían dos recetas.
   */
  const iniciado = useRef(false);

  const prepararReceta = async () => {
    setError(null);
    try {
      let receta: Dataset | null = null;

      if (state.datasetId) {
        // La receta ya existe: se recupera, no se crea otra.
        const res = await api.getDataset(state.datasetId);
        if (!res.ok || !res.data) {
          setError(describirError(res));
          return;
        }
        receta = res.data;
      } else {
        const entradas = state.files.map((archivo) => ({
          name: archivo.filename,
          role: archivo.role,
        }));
        if (entradas.length === 0) {
          setPreparando(false);
          return;
        }
        const res = await api.createDataset(entradas);
        if (!res.ok || !res.data) {
          setError(describirError(res));
          return;
        }
        receta = res.data;
        setDatasetId(receta.id);
      }

      setDataset(receta);
      setTarget(receta.target);

      // El bloque de la variable de clase: el de fenotipo si lo hay.
      const bloques = receta.blocks;
      const fenotipo = bloques.find((bloque) => bloque.role === 'metadata');
      setTargetBlock((fenotipo ?? bloques[0])?.name ?? '');

      if (receta.alignment) {
        setAlignment(receta.alignment);
        return;
      }

      // La alineación se calcula sola; la confirma el usuario (RF-2).
      const res = await api.alignDataset(receta.id, {
        blocks: bloques.map((bloque) => bloque.name),
        confirmed: false,
      });
      if (!res.ok || !res.data) {
        setError(describirError(res));
        return;
      }
      setAlignment(res.data);
    } catch (err) {
      setError(
        t('configure.backendUnreachable', { detail: (err as Error).message }),
      );
    } finally {
      setPreparando(false);
    }
  };

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    void prepararReceta();
    // La receta se prepara una sola vez, al entrar a la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Confirma la alineación: sin eso el model request falla. */
  const confirmarAlineacion = async () => {
    if (!dataset) return;
    setEjecutando(true);
    setError(null);
    try {
      const res = await api.alignDataset(dataset.id, {
        blocks: dataset.blocks.map((bloque) => bloque.name),
        confirmed: true,
      });
      if (!res.ok || !res.data) {
        setError(describirError(res));
        return;
      }
      setAlignment(res.data);
    } catch (err) {
      setError(
        t('configure.backendUnreachable', { detail: (err as Error).message }),
      );
    } finally {
      setEjecutando(false);
    }
  };

  /** Fija la variable de clase en la receta (S38). */
  const fijarVariableDeClase = async (
    bloque: string,
    columna: string,
  ) => {
    if (!dataset) return;
    const nuevo: TargetSpec = { block: bloque, column: columna };
    setTarget(nuevo);
    setError(null);
    try {
      const res = await api.setDatasetTarget(dataset.id, nuevo);
      if (!res.ok) {
        setError(describirError(res));
        return;
      }
      if (res.data) setDataset(res.data);
    } catch (err) {
      setError(
        t('configure.backendUnreachable', { detail: (err as Error).message }),
      );
    }
  };

  /** Encola el modelo y navega a la pantalla de resultados. */
  const ejecutarAnalisis = async () => {
    if (!dataset || !puedeEjecutar) return;
    setEjecutando(true);
    setError(null);
    setResult(null);

    const modelo: BackendModelType =
      state.modelConfig.model_type === 'DIABLO' ? 'DIABLO' : 'PCA';
    const solicitud: ModelRequest = {
      dataset_id: dataset.id,
      model_type: modelo,
      n_components: state.modelConfig.n_components,
      seed: state.seed,
      ...(target ? { target } : {}),
    };

    try {
      const res = await api.runModel(solicitud);
      if (!res.ok || !res.data) {
        setError(describirError(res));
        return;
      }
      setJobId(res.data.job_id);
      onNext();
    } catch (err) {
      setError(
        t('configure.backendUnreachable', { detail: (err as Error).message }),
      );
    } finally {
      setEjecutando(false);
    }
  };

  const alineacionConfirmada = alignment?.confirmed === true;
  const puedeEjecutar =
    Boolean(dataset) && alineacionConfirmada && modelValid && !ejecutando;

  /** Columnas del bloque elegido para la variable de clase. */
  const columnas = state.files.find(
    (archivo) => archivo.filename === targetBlock,
  )?.block?.columns;

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-pharma-700">
          {t('configure.title')}
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          {t('configure.description')}
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          {error}
        </p>
      )}

      {/* ── Dataset ─────────────────────────────────────────────────────── */}
      <section
        className="card p-6 space-y-3"
        aria-labelledby="configure-dataset-title"
      >
        <h3
          id="configure-dataset-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('configure.datasetTitle')}
        </h3>

        {preparando && (
          <p className="text-sm text-slate-600">{t('configure.datasetPreparing')}</p>
        )}

        {!preparando && !dataset && (
          <p className="text-sm text-amber-800">{t('configure.noFiles')}</p>
        )}

        {dataset && (
          <>
            <p className="text-xs text-slate-500 font-mono">
              {t('configure.datasetSession', { id: dataset.id })}
            </p>
            <ul className="space-y-1">
              {dataset.blocks.map((bloque) => (
                <li
                  key={bloque.name}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="font-mono text-slate-800">{bloque.name}</span>
                  <span className="text-slate-600">
                    {t('ingest.dimensions', {
                      samples: bloque.n_samples,
                      variables: bloque.n_variables,
                    })}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-pharma-600">
                    {t(
                      bloque.role === 'metadata'
                        ? 'configure.roleMetadata'
                        : 'configure.roleBlock',
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Alineación ──────────────────────────────────────────────────── */}
      <section
        className="card p-6 space-y-3"
        aria-labelledby="configure-alignment-title"
      >
        <h3
          id="configure-alignment-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('configure.alignmentTitle')}
        </h3>

        {!alignment && (
          <p className="text-sm text-slate-600">
            {t('configure.alignmentPending')}
          </p>
        )}

        {alignment && (
          <>
            <p className="text-sm text-slate-700">
              {t('configure.alignmentCommon', {
                count: alignment.sample_ids.length,
              })}
            </p>
            <ul className="space-y-1">
              {Object.entries(alignment.discarded).map(([bloque, ids]) => (
                <li key={bloque} className="text-sm text-slate-600">
                  {t('configure.alignmentDiscarded', {
                    block: bloque,
                    count: ids.length,
                  })}
                </li>
              ))}
            </ul>

            {alineacionConfirmada ? (
              <p className="text-sm font-medium text-pharma-700">
                {t('configure.alignmentConfirmed')}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={confirmarAlineacion}
                  disabled={ejecutando}
                >
                  {ejecutando
                    ? t('configure.alignmentConfirming')
                    : t('configure.alignmentConfirm')}
                </button>
                <p className="text-sm text-amber-800">
                  {t('configure.alignmentNeedConfirm')}
                </p>
              </>
            )}
          </>
        )}
      </section>

      {/* ── Modelo ───────────────────────────────────────────────────────── */}
      <section
        className="card p-6 space-y-4"
        aria-labelledby="configure-model-title"
      >
        <h3
          id="configure-model-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('configure.modelTitle')}
        </h3>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-700">
            {t('configure.targetTitle')}
          </h4>
          <p className="text-xs text-slate-500">
            {t('configure.targetOptional')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="target_block" className="label">
                {t('configure.targetBlockLabel')}
              </label>
              <select
                id="target_block"
                className="input"
                value={targetBlock}
                onChange={(e) => {
                  setTargetBlock(e.target.value);
                  // Cambiar de bloque invalida la columna elegida: la
                  // variable de clase se vuelve a fijar.
                  setTargetColumn('');
                  setTarget(null);
                }}
              >
                {(dataset?.blocks ?? []).map((bloque) => (
                  <option key={bloque.name} value={bloque.name}>
                    {bloque.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="target_column" className="label">
                {t('configure.targetColumnLabel')}
              </label>
              <select
                id="target_column"
                className="input"
                value={targetColumn}
                onChange={(e) => {
                  setTargetColumn(e.target.value);
                  if (e.target.value) {
                    void fijarVariableDeClase(targetBlock, e.target.value);
                  }
                }}
              >
                <option value="">{t('configure.targetColumnNone')}</option>
                {(columnas ?? []).map((columna) => (
                  <option key={columna} value={columna}>
                    {columna}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <ModelConfigForm
          onValidChange={setModelValid}
          supervisedAvailable={Boolean(target)}
        />
      </section>

      <footer className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('configure.back')}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={ejecutarAnalisis}
          disabled={!puedeEjecutar}
        >
          {ejecutando ? t('configure.running') : t('configure.run')}
        </button>
      </footer>
    </div>
  );
}
