const { URL } = require("url");
const bcrypt = require("bcryptjs");
const { ROLES, SHEETS } = require("../server/api/_lib/constants");
const {
  computeShopFinancials,
  loadFullSnapshot
} = require("../server/api/_lib/domain");
const { requireAuth, requireRole } = require("../server/api/_lib/auth");
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
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
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

// ============ ROUTER ============

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const handlers = {
  bootstrap: withErrorHandler(handleBootstrap),
  shops: withErrorHandler(handleShops)
};

module.exports = async function (req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const segments = url.pathname.replace(/^\/+/g, "").split("/").filter(Boolean);
  const route = segments[0] === "api" ? segments[1] : segments[0];

  if (!route || !handlers[route]) {
    return sendJson(res, 404, { error: "Not found" });
  }

  return handlers[route](req, res);
};
