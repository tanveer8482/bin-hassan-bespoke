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
  PRODUCTS: "Products",
  PRODUCT_SUB_PRODUCTS: "ProductSubProducts",
  SHOP_INVOICES: "ShopInvoices",
  SHOP_INVOICE_LINES: "ShopInvoiceLines",
  PAYROLL_SYNC_RUNS: "PayrollSyncRuns"
};

const STATUS = {
  ORDER: {
    PENDING: "pending",
    CUTTING: "cutting",
    SPLIT_PENDING: "split_pending",
    IN_PROGRESS: "in_progress",
    APPROVAL_PENDING: "approval_pending",
    READY: "ready",
    BILLED: "billed",
    ARCHIVED: "archived",
    DELIVERED: "delivered"
  },
  KARIGAR: {
    NOT_ASSIGNED: "not_assigned",
    ASSIGNED: "assigned",
    PENDING_APPROVAL: "pending_approval",
    APPROVED: "approved",
    REJECTED: "rejected",
    COMPLETE: "complete" // legacy compatibility
  },
  PAYROLL: {
    NOT_READY: "not_ready",
    PENDING_SYNC: "pending_sync",
    SYNCED: "synced"
  },
  INVOICE: {
    GENERATED: "generated",
    FINALIZED: "finalized",
    VOID: "void"
  },
  SYNC_RUN: {
    STARTED: "started",
    COMPLETED: "completed",
    FAILED: "failed"
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
  [SHEETS.KARIGAR]: ["karigar_id", "name", "contact", "skills", "is_active", "created_date", "updated_date"],
  [SHEETS.ORDERS]: [
    "order_id",
    "order_number",
    "shop_id",
    "delivery_date",
    "priority_rank",
    "designing_enabled",
    "designing_shop_charge",
    "slip_photo_url",
    "status",
    "is_split",
    "split_date",
    "is_billed",
    "invoice_id",
    "is_archived",
    "billed_date",
    "created_date",
    "updated_date"
  ],
  [SHEETS.ORDER_ITEMS]: [
    "item_id",
    "order_id",
    "product_id",
    "item_type",
    "piece_type",
    "status",
    "item_rate",
    "measurement_photo_url",
    "created_date",
    "updated_date"
  ],
  [SHEETS.PIECES]: [
    "piece_id",
    "item_id",
    "order_id",
    "product_id",
    "sub_product_id",
    "piece_name",
    "sub_product_name",
    "item_type",
    "cutting_done",
    "cutting_by",
    "cutting_date",
    "cutting_credit_amount",
    "cutting_credit_synced",
    "assigned_karigar_id",
    "assigned_role",
    "assigned_date",
    "karigar_status",
    "karigar_complete_date",
    "approval_requested_by",
    "approval_requested_date",
    "approved_by",
    "approved_date",
    "approval_note",
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
    "payroll_state",
    "is_synced",
    "sync_id",
    "synced_date",
    "is_billed",
    "billed_invoice_id",
    "bundle_piece_type",
    "created_date",
    "updated_date"
  ],
  [SHEETS.PAYMENTS_SHOPS]: ["payment_id", "shop_id", "amount", "payment_date", "note", "recorded_by"],
  [SHEETS.PAYMENTS_KARIGAR]: ["payment_id", "karigar_id", "amount", "payment_date", "note", "recorded_by"],
  [SHEETS.SETTINGS]: ["key", "value", "description"],
  [SHEETS.PRODUCTS]: ["product_id", "product_name", "shop_name", "shop_rate", "cutting_rate", "is_active", "created_date", "updated_date"],
  [SHEETS.PRODUCT_SUB_PRODUCTS]: ["sub_id", "product_id", "sub_product_name", "worker_rate", "required_skill", "sequence_no", "is_active"],
  [SHEETS.SHOP_INVOICES]: [
    "invoice_id",
    "shop_id",
    "invoice_number",
    "period_from",
    "period_to",
    "order_ids",
    "piece_count",
    "total_amount",
    "pdf_url",
    "generated_by",
    "generated_date",
    "status"
  ],
  [SHEETS.SHOP_INVOICE_LINES]: ["line_id", "invoice_id", "order_id", "piece_id", "product_name", "sub_product_name", "qty", "unit_rate", "line_total"],
  [SHEETS.PAYROLL_SYNC_RUNS]: ["sync_id", "triggered_by", "triggered_date", "piece_count", "total_amount", "status", "note"]
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
