import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatCents, formatMicros, formatMicrosExact, Money, tinyMicros } from '../Money';

describe('formatMicros', () => {
  it('formats micro strings with bigint math', () => {
    expect(formatMicros('12500000')).toBe('12.50');
    expect(formatMicros('0')).toBe('0.00');
    expect(formatMicros('1')).toBe('0.00');
    expect(formatMicros('500000')).toBe('0.50');
    expect(formatMicros('1234567890123456789')).toBe('1,234,567,890,123.46');
  });
  it('rounds half up and keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatMicros('9007199254740993123456', { fractionDigits: 6 })).toBe(
      '9,007,199,254,740,993.123456',
    );
    expect(formatMicros('1005000')).toBe('1.01');
  });
  it('handles negatives and cents', () => {
    expect(formatMicros('-12500000')).toBe('-12.50');
    expect(formatMicros('-1')).toBe('0.00');
    expect(formatCents('1250')).toBe('12.50');
  });
  it('renders the Money component with unit', () => {
    render(<Money micros="12500000" />);
    expect(screen.getByText(/12\.50/)).toBeInTheDocument();
    expect(screen.getByText('USDG')).toBeInTheDocument();
  });
  it('splits tiny nonzero amounts that would round to zero', () => {
    expect(tinyMicros('3')).toEqual({ negative: false, zeros: 5, digits: '3', exact: '0.000003' });
    expect(tinyMicros('125')).toEqual({ negative: false, zeros: 3, digits: '125', exact: '0.000125' });
    expect(tinyMicros('4999')).toEqual({ negative: false, zeros: 2, digits: '4999', exact: '0.004999' });
    expect(tinyMicros('5000')).toBeNull(); // rounds to 0.01
    expect(tinyMicros('0')).toBeNull();
    expect(tinyMicros('-30')?.exact).toBe('-0.00003');
    expect(tinyMicros('3', 6)).toBeNull();
  });
  it('renders tiny amounts compactly with the exact value in the title', () => {
    const { container } = render(<Money micros="3" />);
    const el = container.querySelector('.sp-money') as HTMLElement;
    expect(el.title).toBe('0.000003 USDG');
    expect(el.querySelector('sub')?.textContent).toBe('5');
    // visible "0.0", subscript "5" (aria-hidden), screen-reader-only "0000", then "3"
    expect(el.textContent).toBe('0.0' + '5' + '0000' + '3' + ' USDG');
    render(<Money micros="125" unit={null} />);
    expect(screen.getByText('0.000125')).toBeInTheDocument();
  });
  it('exact amounts show every micro, trimmed down to two decimals', () => {
    expect(formatMicrosExact('4999747')).toBe('4.999747');
    expect(formatMicrosExact('5000000')).toBe('5.00');
    expect(formatMicrosExact('5010000')).toBe('5.01');
    expect(formatMicrosExact('1234500000')).toBe('1,234.50');
    expect(formatMicrosExact('-250')).toBe('-0.00025');
    render(<Money micros="4999747" exact />);
    expect(screen.getByText('4.999747')).toBeInTheDocument();
  });
});
