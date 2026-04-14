const { URL } = require("url");
const bcrypt = require("bcryptjs");
const { ROLES, SHEETS, STATUS } = require("../server/api/_lib/constants");
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
  appendRecords,
  appendRecordsBatch,
  ensureWorkbook,
  getRecords,
  updateByField,
  updateMany
} = require("../server/api/_lib/sheets");
const { resolvePhotoInput } = require("../server/api/_lib/media");
const {
  id,
  normalizeKey,
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
  sendJSON,
  toNumber,
  withErrorHandler
} = require("../server/api/_lib/utils");

// ============ BOOTSTRAP HANDLERS ============

const DEFAULT_SETTINGS = [
  { key: "item_types", value: "normal,vip,chapma", description: "Allowed item types" },
  { key: "piece_types", value: "coat,pent,waistcoat,suit_2piece,suit_3piece", description: "Supported order piece types" },
  { key: "cutting_rate", value: "0", description: "Default cutting rate per piece" },
  { key: "cutting_rate_default", value: "0", description: "Default cutting rate used in piece crediting" },
  { key: "approval_requires_photo", value: "false", description: "Whether completion approval requires photo upload" },
  { key: "order_due_sorting", value: "asc", description: "Default order sorting by due date" },
  { key: "payroll_sync_mode", value: "manual_master", description: "Payroll posting mode" },
  { key: "invoice_prefix", value: "INV", description: "Prefix for generated shop invoices" }
];

async function seedDefaults() {
  const settings = await getRecords(SHEETS.SETTINGS);
  const existingKeys = new Set(settings.map((row) => row.key));
  const missing = DEFAULT_SETTINGS.filter((row) => !existingKeys.has(row.key));
  if (missing.length) await appendRecords(SHEETS.SETTINGS, missing);
}

async function handleBootstrap(req, res) {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();
  const users = await getRecords(SHEETS.USERS);
  const body = await parseBody(req);

  if (!users.length) {
    requireFields(body, ["bootstrap_key", "admin_username", "admin_password", "admin_display_name"]);
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
    return sendOk(res, { message: "Workbook bootstrapped with initial admin user" });
  }
  requireRole(req, [ROLES.ADMIN]);
  await seedDefaults();
  sendOk(res, { message: "Default settings ensured" });
}

// ============ LOGIN HANDLERS ============

async function handleLogin(req, res) {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();
  const existingUsers = await getRecords(SHEETS.USERS);
  if (!existingUsers.length) throw new Error("No users found. Bootstrap first.");
  const body = await parseBody(req);
  requireFields(body, ["username", "password"]);
  const user = await authenticate(body.username, body.password);
  const token = createToken(user);
  const env = getEnv();
  sendOk(res, { token, user, poll_interval_ms: env.pollIntervalMs, last_synced: nowISO() });
}

// ============ UTILS ============

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

// ============ ME & SNAPSHOT ============

async function handleMe(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);
  sendOk(res, { user, last_synced: nowISO() });
}

function sanitizeSnapshot(snapshot) {
  const stripMetaSafe = (arr) => (Array.isArray(arr) ? arr.map(stripMeta) : []);
  return {
    ...snapshot,
    users: stripMetaSafe(snapshot.users),
    shops: stripMetaSafe(snapshot.shops),
    karigars: stripMetaSafe(snapshot.karigars),
    orders: stripMetaSafe(snapshot.orders),
    orderItems: stripMetaSafe(snapshot.orderItems),
    pieces: stripMetaSafe(snapshot.pieces),
    paymentsShops: stripMetaSafe(snapshot.paymentsShops),
    paymentsKarigar: stripMetaSafe(snapshot.paymentsKarigar),
    settings: stripMetaSafe(snapshot.settings),
    products: stripMetaSafe(snapshot.products),
    productSubProducts: stripMetaSafe(snapshot.productSubProducts),
    shopInvoices: stripMetaSafe(snapshot.shopInvoices),
    shopInvoiceLines: stripMetaSafe(snapshot.shopInvoiceLines),
    payrollSyncRuns: stripMetaSafe(snapshot.payrollSyncRuns)
  };
}

async function handleSnapshot(req, res) {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);
  await ensureWorkbook();
  await refreshOrderStatuses();
  const snapshot = await loadFullSnapshot();
  const withComputed = withComputedFields(snapshot);
  const filtered = filterSnapshotByRole(user, withComputed);
  sendOk(res, { data: sanitizeSnapshot(filtered), last_synced: nowISO() });
}

// ============ ORDERS ============

async function handleOrders(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, { orders: [] });
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);

  if (req.method === "POST") {
    requireFields(body, ["order_number", "shop_id", "delivery_date", "items"]);
    const now = nowISO();
    let slipPhotoUrl = "";
    if (body.slip_photo_data_url) {
      const res = await resolvePhotoInput({ photoDataUrl: body.slip_photo_data_url, folder: "slips" });
      slipPhotoUrl = res.photoUrl;
    }
    const orderId = id("order");
    const orderRecord = {
      order_id: orderId,
      order_number: normalizeText(body.order_number),
      shop_id: normalizeText(body.shop_id),
      delivery_date: normalizeText(body.delivery_date),
      designing_enabled: String(!!body.designing_enabled),
      designing_shop_charge: toNumber(body.designing_shop_charge),
      slip_photo_url: slipPhotoUrl,
      status: STATUS.ORDER.PENDING,
      is_archived: "FALSE",
      billed_date: "",
      created_date: now,
      updated_date: now
    };
    const items = body.items.map(i => ({
      item_id: id("item"),
      order_id: orderId,
      product_id: normalizeText(i.product_id || ""),
      item_type: normalizeText(i.item_type || "normal"),
      piece_type: normalizeText(i.piece_type || "coat"),
      status: "pending",
      item_rate: toNumber(i.item_rate),
      measurement_photo_url: normalizeText(i.measurement_photo_url || "")
    }));
    await appendRecordsBatch([{ tabName: SHEETS.ORDERS, records: [orderRecord] }, { tabName: SHEETS.ORDER_ITEMS, records: items }]);
    return sendOk(res, { message: "Order created", order: orderRecord });
  }

  requireFields(body, ["order_id"]);
  const patch = { ...body, updated_date: nowISO() };
  if (patch.is_archived) patch.is_archived = String(patch.is_archived).toUpperCase();
  const updated = await updateByField(SHEETS.ORDERS, "order_id", body.order_id, patch);
  sendOk(res, { message: "Order updated", order: updated });
}

async function extractOrder(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["order_id"]);
  const snapshot = await loadFullSnapshot();
  const order = snapshot.orders.find(o => o.order_id === body.order_id);
  if (!order) throw new Error("Order not found");
  const items = snapshot.orderItems.filter(i => i.order_id === body.order_id);
  const now = nowISO();
  const pieces = [];
  for (const item of items) {
    const product =
      snapshot.products.find(p => p.product_id === item.product_id) ||
      snapshot.products.find(p => normalizeKey(p.product_name) === normalizeKey(item.piece_type));
    const subs = product
      ? snapshot.productSubProducts.filter(s => s.product_id === product.product_id)
      : [];
    const effectiveSubs = subs.length
      ? subs
      : [{
          sub_product_name: item.piece_type || product?.product_name || "piece",
          worker_rate: 0
        }];

    const fallbackShopRate = product ? toNumber(product.shop_rate) : toNumber(item.item_rate);
    for (const sub of effectiveSubs) {
      pieces.push({
        piece_id: id("piece"),
        item_id: item.item_id,
        order_id: body.order_id,
        piece_name: sub.sub_product_name,
        sub_product_name: sub.sub_product_name,
        item_type: item.item_type,
        cutting_done: "FALSE",
        karigar_status: STATUS.KARIGAR.NOT_ASSIGNED,
        measurement_photo_url: item.measurement_photo_url,
        reference_slip_url: order.slip_photo_url,
        cutting_credit_amount: toNumber(product?.cutting_rate || 0),
        shop_rate: fallbackShopRate,
        karigar_rate: toNumber(sub.worker_rate),
        is_synced: "FALSE",
        bundle_piece_type: product.product_name || item.piece_type,
        created_date: now,
        updated_date: now
      });
    }
  }
  if (pieces.length) await appendRecords(SHEETS.PIECES, pieces);
  sendOk(res, { message: `${pieces.length} pieces extracted` });
}

// ============ WORKFLOW ============

async function markPieceCut(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN, ROLES.CUTTING]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const updates = {
    cutting_done: "TRUE",
    cutting_by: user.username,
    cutting_date: nowISO(),
    updated_date: nowISO()
  };
  if (body.photo_data_url) {
    const res = await resolvePhotoInput({ photoDataUrl: body.photo_data_url, folder: "cutting" });
    updates.cutting_photo_url = res.photoUrl;
  }
  const pieces = await getRecords(SHEETS.PIECES);
  const target = pieces.find((piece) => piece.piece_id === body.piece_id);
  if (!target) {
    const error = new Error("Piece not found");
    error.statusCode = 404;
    throw error;
  }

  const related = pieces.filter((piece) => piece.item_id === target.item_id);
  if (related.length > 1) {
    await updateMany(
      SHEETS.PIECES,
      related.map((piece) => ({
        rowNumber: piece.__rowNumber,
        record: { ...piece, ...updates }
      }))
    );
    return sendOk(res, { message: `${related.length} related pieces marked cut` });
  }

  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Piece cut" });
}

async function assignPiece(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id", "karigar_id"]);
  const updates = { assigned_karigar_id: body.karigar_id, assigned_date: nowISO(), karigar_status: STATUS.KARIGAR.ASSIGNED, designing_karigar_charge: toNumber(body.designing_karigar_charge || 0) };
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Work assigned" });
}

async function requestApproval(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN, ROLES.KARIGAR]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const updates = { karigar_status: STATUS.KARIGAR.PENDING_APPROVAL, karigar_complete_date: nowISO(), updated_date: nowISO() };
  if (body.photo_data_url) {
    const res = await resolvePhotoInput({ photoDataUrl: body.photo_data_url, folder: "completion" });
    updates.completion_photo_url = res.photoUrl;
  }
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Approval requested" });
}

async function approvePiece(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const updates = { karigar_status: STATUS.KARIGAR.COMPLETE, completion_verified: "TRUE", completion_verified_date: nowISO(), updated_date: nowISO() };
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Piece approved" });
}

async function syncPayroll(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const syncId = id("sync");
  const pieces = await getRecords(SHEETS.PIECES);
  const toSync = pieces.filter(p => normalizeKey(p.karigar_status) === STATUS.KARIGAR.COMPLETE && normalizeKey(p.is_synced) !== "true");
  if (!toSync.length) return sendOk(res, { message: "No pieces to sync" });
  const updates = toSync.map(p => ({ rowNumber: p.__rowNumber, record: { ...p, is_synced: "TRUE", sync_id: syncId, updated_date: nowISO() } }));
  await updateMany(SHEETS.PIECES, updates);
  sendOk(res, { message: `${toSync.length} pieces synced`, sync_id: syncId });
}

async function generateInvoice(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["shop_id", "order_ids", "total_amount"]);
  const now = nowISO();
  const orders = await getRecords(SHEETS.ORDERS);
  const targetIds = new Set(body.order_ids);
  const orderUpdates = orders.filter(o => targetIds.has(o.order_id)).map(o => ({ rowNumber: o.__rowNumber, record: { ...o, is_archived: "TRUE", billed_date: now, updated_date: now } }));
  if (orderUpdates.length) await updateMany(SHEETS.ORDERS, orderUpdates);
  await appendRecord(SHEETS.SHOP_INVOICES, { invoice_id: id("inv"), shop_id: body.shop_id, total_amount: toNumber(body.total_amount), generated_date: now, order_ids: body.order_ids.join(",") });
  sendOk(res, { message: "Invoice generated" });
}

// ============ PRODUCTS ============

async function handleProducts(req, res) {
  ensureMethod(req, ["GET", "POST", "DELETE"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.PRODUCTS));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  if (req.method === "POST") {
    const record = {
      product_id: body.product_id || id("prod"),
      product_name: normalizeText(body.product_name),
      shop_name: normalizeText(body.shop_name),
      shop_rate: toNumber(body.shop_rate),
      cutting_rate: toNumber(body.cutting_rate),
      is_active: "TRUE",
      created_date: nowISO(),
      updated_date: nowISO()
    };
    await appendRecord(SHEETS.PRODUCTS, record);
    return sendOk(res, { message: "Product saved", record });
  }
}

async function handleProductSubProducts(req, res) {
  ensureMethod(req, ["GET", "POST"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.PRODUCT_SUB_PRODUCTS));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  if (req.method === "POST") {
    const record = { sub_id: id("sub"), product_id: body.product_id, sub_product_name: normalizeText(body.sub_product_name), worker_rate: toNumber(body.worker_rate) };
    await appendRecord(SHEETS.PRODUCT_SUB_PRODUCTS, record);
    return sendOk(res, { message: "Sub-product saved", record });
  }
}

// ============ SHOPS, KARIGAR, USERS, PAYMENTS ============

async function handleShops(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);
  const user = requireAuth(req);
  if (req.method === "GET") return listShops(res, user);
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  if (req.method === "POST") {
    const record = { shop_id: id("shop"), shop_name: normalizeText(body.shop_name), contact: normalizeText(body.contact || ""), created_date: nowISO() };
    await appendRecord(SHEETS.SHOPS, record);
    return sendOk(res, { message: "Shop created", record });
  }
  const updated = await updateByField(SHEETS.SHOPS, "shop_id", body.shop_id, { ...body });
  sendOk(res, { message: "Shop updated", record: updated });
}

async function handleKarigar(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.KARIGAR));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  if (req.method === "POST") {
    const record = { karigar_id: id("karigar"), name: normalizeText(body.name), contact: normalizeText(body.contact || ""), skills: normalizeText(body.skills || ""), created_date: nowISO() };
    await appendRecord(SHEETS.KARIGAR, record);
    return sendOk(res, { message: "Karigar created", record });
  }
  const updated = await updateByField(SHEETS.KARIGAR, "karigar_id", body.karigar_id, { ...body });
  sendOk(res, { message: "Karigar updated", record: updated });
}

async function handleUsers(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, (await getRecords(SHEETS.USERS)).map(stripMeta));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  if (req.method === "POST") {
    const hashed = await bcrypt.hash(String(body.password), 10);
    const record = { username: normalizeText(body.username), password: hashed, role: body.role, display_name: normalizeText(body.display_name), entity_id: body.entity_id || "" };
    await appendRecord(SHEETS.USERS, record);
    return sendOk(res, { message: "User created", user: stripPrivateUser(record) });
  }
  if (req.method === "DELETE") {
    await updateByField(SHEETS.USERS, "username", body.username, { role: "deleted" });
    return sendOk(res, { message: "User deleted" });
  }
  const patch = { ...body };
  if (patch.password) patch.password = await bcrypt.hash(String(patch.password), 10);
  const updated = await updateByField(SHEETS.USERS, "username", body.username, patch);
  sendOk(res, { message: "User updated", user: stripPrivateUser(updated) });
}

async function handlePaymentsShops(req, res) {
  ensureMethod(req, ["GET", "POST"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.PAYMENTS_SHOPS));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  const record = { payment_id: id("pay"), shop_id: body.shop_id, amount: toNumber(body.amount), payment_date: body.payment_date, note: body.note || "", recorded_by: user.username };
  await appendRecord(SHEETS.PAYMENTS_SHOPS, record);
  sendOk(res, { message: "Payment recorded", record });
}

async function handlePaymentsKarigar(req, res) {
  ensureMethod(req, ["GET", "POST"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.PAYMENTS_KARIGAR));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  const record = { payment_id: id("pay"), karigar_id: body.karigar_id, amount: toNumber(body.amount), payment_date: body.payment_date, note: body.note || "", recorded_by: user.username };
  await appendRecord(SHEETS.PAYMENTS_KARIGAR, record);
  sendOk(res, { message: "Payment recorded", record });
}

async function handleSettings(req, res) {
  ensureMethod(req, ["GET", "POST"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.SETTINGS));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);
  await updateByField(SHEETS.SETTINGS, "key", body.key, body);
  sendOk(res, { message: "Setting updated" });
}

// ============ ROUTER ============

const handlers = {
  bootstrap: withErrorHandler(handleBootstrap),
  login: withErrorHandler(handleLogin),
  getMe: withErrorHandler(handleMe),
  getSnapshot: withErrorHandler(handleSnapshot),
  listOrders: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleOrders(req, res); }),
  createOrder: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleOrders(req, res); }),
  updateOrder: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleOrders(req, res); }),
  extractOrder: withErrorHandler(extractOrder),
  requestApproval: withErrorHandler(requestApproval),
  approvePiece: withErrorHandler(approvePiece),
  syncPayroll: withErrorHandler(syncPayroll),
  generateInvoice: withErrorHandler(generateInvoice),
  markPieceCut: withErrorHandler(markPieceCut),
  assignPiece: withErrorHandler(assignPiece),
  completePiece: withErrorHandler(requestApproval),
  listShops: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleShops(req, res); }),
  createShop: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleShops(req, res); }),
  updateShop: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleShops(req, res); }),
  listKarigar: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleKarigar(req, res); }),
  createKarigar: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleKarigar(req, res); }),
  updateKarigar: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleKarigar(req, res); }),
  listProducts: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleProducts(req, res); }),
  saveProduct: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleProducts(req, res); }),
  listSubProducts: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleProductSubProducts(req, res); }),
  saveSubProduct: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleProductSubProducts(req, res); }),
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
  // #region agent log
  fetch('http://127.0.0.1:7303/ingest/470ad46e-749f-4aff-a2a7-ed436dce2a04',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'672361'},body:JSON.stringify({sessionId:'672361',runId:'pre-fix',hypothesisId:'H7',location:'api/index.js:467',message:'API entry hit',data:{method:req?.method||'',url:req?.url||''},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.statusCode = 200; return res.end(); }
  const url = new URL(req.url || "/", "http://localhost");
  const action = url.searchParams.get("action");
  if (!action || !handlers[action]) return sendJSON(res, 404, { ok: false, message: `Not found: ${action || "<none>"}` });
  try { return await handlers[action](req, res); } catch (error) {
    console.error("[API ERROR]", action, error);
    return sendJSON(res, error.statusCode || 500, { ok: false, message: error.message || "Server error" });
  }
};
