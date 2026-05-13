import { formatDateTime } from "../lib/format";
import { SearchBar } from "./SearchBar";

export function SyncBar({
  lastSynced,
  offline,
  pendingCount = 0,
  flushInProgress = false,
  searchQuery,
  onSearchChange,
  showInfo = true
}) {
  return (
    <div className="sync-bar" role="status" aria-live="polite">
      {showInfo ? (
        <div className="sync-info">
          <span>
            Last synced: <strong>{formatDateTime(lastSynced)}</strong>
          </span>
          {pendingCount ? (
            <span className="offline-pill">
              {flushInProgress ? "Syncing queue..." : `${pendingCount} pending changes`}
            </span>
          ) : null}
          {offline ? <span className="offline-pill">Offline mode</span> : null}
        </div>
      ) : null}

      {typeof onSearchChange === "function" ? (
        <div className="sync-search">
          <SearchBar value={searchQuery} onChange={onSearchChange} placeholder="Search orders..." />
        </div>
      ) : null}
    </div>
  );
}
