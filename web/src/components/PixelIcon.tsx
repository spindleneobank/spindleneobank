import { iconAlias, iconDefinitions } from './pixelIcons.data';

export type PixelIconProps = { name: string; className?: string; size?: number; title?: string };

/** Port of pixel-icons.js: native integer-grid SVG, unknown names fall back to `info`. */
export function PixelIcon({ name, className = '', size = 20, title }: PixelIconProps) {
  const key = Object.hasOwn(iconDefinitions, name) ? name : (iconAlias[name] ?? 'info');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      shapeRendering="crispEdges"
      className={`sp-pixel-icon ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
      data-pixel-icon={key}
      dangerouslySetInnerHTML={{ __html: iconDefinitions[key] ?? '' }}
    />
  );
}
