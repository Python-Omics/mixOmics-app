import type { PreviewData } from '../lib/project-state';
import { useTranslate } from '../i18n';

type Props = {
  filename: string;
  preview: PreviewData;
};

/**
 * Tabla compacta con las primeras N filas del CSV/TSV.
 * Solo lectura: es para que el biólogo confirme que cargó el archivo correcto.
 */
export function DataPreview({ filename, preview }: Props) {
  const t = useTranslate();
  const maxVisibleColumns = 6;
  const visibleColumns = preview.columns.slice(0, maxVisibleColumns);
  const hiddenColumnCount = preview.columns.length - visibleColumns.length;

  return (
    <div className="border border-pharma-200 rounded-lg overflow-hidden bg-white">
      {/*
        El encabezado se apila solo si la columna es angosta: los dos
        rótulos no se pisan ni se parten a la mitad.
      */}
      <div className="bg-pharma-50 px-3 py-2 text-xs font-mono text-pharma-700 border-b border-pharma-200 flex flex-wrap justify-between items-center gap-x-3 gap-y-1">
        <span className="whitespace-nowrap">{filename}</span>
        <span className="whitespace-nowrap">
          {t('preview.dimensions', {
            rows: preview.rows.length,
            cols: preview.columns.length,
          })}
        </span>
      </div>
      <div className="overflow-auto max-h-48">
        <table className="w-full text-xs font-mono">
          <thead className="bg-pharma-50 font-semibold">
            <tr>
              {visibleColumns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  scope="col"
                  className="px-2 py-1 border-r border-pharma-100 text-left truncate max-w-[160px]"
                  title={column}
                >
                  {column}
                </th>
              ))}
              {hiddenColumnCount > 0 && (
                <th scope="col" className="px-2 py-1 text-slate-500 italic">
                  {t('preview.moreColumns', { count: hiddenColumnCount })}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-pharma-50">
                {visibleColumns.map((_column, columnIndex) => {
                  const cell = row[columnIndex] ?? '';
                  return (
                    <td
                      key={columnIndex}
                      className="px-2 py-1 border-r border-pharma-100 truncate max-w-[160px]"
                      title={cell}
                    >
                      {cell}
                    </td>
                  );
                })}
                {hiddenColumnCount > 0 && (
                  <td className="px-2 py-1 text-slate-500 italic" />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
