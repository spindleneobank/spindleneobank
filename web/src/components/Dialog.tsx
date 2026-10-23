import { type ReactNode, useEffect, useRef } from 'react';
import { PixelIcon } from './PixelIcon';

/** Modal built on the native <dialog>: focus trap, Esc and inert background come from the platform. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sp-dialog"
      aria-label={title}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sp-dialog-body">
        <button type="button" className="sp-dialog-close" aria-label="Close" onClick={onClose}>
          <PixelIcon name="close" size={16} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
