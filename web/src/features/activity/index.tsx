import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the activity tab body is built in its F-task. */
export default function ActivityTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="activity" title="Activity">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
