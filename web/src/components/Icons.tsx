/**
 * Inline SVG icons. No icon library, no network requests.
 * Every icon is aria-hidden; the surrounding button/label carries the name.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: ['icon', className].filter(Boolean).join(' '),
  'aria-hidden': true,
  focusable: false,
});

export const GitHubIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)} stroke="none" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.48A10.06 10.06 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
  </svg>
);

export const KeyIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.85 12.15 19 4m-3 0h3v3" />
  </svg>
);

export const SearchIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const ShieldIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const SparkIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);

export const BugIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="8" y="7" width="8" height="12" rx="4" />
    <path d="M8 11H4m16 0h-4M8 15H5m14 0h-3M8 7 6 5m10 2 2-2M9 19l-1.5 2M15 19l1.5 2M12 7V5" />
  </svg>
);

export const WrenchIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 21l-3 0-8.5-8.5a4 4 0 0 1-5-5L7 4l3 0 4.7 4.7" />
  </svg>
);

export const DiffIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16M7 9h2m-2 4h2m6-4h2m-2 4h2" />
  </svg>
);

export const CheckIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m4 12 5 5L20 6" />
  </svg>
);

export const XIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
);

export const BranchIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="6" cy="5" r="2.5" />
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="9" r="2.5" />
    <path d="M6 7.5v9M18 11.5c0 3-3 4.5-6 4.5H8.5" />
  </svg>
);

export const HistoryIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </svg>
);

export const BookIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
    <path d="M4 19a2 2 0 0 1 2-2h13" />
  </svg>
);

export const ArrowLeftIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M19 12H5m6-7-7 7 7 7" />
  </svg>
);

export const GhostTrailIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 21V8a6 6 0 0 1 12 0v13l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z" />
    <path d="M9.5 10h.01M14.5 10h.01" />
  </svg>
);
