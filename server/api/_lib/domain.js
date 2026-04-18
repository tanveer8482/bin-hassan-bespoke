const {
  BUNDLE_PIECE_TYPES,
  PIECE_EXPANSION,
  ROLES,
  SHEETS,
  STATUS
} = require("./constants");
const { getManyRecords, getRecords, updateMany } = require("./sheets");
const { normalizeKey, nowISO, parseBoolean, toNumber } = require("./utils");

function rateKey(entityId, pieceName, itemType) {
  return [normalizeKey(entityId), normalizeKey(pieceName), normalizeKey(itemType)].join("|");
}

function buildRateMap(records, entityField) {
  const map = new Map();
  records.forEach((record) => {
    map.set(
      rateKey(record[entityField], record.piece_name, record.item_type || "normal"),
      toNumber(record.rate)
    );
  });
  return map;
}

function pickRate(map, entityId, pieceName, itemType) {
  const exactKey = rateKey(entityId, pieceName, itemType);
  if (map.has(exactKey)) return map.get(exactKey);

  const normalItemTypeKey = rateKey(entityId, pieceName, "normal");
  if (map.has(normalItemTypeKey)) return map.get(normalItemTypeKey);

  if (pieceName === "inner_waistcoat") {
    const waistcoatExact = rateKey(entityId, "waistcoat", itemType);
    if (map.has(waistcoatExact)) return map.get(waistcoatExact);

    const waistcoatNormal = rateKey(entityId, "waistcoat", "normal");
    if (map.has(waistcoatNormal)) return map.get(waistcoatNormal);
  }

  return 0;
}

function resolveShopItemRate(shopRateMap, shopId, pieceType, itemType) {
  const normalizedPieceType = normalizeKey(pieceType);

  if (BUNDLE_PIECE_TYPES.includes(normalizedPieceType)) {
    const bundleRate = pickRate(shopRateMap, shopId, normalizedPieceType, itemType);
    if (bundleRate > 0) return bundleRate;

    const expanded = PIECE_EXPANSION[normalizedPieceType] || [];
    return expanded.reduce(
      (sum, pieceName) => sum + pickRate(shopRateMap, shopId, pieceName, itemType),
      0
    );
  }

  return pickRate(shopRateMap, shopId, normalizedPieceType, itemType);
}

function resolveKarigarPieceRate(karigarRateMap, karigarId, pieceName, itemType) {
  return pickRate(karigarRateMap, karigarId, pieceName, itemType);
}

function computeOrderStatus(order, pieces) {
  if (normalizeKey(order.status) === STATUS.ORDER.DELIVERED) {
    return STATUS.ORDER.DELIVERED;
  }

  if (!pieces.length) {
    return STATUS.ORDER.PENDING;
  }

  const statuses = pieces.map((piece) => normalizeKey(piece.karigar_status));

  if (
    statuses.every(
      (status) =>
        status === STATUS.KARIGAR.APPROVED || status === STATUS.KARIGAR.COMPLETE
    )
  ) {
    return STATUS.ORDER.READY;
  }

  if (
    statuses.some(
      (status) =>
        status === STATUS.KARIGAR.ASSIGNED ||
        status === STATUS.KARIGAR.PENDING_APPROVAL ||
        status === STATUS.KARIGAR.APPROVED ||
        status === STATUS.KARIGAR.COMPLETE
    )
  ) {
    return STATUS.ORDER.IN_PROGRESS;
  }

  if (pieces.some((piece) => parseBoolean(piece.cutting_done))) {
    return STATUS.ORDER.CUTTING;
  }

  return STATUS.ORDER.PENDING;
}

function groupBy(records, key) {
  return records.reduce((map, record) => {
    const groupKey = record[key] || "";
    if (!map.has(groupKey)) map.set(groupKey, []);
    map.get(groupKey).push(record);
    return map;
  }, new Map());
}

function buildDashboard(orders, pieces) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return {
    total_active_orders: orders.filter(
      (order) =>
        normalizeKey(order.status) !== STATUS.ORDER.DELIVERED &&
        normalizeKey(order.status) !== STATUS.ORDER.READY
    ).length,
    orders_ready_for_delivery: orders.filter(
      (order) => normalizeKey(order.status) === STATUS.ORDER.READY
    ).length,
    pieces_pending_cutting: pieces.filter(
      (piece) => !parseBoolean(piece.cutting_done)
    ).length,
    pieces_assigned_pending_completion: pieces.filter(
      (piece) => normalizeKey(piece.karigar_status) === STATUS.KARIGAR.ASSIGNED
    ).length,
    overdue_orders: orders.filter((order) => {
      if (!order.delivery_date) return false;
      if (normalizeKey(order.status) === STATUS.ORDER.DELIVERED) return false;
      const delivery = new Date(order.delivery_date);
      return !Number.isNaN(delivery.getTime()) && delivery < dayStart;
    }).length
  };
}

async function refreshOrderStatuses(targetOrderIds = [], snapshot = null) {
  let orders = snapshot?.orders;
  let pieces = snapshot?.pieces;

  if (!orders || !pieces) {
    const records = await getManyRecords([SHEETS.ORDERS, SHEETS.PIECES]);
    orders = records[SHEETS.ORDERS] || [];
    pieces = records[SHEETS.PIECES] || [];
  }

  const targetSet = new Set(targetOrderIds);
  const now = nowISO();

  const updates = [];

  orders.forEach((order) => {
    if (targetSet.size && !targetSet.has(order.order_id)) return;

    const orderPieces = pieces.filter((piece) => piece.order_id === order.order_id);
    const nextStatus = computeOrderStatus(order, orderPieces);

    if (normalizeKey(order.status) !== nextStatus) {
      updates.push({
        rowNumber: order.__rowNumber,
        record: {
          ...order,
          status: nextStatus,
          updated_date: now
        }
      });
    }
  });

  if (updates.length) {
    await updateMany(SHEETS.ORDERS, updates);
    const updatedById = new Map(
      updates.map((update) => [
        update.record.order_id,
        {
          ...update.record,
          __rowNumber: update.rowNumber
        }
      ])
    );
    orders = orders.map((order) => updatedById.get(order.order_id) || order);
    if (snapshot?.orders) {
      snapshot.orders = orders;
    }
  }

  return updates.length;
}

function computeOrderTotals(orders, orderItems) {
  const itemsByOrder = groupBy(orderItems, "order_id");

  return orders.reduce((map, order) => {
    const itemTotal = (itemsByOrder.get(order.order_id) || []).reduce(
      (sum, item) => sum + toNumber(item.item_rate),
      0
    );

    const designingCharge = parseBoolean(order.designing_enabled)
      ? toNumber(order.designing_shop_charge)
      : 0;

    map[order.order_id] = {
      item_total: itemTotal,
      designing_charge: designingCharge,
      grand_total: itemTotal + designingCharge
    };

    return map;
  }, {});
}

function computeShopFinancials(orders, orderItems, paymentsShops) {
  const orderTotals = computeOrderTotals(orders, orderItems);

  const billedByShop = orders.reduce((map, order) => {
    if (!map[order.shop_id]) map[order.shop_id] = 0;
    map[order.shop_id] += orderTotals[order.order_id]?.grand_total || 0;
    return map;
  }, {});

  const paidByShop = paymentsShops.reduce((map, payment) => {
    if (!map[payment.shop_id]) map[payment.shop_id] = 0;
    map[payment.shop_id] += toNumber(payment.amount);
    return map;
  }, {});

  const allShopIds = new Set([...Object.keys(billedByShop), ...Object.keys(paidByShop)]);

  const summary = {};
  allShopIds.forEach((shopId) => {
    const billed = billedByShop[shopId] || 0;
    const paid = paidByShop[shopId] || 0;
    summary[shopId] = {
      billed,
      paid,
      balance: billed - paid
    };
  });

  return summary;
}

function computeKarigarFinancials(pieces, paymentsKarigar) {
  const earnedByKarigar = pieces.reduce((map, piece) => {
    const karigarId = piece.assigned_karigar_id;
    if (!karigarId) return map;
    
    // Count as earned only when approved/complete and synced.
    if (
      normalizeKey(piece.karigar_status) !== STATUS.KARIGAR.APPROVED &&
      normalizeKey(piece.karigar_status) !== STATUS.KARIGAR.COMPLETE
    ) {
      return map;
    }
    if (!parseBoolean(piece.is_synced)) return map;

    if (!map[karigarId]) map[karigarId] = 0;
    map[karigarId] +=
      toNumber(piece.karigar_rate) + toNumber(piece.designing_karigar_charge);
    return map;
  }, {});

  const pendingByKarigar = pieces.reduce((map, piece) => {
    const karigarId = piece.assigned_karigar_id;
    if (!karigarId) return map;
    
    // Count as pending if approved/complete but not synced yet.
    if (
      normalizeKey(piece.karigar_status) !== STATUS.KARIGAR.APPROVED &&
      normalizeKey(piece.karigar_status) !== STATUS.KARIGAR.COMPLETE
    ) {
      return map;
    }
    if (parseBoolean(piece.is_synced)) return map;

    if (!map[karigarId]) map[karigarId] = 0;
    map[karigarId] +=
      toNumber(piece.karigar_rate) + toNumber(piece.designing_karigar_charge);
    return map;
  }, {});

  const paidByKarigar = paymentsKarigar.reduce((map, payment) => {
    if (!map[payment.karigar_id]) map[payment.karigar_id] = 0;
    map[payment.karigar_id] += toNumber(payment.amount);
    return map;
  }, {});

  const allKarigarIds = new Set([
    ...Object.keys(earnedByKarigar),
    ...Object.keys(pendingByKarigar),
    ...Object.keys(paidByKarigar)
  ]);

  const summary = {};
  allKarigarIds.forEach((karigarId) => {
    const earned = earnedByKarigar[karigarId] || 0;
    const pending = pendingByKarigar[karigarId] || 0;
    const paid = paidByKarigar[karigarId] || 0;
    summary[karigarId] = {
      earned,
      pending,
      paid,
      balance: earned - paid
    };
  });

  return summary;
}

function onlyKeys(obj, keySet) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([key]) => keySet.has(key))
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function filterComputedForRole(computed, orders, pieces, allowedShopIds, allowedKarigarIds) {
  const orderIds = new Set(orders.map((order) => order.order_id));

  return {
    orderTotals: onlyKeys(computed.orderTotals, orderIds),
    shopFinancials: onlyKeys(computed.shopFinancials, allowedShopIds),
    karigarFinancials: onlyKeys(computed.karigarFinancials, allowedKarigarIds),
    dashboard: buildDashboard(orders, pieces)
  };
}

function filterSnapshotByRole(user, snapshot) {
  const users = asArray(snapshot.users);
  const shops = asArray(snapshot.shops);
  const karigars = asArray(snapshot.karigars);
  const ordersAll = asArray(snapshot.orders);
  const orderItemsAll = asArray(snapshot.orderItems);
  const piecesAll = asArray(snapshot.pieces);
  const paymentsShopsAll = asArray(snapshot.paymentsShops);
  const paymentsKarigarAll = asArray(snapshot.paymentsKarigar);
  const settings = asArray(snapshot.settings);
  const products = asArray(snapshot.products);
  const productSubProducts = asArray(snapshot.productSubProducts);
  const shopInvoicesAll = asArray(snapshot.shopInvoices);
  const shopInvoiceLinesAll = asArray(snapshot.shopInvoiceLines);
  const payrollSyncRuns = asArray(snapshot.payrollSyncRuns);

  if (user.role === ROLES.ADMIN) {
    return {
      ...snapshot,
      users,
      shops,
      karigars,
      orders: ordersAll,
      orderItems: orderItemsAll,
      pieces: piecesAll,
      paymentsShops: paymentsShopsAll,
      paymentsKarigar: paymentsKarigarAll,
      settings,
      products,
      productSubProducts,
      shopInvoices: shopInvoicesAll,
      shopInvoiceLines: shopInvoiceLinesAll,
      payrollSyncRuns
    };
  }

  if (user.role === ROLES.SHOP) {
    const shopId = user.entity_id;

    const orders = ordersAll.filter(
      (order) => order.shop_id === shopId && !parseBoolean(order.is_archived)
    );
    const archivedOrders = ordersAll.filter(
      (order) => order.shop_id === shopId && parseBoolean(order.is_archived)
    );
    const allOrderIds = new Set(
      ordersAll.filter((order) => order.shop_id === shopId).map((order) => order.order_id)
    );

    const orderItems = orderItemsAll.filter((item) => allOrderIds.has(item.order_id));
    const itemIds = new Set(orderItems.map((item) => item.item_id));

    const pieces = piecesAll.filter(
      (piece) => allOrderIds.has(piece.order_id) || itemIds.has(piece.item_id)
    );

    const karigarIds = new Set(
      pieces
        .map((piece) => piece.assigned_karigar_id)
        .filter(Boolean)
    );
    const shopInvoices = shopInvoicesAll.filter(
      (invoice) => invoice.shop_id === shopId
    );
    const invoiceIds = new Set(shopInvoices.map((invoice) => invoice.invoice_id));

    return {
      ...snapshot,
      users: [],
      shops: shops.filter((shop) => shop.shop_id === shopId),
      karigars: karigars.filter((karigar) =>
        karigarIds.has(karigar.karigar_id)
      ),
      orders,
      archivedOrders,
      orderItems,
      pieces,
      shopInvoices,
      shopInvoiceLines: shopInvoiceLinesAll.filter((line) =>
        invoiceIds.has(line.invoice_id)
      ),
      payrollSyncRuns: [],
      paymentsShops: paymentsShopsAll.filter(
        (payment) => payment.shop_id === shopId
      ),
      paymentsKarigar: [],
      products: products.filter(
        (product) => product.shop_name === shops.find((shop) => shop.shop_id === shopId)?.shop_name
      ),
      productSubProducts,
      settings: [],
      computed: filterComputedForRole(
        snapshot.computed,
        orders,
        pieces,
        new Set([shopId]),
        karigarIds
      )
    };
  }

  if (user.role === ROLES.KARIGAR) {
    const karigarId = user.entity_id;

    const pieces = piecesAll.filter(
      (piece) => piece.assigned_karigar_id === karigarId
    );

    const orderIds = new Set(pieces.map((piece) => piece.order_id));
    const itemIds = new Set(pieces.map((piece) => piece.item_id));

    const orders = ordersAll.filter((order) => orderIds.has(order.order_id));
    const orderItems = orderItemsAll.filter(
      (item) => itemIds.has(item.item_id) || orderIds.has(item.order_id)
    );

    const shopIds = new Set(orders.map((order) => order.shop_id));

    return {
      ...snapshot,
      users: [],
      shops: shops.filter((shop) => shopIds.has(shop.shop_id)),
      karigars: karigars.filter(
        (karigar) => karigar.karigar_id === karigarId
      ),
      orders,
      orderItems,
      pieces,
      shopInvoices: [],
      shopInvoiceLines: [],
      payrollSyncRuns: [],
      paymentsShops: [],
      paymentsKarigar: paymentsKarigarAll.filter(
        (payment) => payment.karigar_id === karigarId
      ),
      shopRates: [],
      karigarRates: [],
      products: [],
      productSubProducts: [],
      settings: [],
      computed: filterComputedForRole(
        snapshot.computed,
        orders,
        pieces,
        shopIds,
        new Set([karigarId])
      )
    };
  }

  if (user.role === ROLES.CUTTING) {
    const pieces = piecesAll.filter((piece) => !parseBoolean(piece.cutting_done));
    const orderIds = new Set(pieces.map((piece) => piece.order_id));
    const itemIds = new Set(pieces.map((piece) => piece.item_id));

    const orders = ordersAll.filter((order) => orderIds.has(order.order_id));
    const orderItems = orderItemsAll.filter(
      (item) => itemIds.has(item.item_id) || orderIds.has(item.order_id)
    );

    const shopIds = new Set(orders.map((order) => order.shop_id));

    return {
      ...snapshot,
      users: [],
      shops: shops.filter((shop) => shopIds.has(shop.shop_id)),
      karigars: [],
      orders,
      orderItems,
      pieces,
      shopInvoices: [],
      shopInvoiceLines: [],
      payrollSyncRuns: [],
      paymentsShops: [],
      paymentsKarigar: [],
      settings: [],
      shopRates: [],
      karigarRates: [],
      products: [],
      productSubProducts: [],
      computed: filterComputedForRole(
        snapshot.computed,
        orders,
        pieces,
        shopIds,
        new Set()
      )
    };
  }

  return {
    ...snapshot,
    users: [],
    shops: [],
    karigars: [],
    orders: [],
    orderItems: [],
    pieces: [],
    shopInvoices: [],
    shopInvoiceLines: [],
    payrollSyncRuns: [],
    paymentsShops: [],
    paymentsKarigar: [],
    settings: [],
    shopRates: [],
    karigarRates: [],
    computed: {
      orderTotals: {},
      shopFinancials: {},
      karigarFinancials: {},
      dashboard: buildDashboard([], [])
    }
  };
}

async function loadFullSnapshot() {
  const records = await getManyRecords([
    SHEETS.USERS,
    SHEETS.SHOPS,
    SHEETS.KARIGAR,
    SHEETS.ORDERS,
    SHEETS.ORDER_ITEMS,
    SHEETS.PIECES,
    SHEETS.PAYMENTS_SHOPS,
    SHEETS.PAYMENTS_KARIGAR,
    SHEETS.SETTINGS,
    SHEETS.PRODUCTS,
    SHEETS.PRODUCT_SUB_PRODUCTS,
    SHEETS.SHOP_INVOICES,
    SHEETS.SHOP_INVOICE_LINES,
    SHEETS.PAYROLL_SYNC_RUNS
  ]);

  return {
    users: records[SHEETS.USERS] || [],
    shops: records[SHEETS.SHOPS] || [],
    karigars: records[SHEETS.KARIGAR] || [],
    orders: records[SHEETS.ORDERS] || [],
    orderItems: records[SHEETS.ORDER_ITEMS] || [],
    pieces: records[SHEETS.PIECES] || [],
    paymentsShops: records[SHEETS.PAYMENTS_SHOPS] || [],
    paymentsKarigar: records[SHEETS.PAYMENTS_KARIGAR] || [],
    settings: records[SHEETS.SETTINGS] || [],
    products: records[SHEETS.PRODUCTS] || [],
    productSubProducts: records[SHEETS.PRODUCT_SUB_PRODUCTS] || [],
    shopInvoices: records[SHEETS.SHOP_INVOICES] || [],
    shopInvoiceLines: records[SHEETS.SHOP_INVOICE_LINES] || [],
    payrollSyncRuns: records[SHEETS.PAYROLL_SYNC_RUNS] || []
  };
}

function stripPrivateUsers(users) {
  return users.map((user) => ({
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    entity_id: user.entity_id || ""
  }));
}

function withComputedFields(snapshot) {
  const computed = {
    orderTotals: computeOrderTotals(snapshot.orders, snapshot.orderItems),
    shopFinancials: computeShopFinancials(
      snapshot.orders,
      snapshot.orderItems,
      snapshot.paymentsShops
    ),
    karigarFinancials: computeKarigarFinancials(
      snapshot.pieces,
      snapshot.paymentsKarigar
    ),
    dashboard: buildDashboard(snapshot.orders, snapshot.pieces)
  };

  return {
    ...snapshot,
    users: stripPrivateUsers(snapshot.users),
    computed
  };
}

module.exports = {
  buildRateMap,
  computeKarigarFinancials,
  computeOrderStatus,
  computeOrderTotals,
  computeShopFinancials,
  filterSnapshotByRole,
  loadFullSnapshot,
  refreshOrderStatuses,
  resolveKarigarPieceRate,
  resolveShopItemRate,
  withComputedFields
};


