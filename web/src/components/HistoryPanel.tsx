/**
 * History panel (Phase 1 placeholder — implemented in Phase 4).
 */
import type { SessionView } from '../types';
import { ArrowLeftIcon } from './Icons';

interface HistoryPanelProps {
  session: SessionView | null;
  onBack: () => void;
  onDisconnect: () => void;
}

export function HistoryPanel({ session, onBack }: HistoryPanelProps) {
  return (
    <section className="panel">
      <button type="button" className="btn btn--small" onClick={onBack}>
        <ArrowLeftIcon size={16} /> Back
      </button>
      <p style={{ marginTop: '1rem' }}>
        {session?.history.length ?? 0} pull requests this session. The full list arrives in Phase 4.
      </p>
    </section>
  );
}
