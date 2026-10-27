import { type ComponentType, lazy } from 'react';

export type TabDef = {
  id: string;
  label: string;
  icon: string;
  Component: ComponentType;
};

/** Each tab body lives in src/features/<tab>/index.tsx (F1+). Code-split per tab. */
export const TABS: TabDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'overview',
    Component: lazy(() => import('../features/overview')),
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: 'earnings',
    Component: lazy(() => import('../features/accounts')),
  },
  { id: 'cards', label: 'Cards', icon: 'cards', Component: lazy(() => import('../features/cards')) },
  {
    id: 'payments',
    label: 'Payments',
    icon: 'payouts',
    Component: lazy(() => import('../features/payments')),
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'activity',
    Component: lazy(() => import('../features/activity')),
  },
  { id: 'compute', label: 'Compute', icon: 'nodes', Component: lazy(() => import('../features/compute')) },
  {
    id: 'developers',
    label: 'Developers',
    icon: 'code',
    Component: lazy(() => import('../features/developers')),
  },
  { id: 'chat', label: 'Chat', icon: 'agent', Component: lazy(() => import('../features/chat')) },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    Component: lazy(() => import('../features/settings')),
  },
];
