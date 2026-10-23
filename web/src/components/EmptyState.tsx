import type { ReactNode } from 'react';
import { PixelIcon } from './PixelIcon';

export function EmptyState({
  icon = 'receipt',
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sp-state sp-empty" role="status">
      <PixelIcon name={icon} size={32} />
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
