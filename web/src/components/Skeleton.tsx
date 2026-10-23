export function Skeleton({
  width = '100%',
  height = 16,
  className = '',
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return <span className={`sp-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}
