const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token
        ? {
            Authorization: `Bearer ${options.token}`
          }
        : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
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
}

export const api = {
  login: (body) => request("/login", { method: "POST", body }),
  getMe: (token) => request("/me", { token }),
  getSnapshot: (token) => request("/snapshot", { token }),
  bootstrap: (body) => request("/bootstrap", { method: "POST", body }),

  listOrders: (token) => request("/orders", { token }),
  createOrder: (token, body) => request("/orders", { method: "POST", token, body }),
  updateOrder: (token, body) => request("/orders", { method: "PATCH", token, body }),

  markPieceCut: (token, body) =>
    request("/pieces-cut", { method: "POST", token, body }),
  assignPiece: (token, body) =>
    request("/pieces-assign", { method: "POST", token, body }),
  completePiece: (token, body) =>
    request("/pieces-complete", { method: "POST", token, body }),

  listShops: (token) => request("/shops", { token }),
  createShop: (token, body) => request("/shops", { method: "POST", token, body }),
  updateShop: (token, body) => request("/shops", { method: "PATCH", token, body }),

  listKarigar: (token) => request("/karigar", { token }),
  createKarigar: (token, body) => request("/karigar", { method: "POST", token, body }),
  updateKarigar: (token, body) => request("/karigar", { method: "PATCH", token, body }),

  listShopRates: (token) => request("/rates-shop", { token }),
  saveShopRates: (token, body) =>
    request("/rates-shop", { method: "POST", token, body }),

  listKarigarRates: (token) => request("/rates-karigar", { token }),
  saveKarigarRates: (token, body) =>
    request("/rates-karigar", { method: "POST", token, body }),

  listShopPayments: (token) => request("/payments-shops", { token }),
  createShopPayment: (token, body) =>
    request("/payments-shops", { method: "POST", token, body }),

  listKarigarPayments: (token) => request("/payments-karigar", { token }),
  createKarigarPayment: (token, body) =>
    request("/payments-karigar", { method: "POST", token, body }),

  listUsers: (token) => request("/users", { token }),
  createUser: (token, body) => request("/users", { method: "POST", token, body }),
  updateUser: (token, body) => request("/users", { method: "PATCH", token, body }),
  deleteUser: (token, body) => request("/users", { method: "DELETE", token, body }),

  listSettings: (token) => request("/settings", { token }),
  saveSettings: (token, body) => request("/settings", { method: "POST", token, body })
<<<<<<< HEAD
};
=======
};
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
