import type { Biomarker } from '../lib/types';
import { useTranslate } from '../i18n';

type Props = {
  biomarkers: Biomarker[];
};

/**
 * Tabla de biomarcadores seleccionados por el análisis.
 *
 * La lista es PLANA: los biomarcadores de todos los bloques vienen en la
 * misma lista, y el bloque de cada uno dice de dónde salió.
 *
 * `stability` es opcional y el backend la manda en `null` cuando el modelo
 * no la reporta: se trata como ausente (un `null.toFixed(3)` reventaría).
 */
export function BiomarkersTable({ biomarkers }: Props) {
  const t = useTranslate();

  if (biomarkers.length === 0) return null;

  return (
    <section className="card overflow-hidden" aria-labelledby="biomarkers-title">
      <div className="px-4 py-3 border-b border-pharma-200 bg-pharma-50">
        <h3
          id="biomarkers-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('biomarkers.title')}
        </h3>
        <p className="text-xs text-pharma-500 mt-0.5">
          {t('biomarkers.count', { count: biomarkers.length })}
        </p>
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead className="bg-pharma-50 sticky top-0">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-4 py-2">
                {t('biomarkers.variableHeader')}
              </th>
              <th scope="col" className="px-4 py-2">
                {t('biomarkers.blockHeader')}
              </th>
              <th scope="col" className="px-4 py-2">
                {t('biomarkers.componentHeader')}
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                {t('biomarkers.loadingHeader')}
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                {t('biomarkers.stabilityHeader')}
              </th>
            </tr>
          </thead>
          <tbody>
            {biomarkers.map((b, i) => (
              <tr
                key={`${b.variable_id}-${i}`}
                className="border-t border-pharma-100 hover:bg-pharma-50"
              >
                <td className="px-4 py-2 font-mono text-xs">{b.variable_id}</td>
                <td className="px-4 py-2 text-slate-600 text-xs">
                  {b.block ?? '—'}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {t('biomarkers.component', { component: b.component })}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {b.loading.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right text-slate-500 text-xs">
                  {typeof b.stability === 'number' ? b.stability.toFixed(3) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
