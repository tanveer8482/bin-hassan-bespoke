
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./lib/api";
import { emptySnapshot } from "./lib/emptySnapshot";
import { SyncBar } from "./components/SyncBar";
import { AdminApp } from "./features/admin/AdminApp";
import { KarigarApp } from "./features/karigar/KarigarApp";
import { ShopApp } from "./features/shop/ShopApp";
import { CuttingApp } from "./features/cutting/CuttingApp";

const DEFAULT_POLL_MS = 20000;

function getStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
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

  const [data, setData] = useState(emptySnapshot());
  const [settings, setSettings] = useState([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(DEFAULT_POLL_MS);
  const [lastSynced, setLastSynced] = useState("");

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
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice("");
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [notice]);

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

    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }, []);

  const refreshSnapshot = useCallback(
    async (currentToken = token, options = { silent: false }) => {
      if (!currentToken) return false;

      if (!options.silent) setLoading(true);

      try {
        const response = await api.getSnapshot(currentToken);
        const snapshotData = response.data || emptySnapshot();
        
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

  useEffect(() => {
    if (!token) {
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
  }, [token, user, refreshSnapshot, logout]);

  useEffect(() => {
    if (!token) return undefined;

    const timer = window.setInterval(() => {
      refreshSnapshot(token, { silent: true });
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [token, pollIntervalMs, refreshSnapshot]);

  const runAction = useCallback(
    async (actionKey, fn, noticeText = "Saved", skipRefresh = false) => {
      if (!token) return false;

      setBusyAction(actionKey);
      setNotice("");
      setError("");

      try {
        await fn();
        if (!skipRefresh) {
          await refreshSnapshot(token, { silent: true });
        }
        setNotice(noticeText);
        return true;
      } catch (actionError) {
        setError(actionError.message || "Action failed");
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [token, refreshSnapshot]
  );

  const actions = useMemo(() => {
    return {
      createOrder: (payload) =>
        runAction("createOrder", () => api.createOrder(token, payload), "Order created", true),
      updateOrder: (payload) =>
        runAction(
          payload.status === "delivered" ? `deliver:${payload.order_id}` : "updateOrder",
          async () => {
            const currentToken = window.localStorage.getItem(TOKEN_KEY) || token;
            return api.updateOrder(currentToken, payload);
          },
          "Order updated"
        ),
      markPieceCut: (payload) =>
        runAction(
          `cut:${payload.piece_id}`,
          async () => {
            const currentToken = window.localStorage.getItem(TOKEN_KEY) || "";
            console.log("MARK_PIECE_CUT ATTEMPT - Token found in localStorage:", currentToken ? "YES" : "NO");
            console.log("Token value prefix:", currentToken ? currentToken.substring(0, 10) + "..." : "NONE");
            return api.markPieceCut(currentToken, payload);
          },
          "Piece marked cut"
        ),
      assignPiece: (payload) =>
        runAction(
          `assign:${payload.piece_id}`,
          async () => {
            const currentToken = window.localStorage.getItem(TOKEN_KEY) || token;
            return api.assignPiece(currentToken, payload);
          },
          "Work assigned"
        ),
      completePiece: (payload) =>
        runAction(
          `complete:${payload.piece_id}`,
          async () => {
            const currentToken = window.localStorage.getItem(TOKEN_KEY) || token;
            return api.completePiece(currentToken, payload);
          },
          "Piece completed"
        ),

      createShop: (payload) =>
        runAction("createShop", () => api.createShop(token, payload), "Shop created"),
      updateShop: (payload) =>
        runAction("updateShop", () => api.updateShop(token, payload), "Shop updated"),
      createKarigar: (payload) =>
        runAction("createKarigar", () => api.createKarigar(token, payload), "Karigar created"),
      updateKarigar: (payload) =>
        runAction("updateKarigar", () => api.updateKarigar(token, payload), "Karigar updated"),

      saveShopRates: (payload) =>
        runAction("saveShopRates", () => api.saveShopRates(token, payload), "Shop rate saved"),
      saveKarigarRates: (payload) =>
        runAction(
          "saveKarigarRates",
          () => api.saveKarigarRates(token, payload),
          "Karigar rate saved"
        ),

      createShopPayment: (payload) =>
        runAction(
          "createShopPayment",
          () => api.createShopPayment(token, payload),
          "Shop payment recorded"
        ),
      createKarigarPayment: (payload) =>
        runAction(
          "createKarigarPayment",
          () => api.createKarigarPayment(token, payload),
          "Karigar payment recorded"
        ),

      createUser: (payload) =>
        runAction("createUser", () => api.createUser(token, payload), "User created"),
      updateUser: (payload) =>
        runAction("updateUser", () => api.updateUser(token, payload), "User updated"),
      deleteUser: (payload) =>
        runAction(
          `deleteUser:${payload.username}`,
          () => api.deleteUser(token, payload),
          "User deleted"
        ),

      saveSettings: (payload) =>
        runAction("saveSettings", () => api.saveSettings(token, payload), "Setting saved"),
      refresh: () => refreshSnapshot(token)
    };
  }, [token, runAction, refreshSnapshot]);

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

      await refreshSnapshot(result.token, { silent: true });
      window.location.reload();
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

      <SyncBar lastSynced={lastSynced} offline={offline} />

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {loading ? <p className="muted">Loading latest data...</p> : null}

      {!loading && user?.role === "admin" ? (
        <AdminApp data={{ ...data, settings }} actions={actions} busyAction={busyAction} />
      ) : null}

      {!loading && user?.role === "karigar" ? (
        <KarigarApp
          user={user}
          data={data}
          onCompletePiece={(payload) => actions.completePiece(payload)}
          busyAction={busyAction}
        />
      ) : null}

      {!loading && user?.role === "shop" ? <ShopApp user={user} data={data} /> : null}
      {!loading && user?.role === "cutting" ? (
        <CuttingApp
          data={data}
          onUploadCuttingPhoto={(payload) => actions.markPieceCut(payload)}
          busyAction={busyAction}
        />
      ) : null}

    </div>
  );
}




