
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./lib/api";
import {
  clearPersistedState,
  loadPersistedAppState,
  normalizeSnapshotCache,
  PERSISTENCE_KEYS,
  removePersistedValue,
  setPersistedValue
} from "./lib/appPersistence";
import { emptySnapshot } from "./lib/emptySnapshot";
import { SyncBar } from "./components/SyncBar";
import { AdminApp } from "./features/admin/AdminApp";
import { KarigarApp } from "./features/karigar/KarigarApp";
import { ShopApp } from "./features/shop/ShopApp";
import { CuttingApp } from "./features/cutting/CuttingApp";

const DEFAULT_POLL_MS = 20000;
const LEGACY_MUTATION_QUEUE_KEY = "bhb_mutation_queue_v1";
const LEGACY_SNAPSHOT_CACHE_KEY = "bhb_snapshot_cache_v1";
const LEGACY_SYNC_HISTORY_KEY = "bhb_sync_history_v1";
const SYNC_WINDOW_MS = 120000;
const MIN_SYNC_GAP_MS = 30000;
const MAX_SYNC_ATTEMPTS_PER_WINDOW = 2;

function getStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadLegacyCachedSnapshot() {
  return normalizeSnapshotCache(getStoredJson(LEGACY_SNAPSHOT_CACHE_KEY, null));
}

function hasCachedSnapshotData(snapshotCache) {
  if (!snapshotCache || typeof snapshotCache !== "object") return false;
  if (snapshotCache.lastSynced) return true;
  if (Array.isArray(snapshotCache.settings) && snapshotCache.settings.length) return true;

  const data = snapshotCache.data || {};
  const collectionKeys = [
    "users",
    "shops",
    "karigars",
    "orders",
    "orderItems",
    "pieces",
    "paymentsShops",
    "paymentsKarigar",
    "shopRates",
    "karigarRates"
  ];

  return collectionKeys.some((key) => Array.isArray(data[key]) && data[key].length > 0);
}

function removeLegacyPersistenceKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage cleanup failures
  }
}

function LoginScreen({ onLogin, loading, error }) {
  const [form, setForm] = useState({ username: "", password: "" });

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Tailor Workshop Management</p>
        <h1>Bin Hassan Bespoke</h1>
        <p className="muted">
          Admin, Shop, and Karigar interfaces in one app.
        </p>

        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onLogin(form);
          }}
        >
          <label>
            Username
            <input
              className="input"
              value={form.username}
              onChange={(event) =>
                setForm((current) => ({ ...current, username: event.target.value }))
              }
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />
          </label>

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        {error ? <p className="alert error">{error}</p> : null}
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(() => getStoredJson(USER_KEY, null));

  const [data, setData] = useState(() => emptySnapshot());
  const [settings, setSettings] = useState([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(DEFAULT_POLL_MS);
  const [lastSynced, setLastSynced] = useState("");
  const [pendingMutations, setPendingMutations] = useState([]);
  const [syncMeta, setSyncMeta] = useState({ queuedAt: "", flushInProgress: false });
  const [storageReady, setStorageReady] = useState(false);
  const syncHistoryRef = useRef([]);
  const remoteSnapshotLoadedRef = useRef(false);

  const [loading, setLoading] = useState(Boolean(token));
  const [busyAction, setBusyAction] = useState("");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [offline, setOffline] = useState(!window.navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const persisted = await loadPersistedAppState();
        const legacyMutationQueue = getStoredJson(LEGACY_MUTATION_QUEUE_KEY, []);
        const legacySnapshotCache = loadLegacyCachedSnapshot();
        const legacySyncHistory = getStoredJson(LEGACY_SYNC_HISTORY_KEY, []);

        let nextMutationQueue = persisted.mutationQueue;
        let nextSnapshotCache = persisted.snapshotCache;
        let nextSyncHistory = persisted.syncHistory;

        if (!nextMutationQueue.length && legacyMutationQueue.length) {
          nextMutationQueue = legacyMutationQueue;
          const stored = await setPersistedValue(
            PERSISTENCE_KEYS.mutationQueue,
            legacyMutationQueue
          );
          if (stored) removeLegacyPersistenceKey(LEGACY_MUTATION_QUEUE_KEY);
        } else if (nextMutationQueue.length) {
          removeLegacyPersistenceKey(LEGACY_MUTATION_QUEUE_KEY);
        }

        if (!hasCachedSnapshotData(nextSnapshotCache) && hasCachedSnapshotData(legacySnapshotCache)) {
          nextSnapshotCache = legacySnapshotCache;
          const stored = await setPersistedValue(
            PERSISTENCE_KEYS.snapshotCache,
            legacySnapshotCache
          );
          if (stored) removeLegacyPersistenceKey(LEGACY_SNAPSHOT_CACHE_KEY);
        } else if (hasCachedSnapshotData(nextSnapshotCache)) {
          removeLegacyPersistenceKey(LEGACY_SNAPSHOT_CACHE_KEY);
        }

        if (!nextSyncHistory.length && legacySyncHistory.length) {
          nextSyncHistory = legacySyncHistory;
          const stored = await setPersistedValue(
            PERSISTENCE_KEYS.syncHistory,
            legacySyncHistory
          );
          if (stored) removeLegacyPersistenceKey(LEGACY_SYNC_HISTORY_KEY);
        } else if (nextSyncHistory.length) {
          removeLegacyPersistenceKey(LEGACY_SYNC_HISTORY_KEY);
        }

        if (!active) return;

        syncHistoryRef.current = nextSyncHistory;
        setPendingMutations(nextMutationQueue);
        setSyncMeta((current) => ({
          ...current,
          queuedAt: nextMutationQueue.length ? current.queuedAt || new Date().toISOString() : ""
        }));

        if (!remoteSnapshotLoadedRef.current) {
          setData(nextSnapshotCache.data);
          setSettings(nextSnapshotCache.settings);
          setSettingsLoaded(Boolean(nextSnapshotCache.settings.length));
          setLastSynced(nextSnapshotCache.lastSynced);
        }
      } catch (error) {
        console.warn("[APP_STORAGE] hydration failed", error);
      } finally {
        if (active) {
          setStorageReady(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice("");
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!storageReady) return;

    void setPersistedValue(PERSISTENCE_KEYS.mutationQueue, pendingMutations);
    if (!pendingMutations.length) {
      setSyncMeta((current) => ({ ...current, queuedAt: "" }));
    }
  }, [pendingMutations, storageReady]);

  useEffect(() => {
    if (!storageReady) return;

    void setPersistedValue(PERSISTENCE_KEYS.snapshotCache, {
      data,
      settings,
      lastSynced
    });
  }, [data, settings, lastSynced, storageReady]);

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
    setData(emptySnapshot());
    setSettings([]);
    setSettingsLoaded(false);
    setBusyAction("");
    setError("");
    setNotice("");
    setLastSynced("");
    setPendingMutations([]);
    setSyncMeta({ queuedAt: "", flushInProgress: false });
    setStorageReady(true);
    syncHistoryRef.current = [];
    remoteSnapshotLoadedRef.current = false;

    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    removeLegacyPersistenceKey(LEGACY_MUTATION_QUEUE_KEY);
    removeLegacyPersistenceKey(LEGACY_SNAPSHOT_CACHE_KEY);
    removeLegacyPersistenceKey(LEGACY_SYNC_HISTORY_KEY);
    void clearPersistedState();
  }, []);

  const refreshSnapshot = useCallback(
    async (currentToken = token, options = { silent: false }) => {
      if (!currentToken) return false;

      if (!options.silent) setLoading(true);

      try {
        const response = await api.getSnapshot(currentToken);
        const snapshotData = response.data || emptySnapshot();
        remoteSnapshotLoadedRef.current = true;
        
        // Cache settings separately to avoid refetching
        if (snapshotData.settings && (!settingsLoaded || JSON.stringify(snapshotData.settings) !== JSON.stringify(settings))) {
          setSettings(snapshotData.settings);
          setSettingsLoaded(true);
        }
        
        // Remove settings from the main data to prevent unnecessary re-renders
        const dataWithoutSettings = { ...snapshotData };
        delete dataWithoutSettings.settings;
        
        setData(dataWithoutSettings);
        setPollIntervalMs(response.poll_interval_ms || DEFAULT_POLL_MS);
        setLastSynced(response.last_synced || new Date().toISOString());
        setError("");
        setOffline(false);
        return true;
      } catch (snapshotError) {
        setError(snapshotError.message || "Failed to sync");
        if (/unauthorized|invalid token/i.test(snapshotError.message || "")) {
          logout();
        }
        if (!window.navigator.onLine) {
          setOffline(true);
        }
        return false;
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    [token, logout]
  );

  const canFlushNow = useCallback(() => {
    const now = Date.now();
    const currentHistory = syncHistoryRef.current || [];
    const recent = (syncHistoryRef.current || []).filter(
      (timestamp) => now - timestamp <= SYNC_WINDOW_MS
    );
    syncHistoryRef.current = recent;
    if (recent.length !== currentHistory.length) {
      void setPersistedValue(PERSISTENCE_KEYS.syncHistory, recent);
    }

    if (recent.length >= MAX_SYNC_ATTEMPTS_PER_WINDOW) {
      return false;
    }

    const lastAttempt = recent[recent.length - 1] || 0;
    if (lastAttempt && now - lastAttempt < MIN_SYNC_GAP_MS) {
      return false;
    }

    return true;
  }, []);

  const markFlushAttempt = useCallback(async () => {
    const next = [...(syncHistoryRef.current || []), Date.now()];
    syncHistoryRef.current = next;
    await setPersistedValue(PERSISTENCE_KEYS.syncHistory, next);
  }, []);

  const executeMutation = useCallback(
    async (mutation, activeToken) => {
      const payload = mutation?.payload || {};
      const currentToken = activeToken || window.localStorage.getItem(TOKEN_KEY) || "";
      switch (mutation?.type) {
        case "createOrder": {
          const created = await api.createOrder(currentToken, payload);
          const orderId = created?.order?.order_id;
          if (orderId) {
            await api.extractOrder(currentToken, { order_id: orderId });
          }
          return;
        }
        case "updateOrder":
          await api.updateOrder(currentToken, payload);
          return;
        case "markPieceCut":
          await api.markPieceCut(currentToken, payload);
          return;
        case "extractOrder":
          await api.extractOrder(currentToken, payload);
          return;
        case "approvePiece":
          await api.approvePiece(currentToken, payload);
          return;
        case "syncPayroll":
          await api.syncPayroll(currentToken, payload);
          return;
        case "generateInvoice":
          await api.generateInvoice(currentToken, payload);
          return;
        case "saveProduct":
          await api.saveProduct(currentToken, payload);
          return;
        case "saveSubProduct":
          await api.saveSubProduct(currentToken, payload);
          return;
        case "assignPiece":
          await api.assignPiece(currentToken, payload);
          return;
        case "completePiece":
          await api.requestApproval(currentToken, payload);
          return;
        case "createShop":
          await api.createShop(currentToken, payload);
          return;
        case "updateShop":
          await api.updateShop(currentToken, payload);
          return;
        case "createKarigar":
          await api.createKarigar(currentToken, payload);
          return;
        case "updateKarigar":
          await api.updateKarigar(currentToken, payload);
          return;
        case "createShopPayment":
          await api.createShopPayment(currentToken, payload);
          return;
        case "createKarigarPayment":
          await api.createKarigarPayment(currentToken, payload);
          return;
        case "createUser":
          await api.createUser(currentToken, payload);
          return;
        case "updateUser":
          await api.updateUser(currentToken, payload);
          return;
        case "deleteUser":
          await api.deleteUser(currentToken, payload);
          return;
        case "saveSettings":
          await api.saveSettings(currentToken, payload);
          return;
        case "clearAllData":
          await api.clearAllData(currentToken, payload);
          return;
        default:
          return;
      }
    },
    []
  );

  const flushQueuedMutations = useCallback(
    async (options = { force: false }) => {
      if (!token || offline || !storageReady) return false;
      if (!pendingMutations.length) return false;
      if (syncMeta.flushInProgress) return false;
      if (!options.force && !canFlushNow()) return false;

      setSyncMeta((current) => ({ ...current, flushInProgress: true }));
      await markFlushAttempt();

      try {
        const hasDeleteAll = pendingMutations.some(
          (mutation) => mutation.type === "clearAllData"
        );
        for (const mutation of pendingMutations) {
          await executeMutation(mutation, token);
        }
        setPendingMutations([]);
        await setPersistedValue(PERSISTENCE_KEYS.mutationQueue, []);
        if (hasDeleteAll) {
          setData(emptySnapshot());
          setSettings([]);
          setSettingsLoaded(false);
          setLastSynced(new Date().toISOString());
          await removePersistedValue(PERSISTENCE_KEYS.snapshotCache);
          setNotice("All data deleted");
          return true;
        }
        await refreshSnapshot(token, { silent: true });
        setNotice("Queued changes synced");
        return true;
      } catch (flushError) {
        setError(flushError.message || "Queued sync failed");
        return false;
      } finally {
        setSyncMeta((current) => ({ ...current, flushInProgress: false }));
      }
    },
    [
      token,
      offline,
      pendingMutations,
      syncMeta.flushInProgress,
      canFlushNow,
      markFlushAttempt,
      executeMutation,
      refreshSnapshot,
      storageReady
    ]
  );

  const enqueueMutation = useCallback((type, payload, actionKey, noticeText) => {
    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      actionKey,
      noticeText
    };
    setPendingMutations((current) => {
      const next = [...current, record];
      if (storageReady) {
        void setPersistedValue(PERSISTENCE_KEYS.mutationQueue, next);
      }
      return next;
    });
    setSyncMeta((current) => ({
      ...current,
      queuedAt: current.queuedAt || new Date().toISOString()
    }));
  }, [storageReady]);

  useEffect(() => {
    if (!token || !storageReady) {
      setLoading(false);
      return;
    }

    let active = true;

    (async () => {
      if (!user) {
        try {
          const me = await api.getMe(token);
          if (!active) return;
          setUser(me.user);
          window.localStorage.setItem(USER_KEY, JSON.stringify(me.user));
        } catch {
          logout();
          return;
        }
      }

      if (active) {
        await refreshSnapshot(token);
      }
    })();

    return () => {
      active = false;
    };
  }, [token, user, refreshSnapshot, logout, storageReady]);

  useEffect(() => {
    if (!token || !storageReady) return undefined;

    const timer = window.setInterval(() => {
      refreshSnapshot(token, { silent: true });
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [token, pollIntervalMs, refreshSnapshot, storageReady]);

  useEffect(() => {
    if (!token || !storageReady) return undefined;
    const timer = window.setInterval(() => {
      flushQueuedMutations();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [token, flushQueuedMutations, storageReady]);

  const runAction = useCallback(
    async (actionKey, mutationType, payload, noticeText = "Queued for sync") => {
      if (!token || !storageReady) return false;

      setBusyAction(actionKey);
      setNotice("");
      setError("");

      try {
        enqueueMutation(mutationType, payload, actionKey, noticeText);
        setNotice(`${noticeText} (pending sync)`);
        return true;
      } catch (actionError) {
        setError(actionError.message || "Action failed");
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [token, enqueueMutation, storageReady]
  );

  const actions = useMemo(() => {
    return {
      createOrder: (payload) =>
        runAction("createOrder", "createOrder", payload, "Order queued"),
      updateOrder: (payload) =>
        runAction(
          payload.status === "delivered" ? `deliver:${payload.order_id}` : "updateOrder",
          "updateOrder",
          payload,
          "Order update queued"
        ),
      markPieceCut: (payload) =>
        runAction(`cut:${payload.piece_id}`, "markPieceCut", payload, "Cutting update queued"),
      extractOrder: (payload) =>
        runAction(`extract:${payload.order_id}`, "extractOrder", payload, "Extract queued"),
      approvePiece: (payload) =>
        runAction(`approve:${payload.piece_id}`, "approvePiece", payload, "Approval queued"),
      syncPayroll: (payload) =>
        runAction("syncPayroll", "syncPayroll", payload, "Payroll sync queued"),
      generateInvoice: (payload) =>
        runAction("generateInvoice", "generateInvoice", payload, "Invoice queued"),
      saveProduct: (payload) =>
        runAction("saveProduct", "saveProduct", payload, "Product queued"),
      saveSubProduct: (payload) =>
        runAction("saveSubProduct", "saveSubProduct", payload, "Sub-product queued"),

      assignPiece: (payload) =>
        runAction(`assign:${payload.piece_id}`, "assignPiece", payload, "Assignment queued"),
      completePiece: (payload) =>
        runAction(`complete:${payload.piece_id}`, "completePiece", payload, "Completion queued"),

      createShop: (payload) =>
        runAction("createShop", "createShop", payload, "Shop queued"),
      updateShop: (payload) =>
        runAction("updateShop", "updateShop", payload, "Shop update queued"),
      createKarigar: (payload) =>
        runAction("createKarigar", "createKarigar", payload, "Karigar queued"),
      updateKarigar: (payload) =>
        runAction("updateKarigar", "updateKarigar", payload, "Karigar update queued"),

      saveShopRates: (payload) =>
        runAction("saveShopRates", "saveSettings", payload, "Shop rates queued"),
      saveKarigarRates: (payload) =>
        runAction("saveKarigarRates", "saveSettings", payload, "Karigar rates queued"),

      createShopPayment: (payload) =>
        runAction("createShopPayment", "createShopPayment", payload, "Shop payment queued"),
      createKarigarPayment: (payload) =>
        runAction(
          "createKarigarPayment",
          "createKarigarPayment",
          payload,
          "Karigar payment queued"
        ),

      createUser: (payload) =>
        runAction("createUser", "createUser", payload, "User queued"),
      updateUser: (payload) =>
        runAction("updateUser", "updateUser", payload, "User update queued"),
      deleteUser: (payload) =>
        runAction(`deleteUser:${payload.username}`, "deleteUser", payload, "User delete queued"),

      saveSettings: (payload) =>
        runAction("saveSettings", "saveSettings", payload, "Setting queued"),
      clearAllData: () => runAction("clearAllData", "clearAllData", {}, "Delete-all queued"),
      refresh: async () => {
        await flushQueuedMutations({ force: true });
        return refreshSnapshot(token);
      }
    };
  }, [token, runAction, refreshSnapshot, flushQueuedMutations]);

  const handleLogin = async (credentials) => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await api.login(credentials);
      setToken(result.token);
      setUser(result.user);
      setPollIntervalMs(result.poll_interval_ms || DEFAULT_POLL_MS);
      setLastSynced(result.last_synced || "");

      window.localStorage.setItem(TOKEN_KEY, result.token);
      window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    } catch (loginError) {
      setError(loginError.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return <LoginScreen onLogin={handleLogin} loading={loading} error={error} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Bin Hassan Bespoke</p>
          <h1>{user?.role === "admin" ? "Admin Panel" : user?.display_name || "User"}</h1>
          <p className="muted role-note">Role: {user?.role || "-"}</p>
        </div>
        <div className="topbar-actions">
          <button className="button ghost" onClick={() => actions.refresh()}>
            Refresh
          </button>
          <button className="button ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <SyncBar
        lastSynced={lastSynced}
        offline={offline}
        pendingCount={pendingMutations.length}
        flushInProgress={syncMeta.flushInProgress}
      />

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {loading || (token && !storageReady) ? <p className="muted">Loading latest data...</p> : null}

      {!loading && storageReady && user?.role === "admin" ? (
        <AdminApp data={{ ...data, settings }} actions={actions} busyAction={busyAction} />
      ) : null}

      {!loading && storageReady && user?.role === "karigar" ? (
        <KarigarApp
          user={user}
          data={data}
          onCompletePiece={(payload) => actions.completePiece(payload)}
          busyAction={busyAction}
        />
      ) : null}

      {!loading && storageReady && user?.role === "shop" ? <ShopApp user={user} data={data} /> : null}
      {!loading && storageReady && user?.role === "cutting" ? (
        <CuttingApp
          data={data}
          onUploadCuttingPhoto={(payload) => actions.markPieceCut(payload)}
          busyAction={busyAction}
        />
      ) : null}

    </div>
  );
}




