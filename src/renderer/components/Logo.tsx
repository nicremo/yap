import logoUrl from '../logo.png';

/** The approved Yap tile: the glossy black Y with its star on ice blue. */
export function LogoImage({ className, size }: { className?: string; size?: number }) {
  return <img className={className} src={logoUrl} alt="Yap" width={size} height={size} draggable={false} />;
}
