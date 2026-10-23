import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the compute tab body is built in its F-task. */
export default function ComputeTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="gpu" title="Compute">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
