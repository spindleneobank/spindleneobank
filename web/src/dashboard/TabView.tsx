import { useParams } from '@tanstack/react-router';
import { EmptyState } from '../components/EmptyState';
import { TABS } from './tabs';

export function TabView() {
  const { tab } = useParams({ from: '/dashboard/$tab' });
  const def = TABS.find((t) => t.id === tab);
  if (!def) {
    return (
      <div className="sd-panel">
        <EmptyState icon="info" title="Page not found">
          There is no dashboard tab called "{tab}".
        </EmptyState>
      </div>
    );
  }
  const { Component } = def;
  return <Component />;
}
