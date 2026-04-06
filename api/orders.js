const {
  BUNDLE_PIECE_TYPES,
  ITEM_TYPES,
  PIECE_EXPANSION,
  ROLES,
  SHEETS,
  STATUS
} = require("./_lib/constants");
const {
  buildRateMap,
  filterSnapshotByRole,
  loadFullSnapshot,
  refreshOrderStatuses,
  resolveShopItemRate,
  withComputedFields
} = require("./_lib/domain");
const { requireAuth, requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { resolvePhotoInput } = require("./_lib/media");
const { verifyPhotoAgainstOrderNumber } = require("./_lib/vision");
const {
  appendRecord,
  appendRecords,
  ensureWorkbook,
  getRecords,
  updateByField
} = require("./_lib/sheets");
const {
  boolToCell,
  id,
  normalizeKey,
  normalizeText,
  nowISO,
  parseBody,
  parseBoolean,
  requireFields,
  toNumber,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

function validateOrderStatus(status) {
  const normalized = normalizeKey(status);
  const allowed = new Set(Object.values(STATUS.ORDER));
  if (!allowed.has(normalized)) {
    const error = new Error(`Invalid order status: ${status}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) {
    const error = new Error("At least one item is required");
    error.statusCode = 400;
    throw error;
  }

  return items.map((item, index) => {
    const pieceType = normalizeKey(item.piece_type);
    const itemType = normalizeKey(item.item_type || "normal");

    if (!PIECE_EXPANSION[pieceType]) {
      const error = new Error(`Invalid piece_type at item ${index + 1}`);
      error.statusCode = 400;
      throw error;
    }

    if (!ITEM_TYPES.includes(itemType)) {
      const error = new Error(`Invalid item_type at item ${index + 1}`);
      error.statusCode = 400;
      throw error;
    }

    return {
      piece_type: pieceType,
      item_type: itemType,
      measurement_photo_url: normalizeText(item.measurement_photo_url),
      item_rate: item.item_rate
    };
  });
}

async function listOrders(res, user) {
  await ensureWorkbook();
  await refreshOrderStatuses();

  const snapshot = withComputedFields(await loadFullSnapshot());
  const filtered = filterSnapshotByRole(user, snapshot);

  sendOk(res, {
    orders: filtered.orders.map(stripMeta),
    orderItems: filtered.orderItems.map(stripMeta),
    pieces: filtered.pieces.map(stripMeta),
    computed: filtered.computed,
    last_synced: new Date().toISOString()
  });
}

async function createOrder(req, res, user) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["order_number", "shop_id", "delivery_date"]);

  const orderNumber = normalizeText(body.order_number);
  const shopId = normalizeText(body.shop_id);

  if (!normalizeText(body.slip_photo_url) && !normalizeText(body.slip_photo_data_url)) {
    const error = new Error("Measurement slip photo is required");
    error.statusCode = 400;
    throw error;
  }

  const existingOrders = await getRecords(SHEETS.ORDERS);
  const duplicateOrder = existingOrders.find(
    (order) => normalizeKey(order.order_number) === normalizeKey(orderNumber)
  );
  if (duplicateOrder) {
    const error = new Error("Order number must be unique");
    error.statusCode = 400;
    throw error;
  }

  const shops = await getRecords(SHEETS.SHOPS);
  const shopExists = shops.some((shop) => shop.shop_id === shopId);
  if (!shopExists) {
    const error = new Error("Selected shop does not exist");
    error.statusCode = 400;
    throw error;
  }

  const items = validateItems(body.items);
  const designingEnabled = parseBoolean(body.designing_enabled);
  const designingShopCharge = designingEnabled
    ? toNumber(body.designing_shop_charge)
    : 0;

  const { photoUrl: slipPhotoUrl, photoBase64: slipPhotoBase64 } = await resolvePhotoInput({
    photoUrl: body.slip_photo_url,
    photoDataUrl: body.slip_photo_data_url,
    folder: "bin-hassan/slips"
  });

  await verifyPhotoAgainstOrderNumber({
    orderNumber,
    photoUrl: slipPhotoUrl,
    photoBase64: slipPhotoBase64,
    mismatchMessage: "Wrong order slip shown",
    noTextMessage:
      "Slip not visible or unreadable. Please upload a clearer measurement slip photo."
  });

  const shopRates = await getRecords(SHEETS.SHOP_RATES);
  const shopRateMap = buildRateMap(shopRates, "shop_id");

  const now = nowISO();
  const orderId = id("order");

  const orderRecord = {
    order_id: orderId,
    order_number: orderNumber,
    shop_id: shopId,
    delivery_date: normalizeText(body.delivery_date),
    designing_enabled: boolToCell(designingEnabled),
    designing_shop_charge: String(designingShopCharge),
    slip_photo_url: slipPhotoUrl,
    status: STATUS.ORDER.PENDING,
    created_date: now,
    updated_date: now
  };

  const itemRecords = [];
  const pieceRecords = [];

  items.forEach((item) => {
    const itemId = id("item");
    const expandedPieces = PIECE_EXPANSION[item.piece_type];

    const autoRate = resolveShopItemRate(
      shopRateMap,
      shopId,
      item.piece_type,
      item.item_type
    );

    const itemRate =
      item.item_rate === undefined || item.item_rate === null || item.item_rate === ""
        ? autoRate
        : toNumber(item.item_rate);

    itemRecords.push({
      item_id: itemId,
      order_id: orderId,
      item_type: item.item_type,
      piece_type: item.piece_type,
      status: STATUS.ORDER.PENDING,
      item_rate: String(itemRate),
      measurement_photo_url: item.measurement_photo_url
    });

    expandedPieces.forEach((pieceName) => {
      const pieceRate = BUNDLE_PIECE_TYPES.includes(item.piece_type)
        ? resolveShopItemRate(shopRateMap, shopId, pieceName, item.item_type)
        : itemRate;

      pieceRecords.push({
        piece_id: id("piece"),
        item_id: itemId,
        order_id: orderId,
        piece_name: pieceName,
        item_type: item.item_type,
        cutting_done: boolToCell(false),
        cutting_by: "",
        cutting_date: "",
        assigned_karigar_id: "",
        assigned_date: "",
        karigar_status: STATUS.KARIGAR.NOT_ASSIGNED,
        karigar_complete_date: "",
        measurement_photo_url: item.measurement_photo_url,
        reference_slip_url: slipPhotoUrl,
        cutting_photo_url: "",
        cutting_verified: boolToCell(false),
        cutting_verified_date: "",
        completion_photo_url: "",
        completion_verified: boolToCell(false),
        completion_verified_date: "",
        designing_karigar_charge: "0",
        shop_rate: String(pieceRate),
        karigar_rate: "0",
        bundle_piece_type: BUNDLE_PIECE_TYPES.includes(item.piece_type)
          ? item.piece_type
          : "",
        created_date: now,
        updated_date: now
      });
    });
  });

  await appendRecord(SHEETS.ORDERS, orderRecord);
  await appendRecords(SHEETS.ORDER_ITEMS, itemRecords);
  await appendRecords(SHEETS.PIECES, pieceRecords);

  await refreshOrderStatuses([orderId]);

  sendOk(res, {
    message: "Order created successfully",
    order: orderRecord,
    items: itemRecords,
    pieces: pieceRecords,
    created_by: user.username
  });
}

async function updateOrder(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["order_id"]);

  const patch = {};

  if (body.delivery_date !== undefined) {
    patch.delivery_date = normalizeText(body.delivery_date);
  }

  if (body.designing_enabled !== undefined) {
    patch.designing_enabled = boolToCell(parseBoolean(body.designing_enabled));
  }

  if (body.designing_shop_charge !== undefined) {
    patch.designing_shop_charge = String(toNumber(body.designing_shop_charge));
  }

  if (body.status !== undefined) {
    const nextStatus = validateOrderStatus(body.status);
    patch.status = nextStatus;
  }

  if (body.slip_photo_url !== undefined) {
    patch.slip_photo_url = normalizeText(body.slip_photo_url);
  }

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  patch.updated_date = nowISO();

  const updated = await updateByField(SHEETS.ORDERS, "order_id", body.order_id, patch);

  if (!patch.status || patch.status !== STATUS.ORDER.DELIVERED) {
    await refreshOrderStatuses([body.order_id]);
  }

  sendOk(res, {
    message: "Order updated",
    order: stripMeta(updated)
  });
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listOrders(res, user);
  }

  if (req.method === "POST") {
    return createOrder(req, res, user);
  }

  return updateOrder(req, res);
});
