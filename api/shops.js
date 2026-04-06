const { ROLES, SHEETS } = require("./_lib/constants");
const {
  computeShopFinancials,
  loadFullSnapshot
} = require("./_lib/domain");
const { requireAuth, requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  appendRecord,
  ensureWorkbook,
  getRecords,
  updateByField
} = require("./_lib/sheets");
const {
  id,
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

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

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listShops(res, user);
  }

  if (req.method === "POST") {
    return createShop(req, res);
  }

  return updateShop(req, res);
<<<<<<< HEAD
});
=======
});
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
