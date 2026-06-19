import { useRef, useState } from 'react';

interface Props {
  currentSrc?: string;          // existing data URI or img src
  onUpload: (dataUri: string, mimeType: string) => Promise<void>;
  size?: number;                // display size in px
  label?: string;
}

export function LogoUpload({ currentSrc, onUpload, size = 80, label = 'Logo' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(currentSrc);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) { setError('Max 500 KB'); return; }
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUri = ev.target?.result as string;
      setPreview(dataUri);
      setUploading(true);
      try {
        await onUpload(dataUri, file.type);
      } catch {
        setError('Upload failed');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex-shrink-0 rounded-xl border-2 border-dashed border-gray-300 hover:border-brand-accent transition-colors overflow-hidden bg-gray-50"
        style={{ width: size, height: size }}
        title={`Upload ${label}`}
      >
        {preview ? (
          <img src={preview} alt={label} className="w-full h-full object-contain p-1" />
        ) : (
          <span className="flex flex-col items-center justify-center w-full h-full text-gray-400 text-xs gap-1">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Upload
          </span>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs text-gray-500">Saving…</div>
        )}
      </button>
      <div className="text-xs space-y-1">
        <p className="text-gray-500">{label}</p>
        <p className="text-gray-400">PNG, JPG, SVG · max 500 KB</p>
        {error && <p className="text-red-500">{error}</p>}
        {preview && !uploading && (
          <button type="button" onClick={() => inputRef.current?.click()} className="text-brand-accent hover:underline">
            Change
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleFile} />
    </div>
  );
}
