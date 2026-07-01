// Brand "send / forward" motif — a double chevron (»), echoing the iMali app icon.
// Uses currentColor so it takes the surrounding text colour on any button (white on
// the maroon buttons, brand-accent elsewhere). Bump `strokeWidth` for more presence.
export function DoubleChevron({
  size = 18,
  strokeWidth = 2.5,
  className = '',
}: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <path d="M5 4 L14 12 L5 20" />
      <path d="M13 4 L22 12 L13 20" />
    </svg>
  );
}

export default DoubleChevron;
