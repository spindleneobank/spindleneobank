import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the developers tab body is built in its F-task. */
export default function DevelopersTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="code" title="Developers">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
