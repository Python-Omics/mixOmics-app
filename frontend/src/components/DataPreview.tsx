import type { PreviewData } from '../lib/project-state';

type Props = {
  filename: string;
  preview: PreviewData;
};

/**
 * Tabla compacta con las primeras N filas del CSV/TSV.
 * Solo lectura: es para que el biólogo confirme que cargó el archivo correcto.
 */
export function DataPreview({ filename, preview }: Props) {
  return (
    <div className="mt-3 border border-pharma-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-pharma-50 px-3 py-2 text-xs font-mono text-pharma-700 border-b border-pharma-200 flex justify-between items-center">
        <span>{filename}</span>
        <span>
          {preview.rows} filas × {preview.cols} columnas
        </span>
      </div>
      <div className="overflow-auto max-h-48">
        <table className="w-full text-xs font-mono">
          <tbody>
            {preview.sample.map((row, i) => (
              <tr
                key={i}
                className={i === 0 ? 'bg-pharma-50 font-semibold' : 'hover:bg-pharma-50'}
              >
                {row.slice(0, 6).map((cell, j) => (
                  <td
                    key={j}
                    className="px-2 py-1 border-r border-pharma-100 truncate max-w-[160px]"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
                {row.length > 6 && (
                  <td className="px-2 py-1 text-slate-500 italic">
                    +{row.length - 6} más
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}