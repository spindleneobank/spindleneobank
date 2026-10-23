import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatCents, formatMicros, Money } from '../Money';

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
});
