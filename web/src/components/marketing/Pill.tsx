import { PixelIcon } from '../PixelIcon';

export function Pill({ children, tone = 'light' }: { children: string; tone?: 'light' | 'dark' }) {
  return (
    <span className="spm-pill" data-tone={tone}>
      <PixelIcon name="flower-pixel" size={12} />
      {children}
    </span>
  );
}
