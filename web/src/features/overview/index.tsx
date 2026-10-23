import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the overview tab body is built in its F-task. */
export default function OverviewTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="overview" title="Overview">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
