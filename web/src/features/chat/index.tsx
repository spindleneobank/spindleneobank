import { EmptyState } from '../../components/EmptyState';

/** PLACEHOLDER: the chat tab body is built in its F-task. */
export default function ChatTab() {
  return (
    <div className="sd-panel">
      <EmptyState icon="agent" title="Chat">
        This tab is built in a later task.
      </EmptyState>
    </div>
  );
}
