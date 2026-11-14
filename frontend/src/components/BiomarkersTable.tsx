import type { Biomarker } from '../lib/types';
import { useTranslate } from '../i18n';

type Props = {
  biomarkers: Biomarker[];
};

/**
 * Tabla de biomarcadores seleccionados por el análisis.
 * Si el resultado no contiene biomarkers, el padre debe ocultar este componente.
 */
export function BiomarkersTable({ biomarkers }: Props) {
  const t = useTranslate();

  if (biomarkers.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-pharma-200 bg-pharma-50">
        <h3 className="text-sm font-semibold text-pharma-700">
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
              <tr key={`${b.variable_id}-${i}`} className="border-t border-pharma-100 hover:bg-pharma-50">
                <td className="px-4 py-2 font-mono text-xs">{b.variable_id}</td>
                <td className="px-4 py-2 text-slate-600">
                  {t('biomarkers.component', { component: b.component })}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {b.loading.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right text-slate-500 text-xs">
                  {b.stability !== undefined ? b.stability.toFixed(3) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
