import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Figure, FigureKind, ModelResult } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { BiomarkersTable } from './BiomarkersTable';

type Props = {
  result: ModelResult;
  jobId: string;
};

/**
 * Etiqueta de cada tipo de figura (S27).
 *
 * El backend manda el `kind` como texto; el renderer lo traduce para que la
 * figura se pueda identificar sin saber la nomenclatura interna.
 */
const FIGURE_KIND_KEYS: Record<FigureKind, MessageKey> = {
  pca: 'results.figureKind.pca',
  biomarkers: 'results.figureKind.biomarkers',
  circos: 'results.figureKind.circos',
};

/**
 * Figura del análisis.
 *
 * La figura es binaria: viaja por el canal `api:file` como base64 y el
 * renderer arma un `blob:` URL (S27). El renderer nunca accede al puerto del
 * backend.
 */
function FigureImage({ jobId, figure }: { jobId: string; figure: Figure }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const t = useTranslate();
  // Guarda la URL creada para poder revocarla al desmontar.
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      const res = await api.getFigure(jobId, figure.name);
      if (!vivo) return;
      if (!res.ok || !res.data) {
        setFallo(true);
        return;
      }
      const binario = atob(res.data.dataBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i += 1) {
        bytes[i] = binario.charCodeAt(i);
      }
      const creada = URL.createObjectURL(
        new Blob([bytes], { type: res.data.mime }),
      );
      urlRef.current = creada;
      setUrl(creada);
    })();

    return () => {
      vivo = false;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [jobId, figure.name]);

  const clave = FIGURE_KIND_KEYS[figure.kind as FigureKind];
  const etiqueta = clave ? t(clave) : figure.kind;

  return (
    <figure className="space-y-2">
      {url && (
        <img
          src={url}
          alt={t('results.figureAlt', { kind: etiqueta })}
          className="max-w-full rounded border border-slate-200"
        />
      )}
      {!url && !fallo && (
        <p className="text-sm text-slate-500">{t('results.figureLoading')}</p>
      )}
      {fallo && (
        <p className="text-sm text-red-700">{t('results.figureError')}</p>
      )}
      <figcaption className="text-xs text-slate-500">{etiqueta}</figcaption>
    </figure>
  );
}

/**
 * Panel de resultados del análisis.
 *
 * Consume el `ModelResult` real del backend (`backend/app/schemas.py`): no
 * adivina la forma del resultado. Muestra las figuras (por el canal de
 * figuras), la varianza explicada, los biomarcadores, las correlaciones
 * entre bloques y la trazabilidad del análisis (RB-7).
 */
export function ResultsPanel({ result, jobId }: Props) {
  const t = useTranslate();

  const pares = Object.entries(result.correlations);

  return (
    <div className="space-y-4">
      {result.figures.length > 0 && (
        <section
          className="card p-6 space-y-3"
          aria-labelledby="results-figures-title"
        >
          <h3
            id="results-figures-title"
            className="text-sm font-semibold text-pharma-700"
          >
            {t('results.figuresTitle')}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {result.figures.map((figura) => (
              <FigureImage
                key={`${figura.name}-${figura.kind}`}
                jobId={jobId}
                figure={figura}
              />
            ))}
          </div>
        </section>
      )}

      {result.explained_variance_ratio &&
        result.explained_variance_ratio.length > 0 && (
          <section
            className="card p-6 space-y-2"
            aria-labelledby="results-variance-title"
          >
            <h3
              id="results-variance-title"
              className="text-sm font-semibold text-pharma-700"
            >
              {t('results.varianceTitle')}
            </h3>
            <ul className="text-sm text-slate-700 space-y-1">
              {result.explained_variance_ratio.map((valor, indice) => (
                <li key={indice} className="flex gap-3">
                  <span className="text-slate-500">
                    {t('biomarkers.component', { component: indice + 1 })}
                  </span>
                  <span className="font-mono">{valor.toFixed(4)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      {result.biomarkers.length > 0 && (
        <BiomarkersTable biomarkers={result.biomarkers} />
      )}

      {Object.keys(result.loadings).length > 0 && (
        <section
          className="card p-6 space-y-3"
          aria-labelledby="results-loadings-title"
        >
          <h3
            id="results-loadings-title"
            className="text-sm font-semibold text-pharma-700"
          >
            {t('results.loadingsTitle')}
          </h3>
          {Object.entries(result.loadings).map(([bloque, loadings]) => (
            <div key={bloque} className="space-y-1">
              <p className="font-mono text-xs text-slate-600">{bloque}</p>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-pharma-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-3 py-2">
                        {t('results.variableHeader')}
                      </th>
                      <th scope="col" className="px-3 py-2">
                        {t('results.componentHeader')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        {t('results.loadingValueHeader')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadings.map((loading) => (
                      <tr
                        key={`${loading.variable_id}-${loading.component}`}
                        className="border-t border-pharma-100"
                      >
                        <td className="px-3 py-1 font-mono text-xs">
                          {loading.variable_id}
                        </td>
                        <td className="px-3 py-1 text-slate-600">
                          {t('biomarkers.component', {
                            component: loading.component,
                          })}
                        </td>
                        <td className="px-3 py-1 text-right font-mono text-xs">
                          {loading.loading.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {Object.keys(result.scores).length > 0 && (
        <section
          className="card p-6 space-y-3"
          aria-labelledby="results-scores-title"
        >
          <h3
            id="results-scores-title"
            className="text-sm font-semibold text-pharma-700"
          >
            {t('results.scoresTitle')}
          </h3>
          {Object.entries(result.scores).map(([bloque, filas]) => (
            <div key={bloque} className="space-y-1">
              <p className="font-mono text-xs text-slate-600">{bloque}</p>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-pharma-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-3 py-2">
                        {t('results.sampleHeader')}
                      </th>
                      {(filas[0] ?? []).map((_valor, indice) => (
                        <th
                          key={indice}
                          scope="col"
                          className="px-3 py-2 text-right"
                        >
                          {t('biomarkers.component', { component: indice + 1 })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((fila, indiceFila) => (
                      <tr
                        key={indiceFila}
                        className="border-t border-pharma-100"
                      >
                        <td className="px-3 py-1 font-mono text-xs">
                          {indiceFila + 1}
                        </td>
                        {fila.map((valor, indiceColumna) => (
                          <td
                            key={indiceColumna}
                            className="px-3 py-1 text-right font-mono text-xs"
                          >
                            {valor.toFixed(4)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {pares.length > 0 && (
        <section
          className="card p-6 space-y-3"
          aria-labelledby="results-correlations-title"
        >
          <h3
            id="results-correlations-title"
            className="text-sm font-semibold text-pharma-700"
          >
            {t('results.correlationsTitle')}
          </h3>
          {pares.map(([clave, matriz]) => (
            <div key={clave} className="space-y-1">
              <p className="font-mono text-xs text-slate-600">{clave}</p>
              <table className="text-sm">
                <tbody>
                  {matriz.map((fila, indiceFila) => (
                    <tr key={indiceFila}>
                      {fila.map((valor, indiceColumna) => (
                        <td
                          key={indiceColumna}
                          className="px-3 py-1 font-mono text-xs text-slate-700"
                        >
                          {valor.toFixed(3)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      <section
        className="card p-6 space-y-2"
        aria-labelledby="results-provenance-title"
      >
        <h3
          id="results-provenance-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('results.provenanceTitle')}
        </h3>
        <dl className="text-sm text-slate-700 space-y-1">
          <div className="flex gap-3">
            <dt className="text-slate-500">{t('results.provenanceSeed')}</dt>
            <dd className="font-mono">{result.provenance.seed}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-slate-500">
              {t('results.provenanceVersions')}
            </dt>
            <dd className="font-mono">
              pythomics {result.provenance.pythomics_version}
              {result.provenance.r_version
                ? ` · R ${result.provenance.r_version}`
                : ''}
              {result.provenance.mixomics_version
                ? ` · mixOmics ${result.provenance.mixomics_version}`
                : ''}
            </dd>
          </div>
          {result.provenance.data_files.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-slate-500">
                {t('results.provenanceFiles')}
              </dt>
              <dd className="font-mono">
                {result.provenance.data_files
                  .map((archivo) => archivo.name)
                  .join(', ')}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <details className="card overflow-hidden">
        <summary className="px-4 py-3 border-b border-pharma-200 bg-pharma-50 text-sm font-semibold text-pharma-700 cursor-pointer">
          {t('results.rawTitle')}
        </summary>
        <pre className="p-4 text-xs font-mono overflow-auto max-h-96 bg-pharma-50 text-slate-800">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}
