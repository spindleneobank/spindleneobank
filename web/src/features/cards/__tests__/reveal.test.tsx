import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ withReauth: <T,>(fn: () => Promise<T>) => fn() }),
}));

import { RevealBody } from '../Dialogs';

const DATA = { number: '5412751234567731', exp: '09/29', cvv: '482', holder: 'A B' };

describe('RevealBody', () => {
  it('shows details after the fetch, then clears them on unmount and never persists', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const reveal = vi.fn().mockResolvedValue(DATA);
    const { unmount, container } = render(<RevealBody cardId="c1" onClose={() => {}} reveal={reveal} />);
    expect(screen.queryByText('482')).toBeNull();
    await waitFor(() => expect(screen.getByText('482')).toBeInTheDocument());
    expect(screen.getByText('5412 7512 3456 7731')).toBeInTheDocument();
    unmount();
    expect(container.textContent).toBe('');
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain('5412');
  });

  it('closes when the tab is hidden', async () => {
    const onClose = vi.fn();
    render(<RevealBody cardId="c1" onClose={onClose} reveal={vi.fn().mockResolvedValue(DATA)} />);
    await waitFor(() => expect(screen.getByText('482')).toBeInTheDocument());
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onClose).toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('shows an error without any details when the reveal fails', async () => {
    render(
      <RevealBody cardId="c1" onClose={() => {}} reveal={vi.fn().mockRejectedValue(new Error('nope'))} />,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nope'));
  });
});
