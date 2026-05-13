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
  deleteByField,
  ensureWorkbook,
  getManyRecords,
  getRecords,
  updateByField,
  updateMany,
  clearAllDataTabs
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

function findLinkedEntityUser(users, role, entityId, fallbackName = "") {
  const fallbackKey = normalizeKey(fallbackName);
  return (users || []).find((entry) => {
    if (normalizeKey(entry.role) !== normalizeKey(role)) return false;
    if (entityId && normalizeKey(entry.entity_id) === normalizeKey(entityId)) return true;
    if (!fallbackKey) return false;
    return (
      normalizeKey(entry.display_name) === fallbackKey ||
      normalizeKey(entry.username) === fallbackKey
    );
  });
}

function assertUniqueUsername(users, username, ignoreUsername = "") {
  const usernameKey = normalizeKey(username);
  const ignoreKey = normalizeKey(ignoreUsername);
  const duplicate = (users || []).find(
    (entry) =>
      normalizeKey(entry.username) === usernameKey &&
      normalizeKey(entry.username) !== ignoreKey
  );
  if (duplicate) {
    const error = new Error(`Username already exists: ${username}`);
    error.statusCode = 400;
    throw error;
  }
}

function assertUniqueField(records, field, value, ignoreField = "", ignoreValue = "") {
  const valueKey = normalizeKey(value);
  const ignoreKey = normalizeKey(ignoreValue);
  const duplicate = (records || []).find((entry) => {
    if (normalizeKey(entry[field]) !== valueKey) return false;
    if (ignoreField && ignoreKey && normalizeKey(entry[ignoreField]) === ignoreKey) {
      return false;
    }
    return true;
  });

  if (duplicate) {
    const error = new Error(`${field} already exists: ${value}`);
    error.statusCode = 400;
    throw error;
  }
}

function normalizeRoleValue(value) {
  return normalizeKey(value).replace(/[\s-]+/g, "_");
}

function normalizeRoleList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeRoleValue).filter(Boolean))];
  }

  return [
    ...new Set(
      String(value || "")
        .split(/[,|;]/)
        .map(normalizeRoleValue)
        .filter(Boolean)
    )
  ];
}

function inferWorkerRole(pieceName = "") {
  const key = normalizeRoleValue(pieceName);
  if (key.includes("waistcoat")) return "waistcoat_maker";
  if (key.includes("coat")) return "coat_maker";
  if (key.includes("pent") || key.includes("pant")) return "pent_maker";
  return "";
}

function karigarHasRole(karigar, requiredRole) {
  if (!requiredRole) return true;
  const roles = new Set([
    ...normalizeRoleList(karigar?.role),
    ...normalizeRoleList(karigar?.skills)
  ]);
  return roles.has(requiredRole);
}

function assertKarigarRole(karigar, requiredRole, pieceName) {
  if (karigarHasRole(karigar, requiredRole)) return;

  const error = new Error(
    `${karigar?.name || "Selected karigar"} is not eligible for ${pieceName || "this work"}`
  );
  error.statusCode = 400;
  throw error;
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
    archivedOrders: stripMetaSafe(snapshot.archivedOrders),
    orderItems: stripMetaSafe(snapshot.orderItems),
    pieces: stripMetaSafe(snapshot.pieces),
    archivedPieces: stripMetaSafe(snapshot.archivedPieces),
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
  const snapshot = await loadFullSnapshot();
  await refreshOrderStatuses([], snapshot);
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
    const products = await getRecords(SHEETS.PRODUCTS);
    const items = body.items.map((i) => {
      const product = products.find((p) => p.product_id === i.product_id);
      const productRate = toNumber(product?.product_price || product?.shop_rate);
      return {
        item_id: id("item"),
        order_id: orderId,
        product_id: normalizeText(i.product_id || ""),
        item_type: normalizeText(i.item_type || "normal"),
        piece_type: normalizeText(product?.product_name || i.piece_type || "coat"),
        status: "pending",
        item_rate: toNumber(i.item_rate) || productRate,
        measurement_photo_url: normalizeText(i.measurement_photo_url || "")
      };
    });
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
        assigned_role: normalizeRoleValue(sub.required_skill || "") || inferWorkerRole(sub.sub_product_name),
        measurement_photo_url: item.measurement_photo_url,
        reference_slip_url: order.slip_photo_url,
        cutting_credit_amount: toNumber(product?.cutting_rate || 0),
        shop_rate: fallbackShopRate,
        karigar_rate: toNumber(sub.worker_rate),
        is_synced: "FALSE",
        bundle_piece_type: product?.product_name || item.piece_type,
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
  requireRole(user, [ROLES.ADMIN, ROLES.CUTTING, ROLES.KARIGAR]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const {
    [SHEETS.PIECES]: pieces,
    [SHEETS.KARIGAR]: karigars
  } = await getManyRecords([SHEETS.PIECES, SHEETS.KARIGAR]);

  let cuttingBy = user.username;
  if (user.role === ROLES.KARIGAR) {
    const worker = karigars.find((entry) => entry.karigar_id === user.entity_id);
    assertKarigarRole(worker, "cutting_master", "cutting");
    cuttingBy = user.entity_id;
  } else if (body.cutting_karigar_id) {
    const worker = karigars.find((entry) => entry.karigar_id === body.cutting_karigar_id);
    if (!worker) {
      const error = new Error("Cutting master not found");
      error.statusCode = 404;
      throw error;
    }
    assertKarigarRole(worker, "cutting_master", "cutting");
    cuttingBy = worker.karigar_id;
  }

  const updates = {
    cutting_done: "TRUE",
    cutting_by: cuttingBy,
    cutting_date: nowISO(),
    updated_date: nowISO()
  };
  if (body.photo_data_url) {
    const res = await resolvePhotoInput({ photoDataUrl: body.photo_data_url, folder: "cutting" });
    updates.cutting_photo_url = res.photoUrl;
  }
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
  const {
    [SHEETS.PIECES]: pieces,
    [SHEETS.KARIGAR]: karigars
  } = await getManyRecords([SHEETS.PIECES, SHEETS.KARIGAR]);
  const piece = pieces.find((entry) => entry.piece_id === body.piece_id);
  if (!piece) {
    const error = new Error("Piece not found");
    error.statusCode = 404;
    throw error;
  }
  const karigar = karigars.find((entry) => entry.karigar_id === body.karigar_id);
  if (!karigar) {
    const error = new Error("Karigar not found");
    error.statusCode = 404;
    throw error;
  }

  const requiredRole =
    normalizeRoleValue(piece.assigned_role || piece.required_skill || "") ||
    inferWorkerRole(piece.piece_name);
  assertKarigarRole(karigar, requiredRole, piece.piece_name);

  const updates = {
    assigned_karigar_id: body.karigar_id,
    assigned_role: requiredRole,
    assigned_date: nowISO(),
    karigar_status: STATUS.KARIGAR.ASSIGNED,
    designing_karigar_charge: toNumber(body.designing_karigar_charge || 0)
  };
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Work assigned" });
}

async function requestApproval(req, res) {
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN, ROLES.KARIGAR]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const now = nowISO();
  const updates = {
    karigar_status: STATUS.KARIGAR.PENDING_APPROVAL,
    karigar_complete_date: now,
    approval_requested_by: user.entity_id || user.username || "",
    approval_requested_date: now,
    updated_date: now
  };
  if (body.photo_url) {
    updates.completion_photo_url = normalizeText(body.photo_url);
  } else if (body.photo_data_url) {
    const resolved = await resolvePhotoInput({ photoDataUrl: body.photo_data_url, folder: "completion" });
    updates.completion_photo_url = resolved.photoUrl;
  }
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Approval requested" });
}

async function approvePiece(req, res) {
  const user = requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);
  const now = nowISO();
  const updates = {
    karigar_status: STATUS.KARIGAR.COMPLETE,
    approved_by: user.username || "",
    approved_date: now,
    completion_verified: "TRUE",
    completion_verified_date: now,
    updated_date: now
  };
  await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, updates);
  sendOk(res, { message: "Piece approved" });
}

async function syncPayroll(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();
  const syncId = id("sync");
  const {
    [SHEETS.PIECES]: pieces,
    [SHEETS.KARIGAR]: karigars
  } = await getManyRecords([SHEETS.PIECES, SHEETS.KARIGAR]);
  const karigarIds = new Set(karigars.map((karigar) => karigar.karigar_id));
  const completedWork = pieces.filter(
    (p) =>
      normalizeKey(p.karigar_status) === STATUS.KARIGAR.COMPLETE &&
      normalizeKey(p.is_synced) !== "true"
  );
  const cuttingWork = pieces.filter(
    (p) =>
      parseBoolean(p.cutting_done) &&
      karigarIds.has(p.cutting_by) &&
      normalizeKey(p.cutting_credit_synced) !== "true"
  );

  if (!completedWork.length && !cuttingWork.length) {
    return sendOk(res, { message: "No pieces to sync" });
  }

  const updatesByPieceId = new Map();
  completedWork.forEach((piece) => {
    updatesByPieceId.set(piece.piece_id, {
      rowNumber: piece.__rowNumber,
      record: {
        ...piece,
        is_synced: "TRUE",
        payroll_state: STATUS.PAYROLL.SYNCED,
        sync_id: syncId,
        synced_date: nowISO(),
        updated_date: nowISO()
      }
    });
  });
  cuttingWork.forEach((piece) => {
    const existing = updatesByPieceId.get(piece.piece_id);
    const baseRecord = existing?.record || piece;
    updatesByPieceId.set(piece.piece_id, {
      rowNumber: piece.__rowNumber,
      record: {
        ...baseRecord,
        cutting_credit_synced: "TRUE",
        payroll_state: STATUS.PAYROLL.SYNCED,
        sync_id: syncId,
        synced_date: nowISO(),
        updated_date: nowISO()
      }
    });
  });

  const updates = Array.from(updatesByPieceId.values());
  await updateMany(SHEETS.PIECES, updates);
  const cuttingCredits = cuttingWork.map((piece) => ({
    ...piece,
    assigned_karigar_id: piece.cutting_by,
    piece_name: `Cutting: ${piece.bundle_piece_type || piece.piece_name}`,
    karigar_rate: toNumber(piece.cutting_credit_amount),
    designing_karigar_charge: 0
  }));
  const syncedPieces = [...completedWork, ...cuttingCredits];
  const totalAmount = syncedPieces.reduce(
    (sum, piece) => sum + toNumber(piece.karigar_rate) + toNumber(piece.designing_karigar_charge),
    0
  );
  await appendRecord(SHEETS.PAYROLL_SYNC_RUNS, {
    sync_id: syncId,
    triggered_by: requireAuth(req).username || "",
    triggered_date: nowISO(),
    piece_count: syncedPieces.length,
    total_amount: totalAmount,
    status: STATUS.SYNC_RUN.COMPLETED,
    note: "Synced to payroll and moved to archive"
  });
  sendOk(res, { 
    message: `${completedWork.length + cuttingWork.length} work credits synced`,
    sync_id: syncId,
    syncedPieces
  });
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
      shop_rate: toNumber(body.product_price || body.shop_rate),
      product_price: toNumber(body.product_price || body.shop_rate),
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
    const subProductName = normalizeText(body.sub_product_name);
    const requiredSkill =
      normalizeRoleValue(body.required_skill || "") || inferWorkerRole(subProductName);
    const record = {
      sub_id: id("sub"),
      product_id: body.product_id,
      sub_product_name: subProductName,
      worker_rate: toNumber(body.worker_rate),
      required_skill: requiredSkill
    };
    await appendRecord(SHEETS.PRODUCT_SUB_PRODUCTS, record);
    return sendOk(res, { message: "Sub-product saved", record });
  }
}

// ============ SHOPS, KARIGAR, USERS, PAYMENTS ============

async function handleShops(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.SHOPS));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);

  if (req.method === "POST") {
    requireFields(body, ["shop_name", "password"]);
    const shopName = normalizeText(body.shop_name);
    const username = shopName;
    const now = nowISO();
    const { [SHEETS.SHOPS]: shops, [SHEETS.USERS]: users } = await getManyRecords([
      SHEETS.SHOPS,
      SHEETS.USERS
    ]);

    assertUniqueField(shops, "shop_name", shopName);
    assertUniqueUsername(users, username);

    const shopId = id("shop");
    const record = {
      shop_id: shopId,
      shop_name: shopName,
      contact: normalizeText(body.contact || ""),
      created_date: now
    };
    const userRecord = {
      username,
      password: await bcrypt.hash(String(body.password), 10),
      role: ROLES.SHOP,
      display_name: shopName,
      entity_id: shopId
    };

    console.log("[ACCOUNT] Creating linked shop account", { shop_id: shopId, username });
    await appendRecordsBatch([
      { tabName: SHEETS.SHOPS, records: [record] },
      { tabName: SHEETS.USERS, records: [userRecord] }
    ]);
    return sendOk(res, {
      message: "Shop created with login account",
      record,
      user: stripPrivateUser(userRecord)
    });
  }

  if (req.method === "DELETE") {
    requireFields(body, ["shop_id"]);
    const {
      [SHEETS.SHOPS]: shops,
      [SHEETS.USERS]: users,
      [SHEETS.ORDERS]: orders,
      [SHEETS.PAYMENTS_SHOPS]: paymentsShops
    } = await getManyRecords([
      SHEETS.SHOPS,
      SHEETS.USERS,
      SHEETS.ORDERS,
      SHEETS.PAYMENTS_SHOPS
    ]);

    const existingShop = shops.find((entry) => entry.shop_id === body.shop_id);
    if (!existingShop) {
      const error = new Error("Shop not found");
      error.statusCode = 404;
      throw error;
    }

    if (
      orders.some((entry) => entry.shop_id === body.shop_id) ||
      paymentsShops.some((entry) => entry.shop_id === body.shop_id)
    ) {
      const error = new Error("Cannot delete shop with linked orders or payments");
      error.statusCode = 400;
      throw error;
    }

    const linkedUser = findLinkedEntityUser(
      users,
      ROLES.SHOP,
      body.shop_id,
      existingShop.shop_name
    );

    if (linkedUser) {
      console.log("[ACCOUNT] Deleting linked shop account", {
        shop_id: body.shop_id,
        username: linkedUser.username
      });
      await deleteByField(SHEETS.USERS, "username", linkedUser.username);
    }

    await deleteByField(SHEETS.SHOPS, "shop_id", body.shop_id);
    return sendOk(res, { message: "Shop deleted" });
  }

  requireFields(body, ["shop_id"]);
  const { [SHEETS.SHOPS]: shops, [SHEETS.USERS]: users } = await getManyRecords([
    SHEETS.SHOPS,
    SHEETS.USERS
  ]);
  const existingShop = shops.find((entry) => entry.shop_id === body.shop_id);
  if (!existingShop) {
    const error = new Error("Shop not found");
    error.statusCode = 404;
    throw error;
  }

  const nextShopName = normalizeText(body.shop_name || existingShop.shop_name);
  const nextContact =
    body.contact === undefined ? existingShop.contact || "" : normalizeText(body.contact);

  assertUniqueField(shops, "shop_name", nextShopName, "shop_id", body.shop_id);

  const updated = await updateByField(SHEETS.SHOPS, "shop_id", body.shop_id, {
    shop_name: nextShopName,
    contact: nextContact
  });

  const linkedUser = findLinkedEntityUser(
    users,
    ROLES.SHOP,
    body.shop_id,
    existingShop.shop_name
  );
  const nextUsername = nextShopName;

  if (linkedUser) {
    assertUniqueUsername(users, nextUsername, linkedUser.username);
    const userPatch = {
      username: nextUsername,
      role: ROLES.SHOP,
      display_name: nextShopName,
      entity_id: body.shop_id
    };
    if (body.password) {
      userPatch.password = await bcrypt.hash(String(body.password), 10);
    }
    console.log("[ACCOUNT] Updating linked shop account", {
      shop_id: body.shop_id,
      username: nextUsername
    });
    await updateByField(SHEETS.USERS, "username", linkedUser.username, userPatch);
  } else if (body.password) {
    assertUniqueUsername(users, nextUsername);
    const userRecord = {
      username: nextUsername,
      password: await bcrypt.hash(String(body.password), 10),
      role: ROLES.SHOP,
      display_name: nextShopName,
      entity_id: body.shop_id
    };
    console.log("[ACCOUNT] Recreating missing shop account", {
      shop_id: body.shop_id,
      username: nextUsername
    });
    await appendRecord(SHEETS.USERS, userRecord);
  }

  sendOk(res, { message: "Shop updated", record: updated });
}

async function handleKarigar(req, res) {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);
  const user = requireAuth(req);
  if (req.method === "GET") return sendOk(res, await getRecords(SHEETS.KARIGAR));
  requireRole(user, [ROLES.ADMIN]);
  const body = await parseBody(req);

  if (req.method === "POST") {
    requireFields(body, ["name", "password"]);
    const karigarName = normalizeText(body.name);
    const username = karigarName;
    const now = nowISO();
    const { [SHEETS.KARIGAR]: karigars, [SHEETS.USERS]: users } = await getManyRecords([
      SHEETS.KARIGAR,
      SHEETS.USERS
    ]);

    assertUniqueField(karigars, "name", karigarName);
    assertUniqueUsername(users, username);

    const karigarId = id("karigar");
    const role = normalizeRoleList(body.role || body.roles || body.skills).join(",");
    const record = {
      karigar_id: karigarId,
      name: karigarName,
      contact: normalizeText(body.contact || ""),
      role,
      skills: normalizeText(body.skills || role),
      is_active: "TRUE",
      created_date: now,
      updated_date: now
    };
    const userRecord = {
      username,
      password: await bcrypt.hash(String(body.password), 10),
      role: ROLES.KARIGAR,
      display_name: karigarName,
      entity_id: karigarId
    };

    console.log("[ACCOUNT] Creating linked karigar account", {
      karigar_id: karigarId,
      username
    });
    await appendRecordsBatch([
      { tabName: SHEETS.KARIGAR, records: [record] },
      { tabName: SHEETS.USERS, records: [userRecord] }
    ]);
    return sendOk(res, {
      message: "Karigar created with login account",
      record,
      user: stripPrivateUser(userRecord)
    });
  }

  if (req.method === "DELETE") {
    requireFields(body, ["karigar_id"]);
    const {
      [SHEETS.KARIGAR]: karigars,
      [SHEETS.USERS]: users,
      [SHEETS.PIECES]: pieces,
      [SHEETS.PAYMENTS_KARIGAR]: paymentsKarigar
    } = await getManyRecords([
      SHEETS.KARIGAR,
      SHEETS.USERS,
      SHEETS.PIECES,
      SHEETS.PAYMENTS_KARIGAR
    ]);

    const existingKarigar = karigars.find((entry) => entry.karigar_id === body.karigar_id);
    if (!existingKarigar) {
      const error = new Error("Karigar not found");
      error.statusCode = 404;
      throw error;
    }

    if (
      pieces.some((entry) => entry.assigned_karigar_id === body.karigar_id) ||
      paymentsKarigar.some((entry) => entry.karigar_id === body.karigar_id)
    ) {
      const error = new Error("Cannot delete karigar with linked work or payments");
      error.statusCode = 400;
      throw error;
    }

    const linkedUser = findLinkedEntityUser(
      users,
      ROLES.KARIGAR,
      body.karigar_id,
      existingKarigar.name
    );

    if (linkedUser) {
      console.log("[ACCOUNT] Deleting linked karigar account", {
        karigar_id: body.karigar_id,
        username: linkedUser.username
      });
      await deleteByField(SHEETS.USERS, "username", linkedUser.username);
    }

    await deleteByField(SHEETS.KARIGAR, "karigar_id", body.karigar_id);
    return sendOk(res, { message: "Karigar deleted" });
  }

  requireFields(body, ["karigar_id"]);
  const { [SHEETS.KARIGAR]: karigars, [SHEETS.USERS]: users } = await getManyRecords([
    SHEETS.KARIGAR,
    SHEETS.USERS
  ]);
  const existingKarigar = karigars.find((entry) => entry.karigar_id === body.karigar_id);
  if (!existingKarigar) {
    const error = new Error("Karigar not found");
    error.statusCode = 404;
    throw error;
  }

  const nextKarigarName = normalizeText(body.name || existingKarigar.name);
  const nextContact =
    body.contact === undefined ? existingKarigar.contact || "" : normalizeText(body.contact);
  const nextRole =
    body.role === undefined
      ? existingKarigar.role || existingKarigar.skills || ""
      : normalizeRoleList(body.role).join(",");
  const nextSkills =
    body.skills === undefined ? existingKarigar.skills || nextRole : normalizeText(body.skills);

  assertUniqueField(karigars, "name", nextKarigarName, "karigar_id", body.karigar_id);

  const updated = await updateByField(SHEETS.KARIGAR, "karigar_id", body.karigar_id, {
    name: nextKarigarName,
    contact: nextContact,
    role: nextRole,
    skills: nextSkills,
    updated_date: nowISO()
  });

  const linkedUser = findLinkedEntityUser(
    users,
    ROLES.KARIGAR,
    body.karigar_id,
    existingKarigar.name
  );
  const nextUsername = nextKarigarName;

  if (linkedUser) {
    assertUniqueUsername(users, nextUsername, linkedUser.username);
    const userPatch = {
      username: nextUsername,
      role: ROLES.KARIGAR,
      display_name: nextKarigarName,
      entity_id: body.karigar_id
    };
    if (body.password) {
      userPatch.password = await bcrypt.hash(String(body.password), 10);
    }
    console.log("[ACCOUNT] Updating linked karigar account", {
      karigar_id: body.karigar_id,
      username: nextUsername
    });
    await updateByField(SHEETS.USERS, "username", linkedUser.username, userPatch);
  } else if (body.password) {
    assertUniqueUsername(users, nextUsername);
    const userRecord = {
      username: nextUsername,
      password: await bcrypt.hash(String(body.password), 10),
      role: ROLES.KARIGAR,
      display_name: nextKarigarName,
      entity_id: body.karigar_id
    };
    console.log("[ACCOUNT] Recreating missing karigar account", {
      karigar_id: body.karigar_id,
      username: nextUsername
    });
    await appendRecord(SHEETS.USERS, userRecord);
  }

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
    requireFields(body, ["username"]);
    const users = await getRecords(SHEETS.USERS);
    const targetUser = users.find(
      (entry) => normalizeKey(entry.username) === normalizeKey(body.username)
    );
    if (!targetUser) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }
    if (normalizeKey(targetUser.role) === normalizeKey(ROLES.ADMIN)) {
      const error = new Error("Admin user cannot be deleted");
      error.statusCode = 400;
      throw error;
    }
    await deleteByField(SHEETS.USERS, "username", body.username);
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

async function handleClearAllData(req, res) {
  ensureMethod(req, ["POST"]);
  const user = requireAuth(req);
  requireRole(user, [ROLES.ADMIN]);
  await ensureWorkbook();
  await clearAllDataTabs();
  sendOk(res, { message: "All sheet data cleared" });
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
  deleteShop: withErrorHandler(async (req, res) => { req.method = 'DELETE'; return handleShops(req, res); }),
  listKarigar: withErrorHandler(async (req, res) => { req.method = 'GET'; return handleKarigar(req, res); }),
  createKarigar: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleKarigar(req, res); }),
  updateKarigar: withErrorHandler(async (req, res) => { req.method = 'PATCH'; return handleKarigar(req, res); }),
  deleteKarigar: withErrorHandler(async (req, res) => { req.method = 'DELETE'; return handleKarigar(req, res); }),
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
  saveSettings: withErrorHandler(async (req, res) => { req.method = 'POST'; return handleSettings(req, res); }),
  clearAllData: withErrorHandler(handleClearAllData)
};

module.exports = async function (req, res) {
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
