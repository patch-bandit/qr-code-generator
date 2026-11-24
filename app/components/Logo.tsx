/** The Bandit Codes mark. Same shapes as app/icon.svg (a test keeps them in step). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#140a22" />
      <g fill="#fff2de">
        <path fillRule="evenodd" d="M10 14a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Zm6 2h8v8h-8Z" />
        <path fillRule="evenodd" d="M34 14a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4Zm6 2h8v8h-8Z" />
        <path fillRule="evenodd" d="M10 38a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Zm6 2h8v8h-8Z" />
        <rect x="18" y="18" width="4" height="4" rx="1" />
        <rect x="42" y="18" width="4" height="4" rx="1" />
        <rect x="18" y="42" width="4" height="4" rx="1" />
        <rect x="45" y="34" width="9" height="9" rx="2.4" />
        <rect x="34" y="45" width="9" height="9" rx="2.4" />
      </g>
      <g fill="#86e3be">
        <rect x="34" y="34" width="9" height="9" rx="2.4" />
        <rect x="45" y="45" width="9" height="9" rx="2.4" />
      </g>
    </svg>
  );
}
