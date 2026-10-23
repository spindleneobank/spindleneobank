import { useNavigate, useSearch } from '@tanstack/react-router';
import type { PaymentAction } from '../../routes/dashboard/$tab';

export function usePaymentsSearch() {
  return useSearch({ from: '/dashboard/$tab' });
}

/** Switch Payments sub-tab / set the resumable operation id in the URL. */
export function usePaymentsNav() {
  const navigate = useNavigate();
  return (search: { action?: PaymentAction; op?: string }, replace = false) =>
    void navigate({
      to: '/dashboard/$tab',
      params: { tab: 'payments' },
      search: (prev: Record<string, unknown>) => ({ ...prev, ...search }),
      replace,
    });
}
