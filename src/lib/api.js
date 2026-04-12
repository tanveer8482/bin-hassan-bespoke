const API_BASE = "/api";

const REQUEST_TIMEOUT_MS = 10000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || REQUEST_TIMEOUT_MS;
  const timer = window.setTimeout(() => controller.abort(), timeout);

  // 1. Gather token from options or localStorage with strict validation
  let requestToken = options.token;
  
  // If token is missing, or is a useless string representation, try localStorage
  const isInvalidToken = !requestToken || 
                        requestToken === "undefined" || 
                        requestToken === "null" || 
                        (typeof requestToken === "string" && requestToken.trim() === "");

  if (isInvalidToken && typeof window !== "undefined") {
    requestToken = window.localStorage.getItem("bhb_token") || "";
  }
  
  // Final cleanup: ensure it's a trimmed string, or empty
  requestToken = (typeof requestToken === "string") ? requestToken.trim() : "";
  if (requestToken === "undefined" || requestToken === "null") requestToken = "";

  // 2. Build headers
  const headersObj = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  // Force Authorization header if we have any semblance of a token
  if (requestToken) {
    headersObj["Authorization"] = `Bearer ${requestToken}`;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: headersObj,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      const message = payload.message || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Request timed out after 10 seconds");
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export const TOKEN_KEY = "bhb_token";
export const USER_KEY = "bhb_user";

export const api = {
  // All API calls now use the consolidated /api/index?action=... endpoint
  login: async (body) => {
    const res = await request("/index?action=login", { method: "POST", body });
    if (res && res.token && typeof window !== "undefined") {
      console.log("Saving token to localStorage:", TOKEN_KEY);
      window.localStorage.setItem(TOKEN_KEY, res.token);
      
      // Verify immediately
      const saved = window.localStorage.getItem(TOKEN_KEY);
      console.log("Verified token in localStorage:", saved ? "EXISTS" : "MISSING");

      if (res.user) {
        window.localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      }
    }
    return res;
  },
  getMe: (token) => request("/index?action=getMe", { token }),
  getSnapshot: (token) => request("/index?action=getSnapshot", { token }),
  bootstrap: (body) => request("/index?action=bootstrap", { method: "POST", body }),

  listOrders: (token) => request("/index?action=listOrders", { token }),
  createOrder: (token, body) => request("/index?action=createOrder", { method: "POST", token, body }),
  updateOrder: (token, body) => request("/index?action=updateOrder", { method: "PATCH", token, body }),

  markPieceCut: (token, body) =>
    request("/index?action=markPieceCut", { method: "POST", token, body }),
  assignPiece: (token, body) =>
    request("/index?action=assignPiece", { method: "POST", token, body }),
  completePiece: (token, body) =>
    request("/index?action=completePiece", { method: "POST", token, body }),

  listShops: (token) => request("/index?action=listShops", { token }),
  createShop: (token, body) => request("/index?action=createShop", { method: "POST", token, body }),
  updateShop: (token, body) => request("/index?action=updateShop", { method: "PATCH", token, body }),

  listKarigar: (token) => request("/index?action=listKarigar", { token }),
  createKarigar: (token, body) => request("/index?action=createKarigar", { method: "POST", token, body }),
  updateKarigar: (token, body) => request("/index?action=updateKarigar", { method: "PATCH", token, body }),

  listShopRates: (token) => request("/index?action=listShopRates", { token }),
  saveShopRates: (token, body) =>
    request("/index?action=saveShopRates", { method: "POST", token, body }),

  listKarigarRates: (token) => request("/index?action=listKarigarRates", { token }),
  saveKarigarRates: (token, body) =>
    request("/index?action=saveKarigarRates", { method: "POST", token, body }),

  listShopPayments: (token) => request("/index?action=listShopPayments", { token }),
  createShopPayment: (token, body) =>
    request("/index?action=createShopPayment", { method: "POST", token, body }),

  listKarigarPayments: (token) => request("/index?action=listKarigarPayments", { token }),
  createKarigarPayment: (token, body) =>
    request("/index?action=createKarigarPayment", { method: "POST", token, body }),

  listUsers: (token) => request("/index?action=listUsers", { token }),
  createUser: (token, body) => request("/index?action=createUser", { method: "POST", token, body }),
  updateUser: (token, body) => request("/index?action=updateUser", { method: "PATCH", token, body }),
  deleteUser: (token, body) => request("/index?action=deleteUser", { method: "DELETE", token, body }),

  listSettings: (token) => request("/index?action=listSettings", { token }),
  saveSettings: (token, body) => request("/index?action=saveSettings", { method: "POST", token, body })
};
