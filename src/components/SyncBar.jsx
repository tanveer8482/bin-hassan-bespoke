import { formatDateTime } from "../lib/format";

export function SyncBar({ lastSynced, offline }) {
  return (
    <div className="sync-bar" role="status" aria-live="polite">
      <span>
        Last synced: <strong>{formatDateTime(lastSynced)}</strong>
      </span>
      {offline ? <span className="offline-pill">Offline mode</span> : null}
    </div>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
