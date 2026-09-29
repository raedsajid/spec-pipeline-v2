export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "compact" : ""}`}>
      <svg width="29" height="31" viewBox="0 0 29 31" aria-hidden="true">
        <path
          d="M3 27V4h12l10 9v14H3Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          d="M10 27V13h15M10 19h15M15 4v9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
      <span>
        Build<span className="brand-light">ERP</span>
      </span>
    </span>
  );
}
