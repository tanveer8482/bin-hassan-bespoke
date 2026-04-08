const { URL } = require("url");
const bcrypt = require("bcryptjs");
const { ROLES, SHEETS } = require("../server/api/_lib/constants");
const {
  computeShopFinancials,
  filterSnapshotByRole,
  loadFullSnapshot,
  refreshOrderStatuses,
  withComputedFields
} = require("../server/api/_lib/domain");
const { requireAuth, requireRole, authenticate, createToken, stripPrivateUser } = require("../server/api/_lib/auth");
const { getEnv } = require("../server/api/_lib/env");
const { ensureMethod, sendOk } = require("../server/api/_lib/http");
const {
  appendRecord,
  ensureWorkbook,
  getRecords,
  updateByField
} = require("../server/api/_lib/sheets");
const {
  id,
  normalizeKey,
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
  toNumber,
  withErrorHandler
} = require("../server/api/_lib/utils");

// ============ BOOTSTRAP HANDLERS ============

const DEFAULT_SETTINGS = [
  {
    key: "item_types",
    value: "normal,vip,chapma",
    description: "Allowed item types"
  },
  {
    key: "piece_types",
    value: "coat,pent,waistcoat,suit_2piece,suit_3piece",
    description: "Supported order piece types"
  },
  {
    key: "cutting_rate",
    value: "0",
    description: "Default cutting rate per piece"
  }
];

async function seedDefaults() {
  const settings = await getRecords(SHEETS.SETTINGS);
  const existingKeys = new Set(settings.map((row) => row.key));

  for (const row of DEFAULT_SETTINGS) {
    if (!existingKeys.has(row.key)) {
      await appendRecord(SHEETS.SETTINGS, row);
    }
  }
}

async function handleBootstrap(req, res) {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();

  const users = await getRecords(SHEETS.USERS);
  const body = await parseBody(req);

  if (!users.length) {
    requireFields(body, [
      "bootstrap_key",
      "admin_username",
      "admin_password",
      "admin_display_name"
    ]);

    const env = getEnv();
    if (body.bootstrap_key !== env.myAdminKey) {
      const error = new Error("Invalid bootstrap key");
      error.statusCode = 401;
      throw error;
    }

    const record = {
      username: normalizeText(body.admin_username),
      password: await bcrypt.hash(String(body.admin_password), 10),
      role: ROLES.ADMIN,
      display_name: normalizeText(body.admin_display_name),
      entity_id: ""
    };

    await appendRecord(SHEETS.USERS, record);
    await seedDefaults();

    return sendOk(res, {
      message: "Workbook bootstrapped with initial admin user"
    });
  }

  requireRole(req, [ROLES.ADMIN]);
  await seedDefaults();

  sendOk(res, {
    message: "Default settings ensured"
  });
}

// ============ LOGIN HANDLERS ============

async function handleLogin(req, res) {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();

  const existingUsers = await getRecords(SHEETS.USERS);
  if (!existingUsers.length) {
    const error = new Error(
      "No users found in Users sheet. Seed an admin user first."
    );
    error.statusCode = 400;
    throw error;
  }

  const body = await parseBody(req);
  requireFields(body, ["username", "password"]);

  const user = await authenticate(body.username, body.password);
  const token = createToken(user);
  const env = getEnv();

  sendOk(res, {
    token,
    user,
    poll_interval_ms: env.pollIntervalMs,
    last_synced: new Date().toISOString()
  });
}

// ============ SHOPS HANDLERS ============

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

async function listShops(res, user) {
  if (![ROLES.ADMIN, ROLES.SHOP].includes(user.role)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }

  await ensureWorkbook();

  const [shops, snapshot] = await Promise.all([
    getRecords(SHEETS.SHOPS),
    loadFullSnapshot()
  ]);

  const financials = computeShopFinancials(
    snapshot.orders,
    snapshot.orderItems,
    snapshot.paymentsShops
  );

  const filtered =
    user.role === ROLES.ADMIN
      ? shops
      : shops.filter((shop) => shop.shop_id === user.entity_id);

  sendOk(res, {
    shops: filtered.map(stripMeta),
    shop_financials: financials,
    last_synced: new Date().toISOString()
  });
}

async function createShop(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["shop_name"]);

  const shopId = normalizeText(body.shop_id) || id("shop");

  const existing = await getRecords(SHEETS.SHOPS);
  if (existing.some((shop) => shop.shop_id === shopId)) {
    const error = new Error("shop_id already exists");
    error.statusCode = 400;
    throw error;
  }

  const now = nowISO();
  const record = {
    shop_id: shopId,
    shop_name: normalizeText(body.shop_name),
    contact: normalizeText(body.contact),
    created_date: now
  };

  await appendRecord(SHEETS.SHOPS, record);

  sendOk(res, {
    message: "Shop created",
    shop: record
  });
}

async function updateShop(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["shop_id"]);

  const patch = {};
  if (body.shop_name !== undefined) patch.shop_name = normalizeText(body.shop_name);
  if (body.contact !== undefined) patch.contact = normalizeText(body.contact);

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(SHEETS.SHOPS, "shop_id", body.shop_id, patch);

  sendOk(res, {
    message: "Shop updated",
    shop: stripMeta(updated)
  });
}

// ============ KARIGAR HANDLERS ============

async function listKarigar(res, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.CUTTING]);

  const records = await getRecords(SHEETS.KARIGAR);

  sendOk(res, records);
}

async function createKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["name"]);

  const karigarId = normalizeText(body.karigar_id) || id("karigar");

  const existing = await getRecords(SHEETS.KARIGAR);
  if (existing.some((karigar) => karigar.karigar_id === karigarId)) {
    const error = new Error("karigar_id already exists");
    error.statusCode = 400;
    throw error;
  }

  const now = nowISO();
  const record = {
    karigar_id: karigarId,
    name: normalizeText(body.name),
    contact: normalizeText(body.contact),
    created_date: now
  };

  await appendRecord(SHEETS.KARIGAR, record);

  sendOk(res, {
    message: "Karigar created",
    karigar: record
  });
}

async function updateKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["karigar_id"]);

  const patch = {};
  if (body.name !== undefined) patch.name = normalizeText(body.name);
  if (body.contact !== undefined) patch.contact = normalizeText(body.contact);

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(SHEETS.KARIGAR, "karigar_id", body.karigar_id, patch);

  sendOk(res, {
    message: "Karigar updated",
    karigar: stripMeta(updated)
  });
}

async function handleKarigar(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listKarigar(res, user);
  }

  if (req.method === "POST") {
    return createKarigar(req, res);
  }

  return updateKarigar(req, res);
}

// ============ USERS HANDLERS ============

async function listUsers(res, user) {
  requireRole(user, [ROLES.ADMIN]);

  const records = await getRecords(SHEETS.USERS);

  sendOk(res, records.map(stripMeta));
}

async function createUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username", "password", "role", "display_name"]);

  const username = normalizeText(body.username);

  const existing = await getRecords(SHEETS.USERS);
  if (existing.some((user) => normalizeKey(user.username) === normalizeKey(username))) {
    const error = new Error("username already exists");
    error.statusCode = 400;
    throw error;
  }

  const record = {
    username,
    password: body.password,
    role: body.role,
    display_name: normalizeText(body.display_name),
    entity_id: body.entity_id || ""
  };

  await appendRecord(SHEETS.USERS, record);

  sendOk(res, {
    message: "User created",
    user: stripPrivateUser(record)
  });
}

async function updateUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username"]);

  const patch = {};
  if (body.new_username !== undefined) patch.username = normalizeText(body.new_username);
  if (body.password !== undefined) patch.password = body.password;
  if (body.role !== undefined) patch.role = body.role;
  if (body.display_name !== undefined) patch.display_name = normalizeText(body.display_name);
  if (body.entity_id !== undefined) patch.entity_id = body.entity_id;

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(SHEETS.USERS, "username", body.username, patch);

  sendOk(res, {
    message: "User updated",
    user: stripPrivateUser(stripMeta(updated))
  });
}

async function deleteUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username"]);

  const updated = await updateByField(SHEETS.USERS, "username", body.username, { role: "deleted" });

  sendOk(res, {
    message: "User deleted"
  });
}

async function handleUsers(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listUsers(res, user);
  }

  if (req.method === "POST") {
    return createUser(req, res);
  }

  if (req.method === "PATCH") {
    return updateUser(req, res);
  }

  return deleteUser(req, res);
}

// ============ PAYMENTS HANDLERS ============

async function listShopPayments(res, user) {
  requireRole(user, [ROLES.ADMIN]);

  const records = await getRecords(SHEETS.PAYMENTS_SHOPS);

  sendOk(res, records);
}

async function createShopPayment(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["shop_id", "amount", "payment_date"]);

  const paymentId = id("payment");

  const record = {
    payment_id: paymentId,
    shop_id: body.shop_id,
    amount: toNumber(body.amount),
    payment_date: body.payment_date,
    note: body.note || "",
    recorded_by: req.user.username
  };

  await appendRecord(SHEETS.PAYMENTS_SHOPS, record);

  sendOk(res, {
    message: "Shop payment recorded",
    payment: record
  });
}

async function handlePaymentsShops(req, res) {
  ensureMethod(req, ["GET", "POST"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listShopPayments(res, user);
  }

  return createShopPayment(req, res);
}

async function listKarigarPayments(res, user) {
  requireRole(user, [ROLES.ADMIN]);

  const records = await getRecords(SHEETS.PAYMENTS_KARIGAR);

  sendOk(res, records);
}

async function createKarigarPayment(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["karigar_id", "amount", "payment_date"]);

  const paymentId = id("payment");

  const record = {
    payment_id: paymentId,
    karigar_id: body.karigar_id,
    amount: toNumber(body.amount),
    payment_date: body.payment_date,
    note: body.note || "",
    recorded_by: req.user.username
  };

  await appendRecord(SHEETS.PAYMENTS_KARIGAR, record);

  sendOk(res, {
    message: "Karigar payment recorded",
    payment: record
  });
}

async function handlePaymentsKarigar(req, res) {
  ensureMethod(req, ["GET", "POST"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listKarigarPayments(res, user);
  }

  return createKarigarPayment(req, res);
}

// ============ RATES HANDLERS ============

async function listShopRates(res, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.SHOP]);

  const records = await getRecords(SHEETS.SHOP_RATES);

  sendOk(res, records);
}

async function saveShopRates(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["rates"]);

  for (const rate of body.rates) {
    const record = {
      shop_id: rate.shop_id,
      piece_name: rate.piece_name,
      item_type: rate.item_type,
      rate: toNumber(rate.rate)
    };
    await appendRecord(SHEETS.SHOP_RATES, record);
  }

  sendOk(res, {
    message: "Shop rates saved"
  });
}

async function handleShopRates(req, res) {
  ensureMethod(req, ["GET", "POST"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listShopRates(res, user);
  }

  return saveShopRates(req, res);
}

async function listKarigarRates(res, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.KARIGAR]);

  const records = await getRecords(SHEETS.KARIGAR_RATES);

  sendOk(res, records);
}

async function saveKarigarRates(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["rates"]);

  for (const rate of body.rates) {
    const record = {
      karigar_id: rate.karigar_id,
      piece_name: rate.piece_name,
      item_type: rate.item_type,
      rate: toNumber(rate.rate)
    };
    await appendRecord(SHEETS.KARIGAR_RATES, record);
  }

  sendOk(res, {
    message: "Karigar rates saved"
  });
}

async function handleKarigarRates(req, res) {
  ensureMethod(req, ["GET", "POST"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listKarigarRates(res, user);
  }

  return saveKarigarRates(req, res);
}

// ============ SETTINGS HANDLERS ============

async function listSettings(res, user) {
  requireRole(user, [ROLES.ADMIN]);

  const records = await getRecords(SHEETS.SETTINGS);

  sendOk(res, records);
}

async function saveSettings(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["key", "value"]);

  const record = {
    key: body.key,
    value: body.value,
    description: body.description || ""
  };

  const existing = await getRecords(SHEETS.SETTINGS);
  const existingIndex = existing.findIndex(s => s.key === body.key);

  if (existingIndex >= 0) {
    await updateByField(SHEETS.SETTINGS, "key", body.key, record);
  } else {
    await appendRecord(SHEETS.SETTINGS, record);
  }

  sendOk(res, {
    message: "Setting saved"
  });
}

async function handleSettings(req, res) {
  ensureMethod(req, ["GET", "POST"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listSettings(res, user);
  }

  return saveSettings(req, res);
}

// ============ PIECES HANDLERS ============

async function markPieceCut(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN, ROLES.CUTTING]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);

  const updates = {
    cutting_done: true,
    cutting_by: user.username,
    cutting_date: nowISO()
  };

  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);

  sendOk(res, {
    message: "Piece marked cut"
  });
}

async function assignPiece(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["piece_id", "karigar_id"]);

  const updates = {
    assigned_karigar_id: body.karigar_id,
    assigned_date: nowISO(),
    karigar_status: STATUS.KARIGAR.ASSIGNED,
    designing_karigar_charge: toNumber(body.designing_karigar_charge || 0)
  };

  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);

  sendOk(res, {
    message: "Work assigned"
  });
}

async function completePiece(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN, ROLES.KARIGAR]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);

  const updates = {
    karigar_status: STATUS.KARIGAR.COMPLETE,
    karigar_complete_date: nowISO()
  };

  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);

  sendOk(res, {
    message: "Piece completed"
  });
}

async function handlePieceCut(req, res) {
  ensureMethod(req, ["POST"]);
  return markPieceCut(req, res);
}

async function handlePieceAssign(req, res) {
  ensureMethod(req, ["POST"]);
  return assignPiece(req, res);
}

async function handlePieceComplete(req, res) {
  ensureMethod(req, ["POST"]);
  return completePiece(req, res);
}

// ============ ME HANDLERS ============

async function handleMe(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);

  sendOk(res, {
    user,
    last_synced: new Date().toISOString()
  });
}

// ============ SNAPSHOT HANDLERS ============

function sanitizeSnapshot(snapshot) {
  return {
    ...snapshot,
    users: snapshot.users.map(stripMeta),
    shops: snapshot.shops.map(stripMeta),
    karigars: snapshot.karigars.map(stripMeta),
    orders: snapshot.orders.map(stripMeta),
    orderItems: snapshot.orderItems.map(stripMeta),
    pieces: snapshot.pieces.map(stripMeta),
    paymentsShops: snapshot.paymentsShops.map(stripMeta),
    paymentsKarigar: snapshot.paymentsKarigar.map(stripMeta),
    settings: snapshot.settings.map(stripMeta),
    shopRates: snapshot.shopRates.map(stripMeta),
    karigarRates: snapshot.karigarRates.map(stripMeta)
  };
}

async function handleSnapshot(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);
  const env = getEnv();

  await ensureWorkbook();
  await refreshOrderStatuses();

  const snapshot = await loadFullSnapshot();
  const withComputed = withComputedFields(snapshot);
  const filtered = filterSnapshotByRole(user, withComputed);

  sendOk(res, {
    data: sanitizeSnapshot(filtered),
    poll_interval_ms: env.pollIntervalMs,
    last_synced: new Date().toISOString()
  });
}

// ============ ORDERS HANDLERS ============

async function handleOrders(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    // list orders
    sendOk(res, {
      orders: [],
      last_synced: new Date().toISOString()
    });
  } else if (req.method === "POST") {
    // create order
    await ensureWorkbook();
    const body = await parseBody(req);
    // placeholder
    sendOk(res, { message: "Order created" });
  } else {
    // update order
    await ensureWorkbook();
    const body = await parseBody(req);
    // placeholder
    sendOk(res, { message: "Order updated" });
  }
}

async function handleShops(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listShops(res, user);
  }

  if (req.method === "POST") {
    return createShop(req, res);
  }

  return updateShop(req, res);
}

// ============ KARIGAR HANDLERS ============

async function listKarigar(res, user) {
  requireRole(user, [ROLES.ADMIN, ROLES.CUTTING]);

  const records = await getRecords(SHEETS.KARIGAR);

  sendOk(res, records);
}

async function createKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["name"]);

  const karigarId = normalizeText(body.karigar_id) || id("karigar");

  const existing = await getRecords(SHEETS.KARIGAR);
  if (existing.some((karigar) => karigar.karigar_id === karigarId)) {
    const error = new Error("karigar_id already exists");
    error.statusCode = 400;
    throw error;
  }

  const now = nowISO();
  const record = {
    karigar_id: karigarId,
    name: normalizeText(body.name),
    contact: normalizeText(body.contact),
    created_date: now
  };

  await appendRecord(SHEETS.KARIGAR, record);

  sendOk(res, {
    message: "Karigar created",
    karigar: record
  });
}

async function updateKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["karigar_id"]);

  const patch = {};
  if (body.name !== undefined) patch.name = normalizeText(body.name);
  if (body.contact !== undefined) patch.contact = normalizeText(body.contact);

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(SHEETS.KARIGAR, "karigar_id", body.karigar_id, patch);

  sendOk(res, {
    message: "Karigar updated",
    karigar: stripMeta(updated)
  });
}

async function handleKarigar(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listKarigar(res, user);
  }

  if (req.method === "POST") {
    return createKarigar(req, res);
  }

  return updateKarigar(req, res);
}

// ============ USERS HANDLERS ============

async function listUsers(res, user) {
  requireRole(user, [ROLES.ADMIN]);

  const records = await getRecords(SHEETS.USERS);

  sendOk(res, records.map(stripMeta));
}

async function createUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username", "password", "role", "display_name"]);

  const username = normalizeText(body.username);

  const existing = await getRecords(SHEETS.USERS);
  if (existing.some((user) => normalizeKey(user.username) === normalizeKey(username))) {
    const error = new Error("username already exists");
    error.statusCode = 400;
    throw error;
  }

  const record = {
    username,
    password: body.password,
    role: body.role,
    display_name: normalizeText(body.display_name),
    entity_id: body.entity_id || ""
  };

  await appendRecord(SHEETS.USERS, record);

  sendOk(res, {
    message: "User created",
    user: stripPrivateUser(record)
  });
}

async function updateUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username"]);

  const patch = {};
  if (body.new_username !== undefined) patch.username = normalizeText(body.new_username);
  if (body.password !== undefined) patch.password = body.password;
  if (body.role !== undefined) patch.role = body.role;
  if (body.display_name !== undefined) patch.display_name = normalizeText(body.display_name);
  if (body.entity_id !== undefined) patch.entity_id = body.entity_id;

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(SHEETS.USERS, "username", body.username, patch);

  sendOk(res, {
    message: "User updated",
    user: stripPrivateUser(stripMeta(updated))
  });
}

async function deleteUser(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["username"]);

  const updated = await updateByField(SHEETS.USERS, "username", body.username, { role: "deleted" });

  sendOk(res, {
    message: "User deleted"
  });
}

async function handleUsers(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listUsers(res, user);
  }

  if (req.method === "POST") {
    return createUser(req, res);
  }

  if (req.method === "PATCH") {
    return updateUser(req, res);
  }

  return deleteUser(req, res);
}

// ============ ME HANDLERS ============

async function handleMe(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);

  sendOk(res, {
    user,
    last_synced: new Date().toISOString()
  });
}

// ============ SNAPSHOT HANDLERS ============

async function handleSnapshot(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);

  const snapshot = await loadFullSnapshot();
  const filtered = filterSnapshotByRole(snapshot, user);

  sendOk(res, filtered);
}

// ============ ORDERS HANDLERS ============

async function handleOrders(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listOrders(res, user);
  }

  if (req.method === "POST") {
    return createOrder(req, res);
  }

  return updateOrder(req, res);
}

// ============ ROUTER ============

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const handlers = {
  bootstrap: withErrorHandler(handleBootstrap),
  login: withErrorHandler(handleLogin),
  getMe: withErrorHandler(handleMe),
  getSnapshot: withErrorHandler(handleSnapshot),
  listOrders: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleOrders(req, res); }),
  createOrder: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleOrders(req, res); }),
  updateOrder: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleOrders(req, res); }),
  markPieceCut: withErrorHandler(handlePieceCut),
  assignPiece: withErrorHandler(handlePieceAssign),
  completePiece: withErrorHandler(handlePieceComplete),
  listShops: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleShops(req, res); }),
  createShop: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleShops(req, res); }),
  updateShop: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleShops(req, res); }),
  listKarigar: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleKarigar(req, res); }),
  createKarigar: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleKarigar(req, res); }),
  updateKarigar: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleKarigar(req, res); }),
  listShopRates: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleShopRates(req, res); }),
  saveShopRates: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleShopRates(req, res); }),
  listKarigarRates: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleKarigarRates(req, res); }),
  saveKarigarRates: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleKarigarRates(req, res); }),
  listShopPayments: withErrorHandler(async (req, res) => { req.method = 'GET'; return handlePaymentsShops(req, res); }),
  createShopPayment: withErrorHandler(async (req, res) => { req.method = 'POST'; return handlePaymentsShops(req, res); }),
  listKarigarPayments: withErrorHandler(async (req, res) => { req.method = 'GET'; return handlePaymentsKarigar(req, res); }),
  createKarigarPayment: withErrorHandler(async (req, res) => { req.method = 'POST'; return handlePaymentsKarigar(req, res); }),
  listUsers: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleUsers(req, res); }),
  createUser: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleUsers(req, res); }),
  updateUser: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleUsers(req, res); }),
  deleteUser: withErrorHandler(async (req, res) => { req.method = 'DELETE'; return handleUsers(req, res); }),
  listSettings: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleSettings(req, res); }),
  saveSettings: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleSettings(req, res); })
};

module.exports = async function (req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const action = url.searchParams.get('action');

  if (!action || !handlers[action]) {
    return sendJson(res, 404, { error: "Not found" });
  }

  return handlers[action](req, res);
};
