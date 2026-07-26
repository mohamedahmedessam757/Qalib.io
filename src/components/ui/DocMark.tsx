export function DocMark({ className = "h-40 w-40" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="qalibGlass" x1="30" y1="20" x2="170" y2="180">
          <stop stopColor="#2DD4BF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#60A5FA" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="qalibSheet" x1="60" y1="40" x2="150" y2="160">
          <stop stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect
        x="28"
        y="28"
        width="144"
        height="144"
        rx="36"
        fill="url(#qalibGlass)"
        opacity="0.18"
      />
      <path
        d="M58 46h70c8 0 14 6 14 14v92c0 8-6 14-14 14H58c-8 0-14-6-14-14V60c0-8 6-14 14-14Z"
        fill="url(#qalibSheet)"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1.5"
      />
      <path
        d="M112 46v28c0 6 5 11 11 11h27"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.5"
      />
      <rect x="68" y="92" width="64" height="6" rx="3" fill="#2DD4BF" opacity="0.85" />
      <rect x="68" y="110" width="52" height="6" rx="3" fill="rgba(255,255,255,0.35)" />
      <rect x="68" y="128" width="40" height="6" rx="3" fill="rgba(255,255,255,0.22)" />
    </svg>
  );
}
