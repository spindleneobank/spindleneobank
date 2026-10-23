import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the admin tab body is built in its F-task. */
export default function AdminTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="shield" title="Admin">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
