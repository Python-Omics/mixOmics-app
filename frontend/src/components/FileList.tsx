import { DataPreview } from './DataPreview';
import type { UploadedFile } from '../lib/project-state';
import { ChartIcon, CloseIcon } from './icons';

type Props = {
  files: UploadedFile[];
  onRemove: (filename: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileList({ files, onRemove }: Props) {
  if (files.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="Archivos cargados">
      {files.map((f) => (
        <li key={f.filename} className="card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-pharma-500">
                  <ChartIcon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-sm text-slate-900 truncate">
                    {f.filename}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatSize(f.size)} ·{' '}
                    {new Date(f.uploadedAt).toLocaleTimeString('es-CL')}
                  </p>
                </div>
              </div>
              {f.preview && (
                <DataPreview filename={f.filename} preview={f.preview} />
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(f.filename)}
              className="btn-ghost text-red-700 hover:bg-red-50"
              aria-label={`Quitar ${f.filename}`}
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}