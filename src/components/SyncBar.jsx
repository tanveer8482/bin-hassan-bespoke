import { formatDateTime } from "../lib/format";

export function SyncBar({ lastSynced, offline, pendingCount = 0, flushInProgress = false }) {
  return (
    <div className="sync-bar" role="status" aria-live="polite">
      <span>
        Last synced: <strong>{formatDateTime(lastSynced)}</strong>
      </span>
      {pendingCount ? (
        <span className="offline-pill">{flushInProgress ? "Syncing queue..." : `${pendingCount} pending changes`}</span>
      ) : null}
      {offline ? <span className="offline-pill">Offline mode</span> : null}
    </div>
  );
}
