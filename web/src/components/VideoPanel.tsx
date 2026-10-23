export function VideoPanel({
  src,
  poster,
  label,
  className = '',
}: {
  src: string;
  poster: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`sp-video-panel ${className}`}>
      {/* decorative loop; preload none keeps ~90MB of MP4 off the initial load */}
      <video src={src} poster={poster} preload="none" muted loop playsInline aria-label={label} />
    </div>
  );
}
