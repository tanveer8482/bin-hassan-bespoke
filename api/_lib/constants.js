const SHEETS = {
  USERS: "Users",
  SHOPS: "Shops",
  KARIGAR: "Karigar",
  ORDERS: "Orders",
  ORDER_ITEMS: "OrderItems",
  PIECES: "Pieces",
  PAYMENTS_SHOPS: "Payments_Shops",
  PAYMENTS_KARIGAR: "Payments_Karigar",
  SETTINGS: "Settings",
  SHOP_RATES: "ShopRates",
  KARIGAR_RATES: "KarigarRates"
};

const STATUS = {
  ORDER: {
    PENDING: "pending",
    CUTTING: "cutting",
    IN_PROGRESS: "in_progress",
    READY: "ready",
    DELIVERED: "delivered"
  },
  KARIGAR: {
    NOT_ASSIGNED: "not_assigned",
    ASSIGNED: "assigned",
    COMPLETE: "complete"
  }
};

const ROLES = {
  ADMIN: "admin",
  KARIGAR: "karigar",
  SHOP: "shop",
  CUTTING: "cutting"
};

const PIECE_EXPANSION = {
  coat: ["coat"],
  pent: ["pent"],
  waistcoat: ["waistcoat"],
  suit_2piece: ["coat", "pent"],
  suit_3piece: ["coat", "pent", "inner_waistcoat"]
};

const BUNDLE_PIECE_TYPES = ["suit_2piece", "suit_3piece"];

const REQUIRED_HEADERS = {
  [SHEETS.USERS]: ["username", "password", "role", "display_name", "entity_id"],
  [SHEETS.SHOPS]: ["shop_id", "shop_name", "contact", "created_date"],
  [SHEETS.KARIGAR]: ["karigar_id", "name", "contact", "created_date"],
  [SHEETS.ORDERS]: [
    "order_id",
    "order_number",
    "shop_id",
    "delivery_date",
    "designing_enabled",
    "designing_shop_charge",
    "slip_photo_url",
    "status",
    "created_date",
    "updated_date"
  ],
  [SHEETS.ORDER_ITEMS]: [
    "item_id",
    "order_id",
    "item_type",
    "piece_type",
    "status",
    "item_rate",
    "measurement_photo_url"
  ],
  [SHEETS.PIECES]: [
    "piece_id",
    "item_id",
    "order_id",
    "piece_name",
    "item_type",
    "cutting_done",
    "cutting_by",
    "cutting_date",
    "assigned_karigar_id",
    "assigned_date",
    "karigar_status",
    "karigar_complete_date",
    "measurement_photo_url",
    "reference_slip_url",
    "cutting_photo_url",
    "cutting_verified",
    "cutting_verified_date",
    "completion_photo_url",
    "completion_verified",
    "completion_verified_date",
    "designing_karigar_charge",
    "shop_rate",
    "karigar_rate",
    "bundle_piece_type",
    "created_date",
    "updated_date"
  ],
  [SHEETS.PAYMENTS_SHOPS]: ["payment_id", "shop_id", "amount", "payment_date", "note", "recorded_by"],
  [SHEETS.PAYMENTS_KARIGAR]: ["payment_id", "karigar_id", "amount", "payment_date", "note", "recorded_by"],
  [SHEETS.SETTINGS]: ["key", "value", "description"],
  [SHEETS.SHOP_RATES]: ["shop_id", "piece_name", "item_type", "rate"],
  [SHEETS.KARIGAR_RATES]: ["karigar_id", "piece_name", "item_type", "rate"]
};

const ITEM_TYPES = ["normal", "vip", "chapma"];

module.exports = {
  BUNDLE_PIECE_TYPES,
  ITEM_TYPES,
  PIECE_EXPANSION,
  REQUIRED_HEADERS,
  ROLES,
  SHEETS,
  STATUS
};
