import { CTA } from './CTA';
import { PixelIcon } from './PixelIcon';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="sp-state sp-error" role="alert">
      <PixelIcon name="info" size={32} />
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {onRetry ? (
        <CTA variant="secondary" icon="" onClick={onRetry}>
          Try again
        </CTA>
      ) : null}
    </div>
  );
}
