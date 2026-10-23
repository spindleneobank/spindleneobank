import { CTA } from './CTA';
import { Dialog } from './Dialog';
import { PixelIcon } from './PixelIcon';

export function ComingSoonDialog({
  open,
  onClose,
  what = 'This',
}: {
  open: boolean;
  onClose: () => void;
  what?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Coming soon">
      <div className="sp-coming">
        <span className="sp-coming-symbol">
          <PixelIcon name="sunrise" size={34} />
        </span>
        <p>{what} is not live yet. We will publish it here as soon as it is.</p>
        <CTA variant="secondary" icon="" onClick={onClose}>
          Close
        </CTA>
      </div>
    </Dialog>
  );
}
