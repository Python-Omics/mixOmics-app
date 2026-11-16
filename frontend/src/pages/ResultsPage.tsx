import { useCallback, useEffect, useState } from 'react';
import { useProject } from '../lib/project-state';
import { ResultsPanel } from '../components/ResultsPanel';
import {
  api,
  buildErrorMessage,
  buildErrorValues,
  resolveErrorMessageKey,
  type ApiErrorPayload,
  type ApiResponse,
  type Translate,
} from '../lib/api';
import type { Job, JobError, ProgressStage } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Props = {
  onBack: () => void;
  onRestart: () => void;
};

/**
 * Frecuencia del polling del job (S4, §5.7).
 *
 * El renderer es el dueño de la máquina de estados de la UI: consulta el
 * job hasta que llega a un estado terminal.
 */
const POLLING_MS = 700;

/**
 * Etiqueta de cada etapa del pipeline (S30).
 *
 * El progreso es POR ETAPA y sin porcentaje: la barra es indeterminada y
 * lleva la etiqueta de la etapa.
 */
const STAGE_MESSAGE_KEYS: Record<ProgressStage, MessageKey> = {
  queued: 'job.stage.queued',
  load: 'job.stage.load',
  align: 'job.stage.align',
  preprocess: 'job.stage.preprocess',
  fit: 'job.stage.fit',
  transform: 'job.stage.transform',
  figures: 'job.stage.figures',
};

/**
 * Traduce el error estructurado de un job fallido (S22, S28).
 *
 * El backend no traduce: manda `code` + `message_key` y el renderer
 * resuelve la clave contra el catálogo.
 */
function traducirErrorJob(error: JobError, t: Translate): string {
  const payload: ApiErrorPayload = {
    code: error.code,
    messageKey: error.message_key,
    detail: error.detail,
  };
  const key = resolveErrorMessageKey(payload);
  if (!key) return t('common.error');
  const texto = t(key, buildErrorValues(error.detail));
  return texto === key ? t('common.error') : texto;
}

export function ResultsPage({ onBack, onRestart }: Props) {
  const { state, setResult, reset } = useProject();
  const [job, setJob] = useState<Job | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslate();
  const jobId = state.jobId;

  /** Traduce el error de una respuesta no exitosa del backend. */
  const describirError = useCallback(
    (res: ApiResponse<unknown>) => {
      const detalle = buildErrorMessage(res, t);
      return t('results.backendError', {
        status: res.status,
        detail: detalle ? ` — ${detalle}` : '',
      });
    },
    [t],
  );

  /**
   * Polling del job.
   *
   * Consulta `GET /v1/jobs/{id}/` cada ~700 ms mientras el job esté en cola
   * o corriendo, y para en cuanto llega a un estado terminal.
   */
  useEffect(() => {
    if (!jobId) return;

    let vivo = true;
    let timer: number | undefined;

    const consultar = async () => {
      const res = await api.getJob(jobId);
      if (!vivo) return;

      if (!res.ok || !res.data) {
        setError(describirError(res));
        return;
      }

      const actual = res.data;
      setJob(actual);

      if (actual.status === 'completed') {
        if (actual.result) setResult(actual.result);
        return;
      }
      if (actual.status === 'failed' || actual.status === 'cancelled') return;

      timer = window.setTimeout(consultar, POLLING_MS);
    };

    void consultar();

    return () => {
      vivo = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId, setResult, describirError]);

  /** Cancela el job: el backend mata el proceso hijo del worker. */
  const cancelar = async () => {
    if (!jobId) return;
    setCancelando(true);
    setError(null);
    try {
      const res = await api.cancelJob(jobId);
      if (!res.ok) {
        setError(describirError(res));
        return;
      }
      // El job pasa a `cancelled`: el polling lo refleja en la próxima
      // consulta, y el estado local lo muestra de inmediato.
      setJob((anterior) =>
        anterior ? { ...anterior, status: 'cancelled' } : anterior,
      );
    } catch (err) {
      setError(
        t('results.backendUnreachable', { detail: (err as Error).message }),
      );
    } finally {
      setCancelando(false);
    }
  };

  const handleRestart = () => {
    reset();
    onRestart();
  };

  const etapa = job?.progress?.stage;
  const etiquetaEtapa = etapa ? t(STAGE_MESSAGE_KEYS[etapa]) : null;
  const enCurso = job?.status === 'queued' || job?.status === 'running';
  const fallido = job?.status === 'failed';
  const cancelado = job?.status === 'cancelled';

  const resultado = state.result;
  const modelo = resultado?.model_type ?? state.modelConfig.model_type;
  const componentes = resultado?.n_components ?? state.modelConfig.n_components;
  const bloques = resultado?.blocks ?? [];

  return (
    <div className="max-w-4xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-pharma-700">
            {t('results.title')}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {t('results.summaryModel')}{' '}
            <code className="font-mono text-pharma-700">{modelo}</code>
            {' · '}
            {t('results.summaryComponents')}{' '}
            <code className="font-mono text-pharma-700">{componentes}</code>
            {bloques.length > 0 && (
              <>
                {' · '}
                {t('results.summaryBlocks')}{' '}
                <code className="font-mono text-pharma-700">
                  {bloques.join(', ')}
                </code>
              </>
            )}
          </p>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          {error}
        </p>
      )}

      {!jobId && (
        <div className="card p-6 border-amber-200 bg-amber-50">
          <h3 className="text-sm font-semibold text-amber-900">
            {t('results.emptyTitle')}
          </h3>
          <p className="text-sm text-amber-800 mt-1">{t('results.emptyBody')}</p>
        </div>
      )}

      {jobId && enCurso && (
        <div className="card p-6 space-y-3">
          <p className="text-sm text-slate-700">{t('results.running')}</p>
          {/*
            Barra INDETERMINADA: el progreso es por etapa y no tiene
            porcentaje (S30), así que no lleva `aria-valuenow`.
          */}
          <div
            role="progressbar"
            aria-label={t('job.progressLabel')}
            className="h-2 w-full rounded-full bg-pharma-100 overflow-hidden"
          >
            <div className="h-full w-1/3 animate-pulse bg-pharma-500" />
          </div>
          <p className="text-sm text-slate-600">{etiquetaEtapa}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={cancelar}
            disabled={cancelando}
          >
            {cancelando ? t('results.cancelling') : t('results.cancel')}
          </button>
        </div>
      )}

      {jobId && cancelado && (
        <div className="card p-6 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">{t('results.cancelled')}</p>
        </div>
      )}

      {jobId && fallido && (
        <div
          role="alert"
          className="card p-6 border-red-200 bg-red-50"
        >
          <h3 className="text-sm font-semibold text-red-900">
            {t('results.failedTitle')}
          </h3>
          <p className="text-sm text-red-800 mt-1">
            {job?.error
              ? traducirErrorJob(job.error, t)
              : t('common.error')}
          </p>
        </div>
      )}

      {resultado && jobId && (
        <ResultsPanel result={resultado} jobId={jobId} />
      )}

      <footer className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('results.back')}
        </button>
        <button type="button" className="btn-ghost" onClick={handleRestart}>
          {t('results.restart')}
        </button>
      </footer>
    </div>
  );
}
