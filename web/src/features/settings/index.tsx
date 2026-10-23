import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the settings tab body is built in its F-task. */
export default function SettingsTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="settings" title="Settings">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
