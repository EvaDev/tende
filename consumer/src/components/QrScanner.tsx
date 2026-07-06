import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';

// Camera QR scanner overlay. Starts the rear camera, decodes the first QR it sees,
// and returns the decoded text. Needs a real camera (won't work in a headless
// preview) — surfaces a friendly error if the camera can't start.
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const regionId = 'qr-reader-region';
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState('');

  useEffect(() => {
    const scanner = new Html5Qrcode(regionId);
    let done = false;
    let started = false;
    let cancelled = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 240 },
        (text) => {
          if (!done) {
            done = true;
            onResultRef.current(text);
          }
        },
        () => { /* ignore per-frame decode misses */ },
      )
      .then(() => { started = true; })
      .catch(() => {
        if (!cancelled) {
          setError('Couldn’t start the camera. Check permissions, or paste a tag/address instead.');
        }
      });

    return () => {
      cancelled = true;
      done = true;
      if (!started) {
        try { scanner.clear(); } catch { /* not started yet */ }
        return;
      }
      scanner.stop()
        .then(() => scanner.clear())
        .catch(() => { try { scanner.clear(); } catch { /* noop */ } });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col items-center justify-center px-6">
      <div className="flex items-center justify-between w-full max-w-xs mb-4">
        <p className="text-white font-semibold">Scan a QR code</p>
        <button onClick={onClose} aria-label="Close"><X size={22} className="text-white" /></button>
      </div>
      <div id={regionId} className="w-full max-w-xs rounded-2xl overflow-hidden bg-black aspect-square" />
      {error
        ? <p className="text-white text-sm mt-4 text-center">{error}</p>
        : <p className="text-white text-sm mt-4">Point at a payment QR code</p>}
      <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl bg-white/15 text-white font-medium active:scale-95">Cancel</button>
    </div>
  );
}

export default QrScanner;
