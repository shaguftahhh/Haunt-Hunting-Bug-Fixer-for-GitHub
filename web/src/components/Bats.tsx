/**
 * Decorative bat silhouettes drifting across the header.
 * Purely cosmetic: aria-hidden, pointer-events none, and frozen when the user
 * prefers reduced motion (handled in CSS).
 */

const BAT_PATH =
  'M12 8c-2 0-3 1.5-4 3-1-1.5-2-3-4-3-2.5 0-4 2-4 4 0 1 .5 2 1.5 2.5C2.5 15 3 16 4 16c1.5 0 2.5-1 3.5-2.5C8.5 15 10 16 12 16c2 0 3.5-1 4.5-2.5C17.5 15 18.5 16 20 16c1 0 1.5-1 1.5-1.5C22.5 14 23 13 23 12c0-2-1.5-4-4-4-2 0-3 1.5-4 3-1-1.5-2-3-4-3z';

export function Bats() {
  return (
    <div className="bats" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <svg
          key={i}
          className={`bat bat--${i + 1}`}
          viewBox="0 0 24 20"
          width={i % 2 === 0 ? 26 : 18}
          height={i % 2 === 0 ? 22 : 16}
        >
          <path d={BAT_PATH} fill="currentColor" opacity={0.55 - i * 0.08} />
        </svg>
      ))}
    </div>
  );
}
