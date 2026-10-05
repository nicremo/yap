/* The yap mark: a Y whose fork encloses a four-pointed sparkle. Same
   geometry as assets/logo/mark.svg. */
const MARK_PATH =
  'M5,7 L19,7 L30,28 L41,7 L55,7 L35,42 L35,53 L25,53 L25,42 Z M30,25.5 C30.6,29.2 31.8,30.4 35.5,31 C31.8,31.6 30.6,32.8 30,36.5 C29.4,32.8 28.2,31.6 24.5,31 C28.2,30.4 29.4,29.2 30,25.5 Z';

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

/** The mark on the brand tile, used in the sidebar and the setup flow. */
export function LogoTile({ size = 32 }: { size?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <LogoMark size={size * 0.68} />
    </span>
  );
}
