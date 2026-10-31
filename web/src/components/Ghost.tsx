/**
 * Pixel-art ghost mascot ("Boo", the BugBanisher).
 * Drawn as a 16x18 grid of rects so it stays crisp at any size and needs no
 * image assets (important for offline demo mode).
 */

interface GhostProps {
  size?: number;
  mood?: 'idle' | 'happy' | 'spooked' | 'banishing';
  /** Adds a gentle glow + float animation. */
  animate?: boolean;
  className?: string;
  title?: string;
}

const BODY = '#f4f1f7';
const SHADE = '#cfc7dd';
const EYES = '#1a1322';
const BLUSH = 'rgba(255, 155, 61, 0.55)';

export function Ghost({
  size = 96,
  mood = 'idle',
  animate = true,
  className = '',
  title = 'Boo the pixel ghost',
}: GhostProps) {
  const classes = ['ghost', animate ? 'ghost--float' : '', className].filter(Boolean).join(' ');
  const bodyFill = mood === 'banishing' ? '#7ef7b5' : BODY;
  const bodyShade = mood === 'banishing' ? '#4ddc93' : SHADE;

  return (
    <svg
      className={classes}
      width={size}
      height={(size / 16) * 18}
      viewBox="0 0 16 18"
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
      style={{ overflow: 'visible' }}
    >
      <title>{title}</title>
      {/* soft moonlight glow */}
      <ellipse cx="8" cy="17" rx="5.5" ry="0.9" fill="rgba(126,247,181,0.18)" />

      {/* body */}
      <path
        d="M3 1h10v1h1v1h1v13h-1v-1h-1v1h-1v1h-1v-1h-1v-1H8v1H7v1H6v-1H5v-1H4v1H3v1H2V3h1V2z"
        fill={bodyFill}
      />
      {/* shading on the right + bottom */}
      <rect x="13" y="3" width="1" height="11" fill={bodyShade} />
      <rect x="4" y="15" width="1" height="1" fill={bodyShade} />
      <rect x="8" y="16" width="1" height="1" fill={bodyShade} />
      <rect x="12" y="16" width="1" height="1" fill={bodyShade} />

      {/* eyes change with mood */}
      {mood === 'spooked' ? (
        <>
          <rect x="5" y="6" width="2" height="2" fill={EYES} />
          <rect x="9" y="6" width="2" height="2" fill={EYES} />
          <rect x="6" y="10" width="4" height="1" fill={EYES} />
          <rect x="5" y="11" width="1" height="1" fill={EYES} />
          <rect x="10" y="11" width="1" height="1" fill={EYES} />
        </>
      ) : mood === 'happy' || mood === 'banishing' ? (
        <>
          <rect x="5" y="6" width="2" height="1" fill={EYES} />
          <rect x="4" y="7" width="1" height="1" fill={EYES} />
          <rect x="7" y="7" width="1" height="1" fill={EYES} />
          <rect x="9" y="6" width="2" height="1" fill={EYES} />
          <rect x="8" y="7" width="1" height="1" fill={EYES} />
          <rect x="11" y="7" width="1" height="1" fill={EYES} />
          <rect x="6" y="10" width="1" height="1" fill={EYES} />
          <rect x="7" y="11" width="2" height="1" fill={EYES} />
          <rect x="9" y="10" width="1" height="1" fill={EYES} />
        </>
      ) : (
        <>
          <rect x="5" y="6" width="2" height="3" fill={EYES} />
          <rect x="9" y="6" width="2" height="3" fill={EYES} />
          <rect x="7" y="10" width="2" height="1" fill={EYES} />
          <rect x="4" y="9" width="1" height="1" fill={BLUSH} />
          <rect x="11" y="9" width="1" height="1" fill={BLUSH} />
        </>
      )}

      {/* little arms */}
      <rect x="1" y="9" width="1" height="3" fill={bodyShade} />
      <rect x="14" y="9" width="1" height="3" fill={bodyShade} />
    </svg>
  );
}
