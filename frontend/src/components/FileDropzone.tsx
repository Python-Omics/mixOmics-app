import {
  useCallback,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import type { UploadedFile, PreviewData } from '../lib/project-state';
import { FileIcon } from './icons';

type Props = {
  onFileAdded: (file: UploadedFile & { preview: PreviewData }) => void;
};

const ACCEPTED_EXT = ['.csv', '.tsv'] as const;

/**
 * Parsea las primeras N líneas del texto como preview.
 * Maneja separador CSV (,) o TSV (\t).
 */
function parsePreview(text: string, sep: string): PreviewData {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const sample = lines.slice(0, 6).map((line) => line.split(sep));
  const cols = sample[0]?.length ?? 0;
  return { rows: lines.length, cols, sample };
}

export function FileDropzone({ onFileAdded }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setReading(true);

      try {
        for (const file of Array.from(files)) {
          const lower = file.name.toLowerCase();
          const ext = ACCEPTED_EXT.find((e) => lower.endsWith(e));
          if (!ext) {
            setError(
              `Formato no soportado: "${file.name}". Solo se aceptan .csv o .tsv.`,
            );
            continue;
          }

          const sep = ext === '.tsv' ? '\t' : ',';
          const text = await file.text();
          const preview = parsePreview(text, sep);

          if (preview.rows === 0) {
            setError(`"${file.name}" está vacío.`);
            continue;
          }

          onFileAdded({
            filename: file.name,
            size: file.size,
            uploadedAt: Date.now(),
            preview,
          });
        }
      } finally {
        setReading(false);
      }
    },
    [onFileAdded],
  );

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = ''; // permite re-cargar el mismo archivo
  };

  return (
    <div>
      <label
        htmlFor="file-input"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`block border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-pharma-400 bg-pharma-100'
            : 'border-pharma-200 hover:border-pharma-400 hover:bg-pharma-50'
        }`}
        aria-label="Arrastra archivos CSV o TSV, o haz clic para elegirlos"
      >
        <input
          id="file-input"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          multiple
          onChange={onChange}
          className="sr-only"
          aria-describedby="file-help"
        />
        <div className="mb-3 text-pharma-500">
          <FileIcon className="w-12 h-12 mx-auto" />
        </div>
        <p className="text-slate-700 font-medium">
          Arrastra tus archivos <code className="font-mono text-pharma-700">.csv</code>{' '}
          o <code className="font-mono text-pharma-700">.tsv</code>
        </p>
        <p id="file-help" className="text-sm text-slate-500 mt-1">
          {reading
            ? 'Leyendo…'
            : 'o haz clic para elegirlos desde tu equipo'}
        </p>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}