
import { useMemo, useState, useCallback } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import {
  byId,
  filterTodayAndOverdue,
  formatCurrency,
  formatDate,
  normalizeBool,
  number,
  ORDER_STATUS_META,
  PIECE_STATUS_META
} from "../../lib/format";
import { preparePhotoPayloadForApi } from "../../lib/api";
import { generateMasterPayrollPdf } from "../../lib/pdfReport";


const PIECE_TYPES = ["coat", "pent", "waistcoat", "suit_2piece", "suit_3piece"];
const ITEM_TYPES = ["normal", "vip", "chapma"];
const KARIGAR_ROLE_OPTIONS = [
  { value: "coat_maker", label: "Coat Maker", pieces: ["coat"] },
  { value: "pent_maker", label: "Pent Maker", pieces: ["pent"] },
  { value: "waistcoat_maker", label: "Waistcoat Maker", pieces: ["waistcoat", "inner_waistcoat"] },
  { value: "cutting_master", label: "Cutting Master", pieces: [] }
];
const ASSIGN_WORK_TABS = [
  { key: "all", label: "All" },
  { key: "coat", label: "Coat" },
  { key: "pent", label: "Pent" },
  { key: "waistcoat", label: "Waistcoat" }
];

export const TAB_LIST = [
  { key: "dashboard", label: "Dashboard" },
  { key: "orders", label: "Orders" },
  { key: "shops", label: "Shops" },
  { key: "karigar", label: "Karigars" },
  { key: "settings", label: "Settings" },
  { key: "cutting", label: "Cutting" },
  { key: "assign", label: "Assign Work" },
  { key: "payments", label: "Payments" },
  { key: "track", label: "Track & Alerts" }
];

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function emptyOrderItem() {
  return {
    product_id: "",
    piece_type: "",
    item_type: "normal",
    measurement_photo_url: "",
    item_rate: ""
  };
}

function emptyOrderForm() {
  return {
    order_number: "",
    shop_id: "",
    delivery_date: "",
    designing_enabled: false,
    designing_shop_charge: "0",
    slip_photo_data_url: "",
    slip_photo_name: "",
    items: [emptyOrderItem()]
  };
}

function orderBadge(status) {
  return ORDER_STATUS_META[status] || { label: status, tone: "pending" };
}

function pieceBadge(status) {
  return PIECE_STATUS_META[status] || { label: status, tone: "pending" };
}

function normalizeRoleValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getRoleValues(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,|;]/)
        .map(normalizeRoleValue)
        .filter(Boolean)
    )
  ];
}

function formatKarigarRoles(value) {
  const labelsByValue = Object.fromEntries(
    KARIGAR_ROLE_OPTIONS.map((entry) => [entry.value, entry.label])
  );
  const roles = getRoleValues(value);
  return roles.length ? roles.map((role) => labelsByValue[role] || role).join(", ") : "-";
}

function getRequiredRoleForPiece(pieceName) {
  const normalized = normalizeRoleValue(pieceName);
  if (normalized.includes("waistcoat")) return "waistcoat_maker";
  if (normalized.includes("coat")) return "coat_maker";
  if (normalized.includes("pent") || normalized.includes("pant")) return "pent_maker";
  return "";
}

function karigarHasRequiredRole(karigar, requiredRole) {
  if (!requiredRole) return true;
  const roles = new Set([
    ...getRoleValues(karigar?.role),
    ...getRoleValues(karigar?.skills)
  ]);
  return roles.has(requiredRole);
}

function isApprovedPiece(piece) {
  const status = normalizeRoleValue(piece?.karigar_status);
  return status === "complete" || status === "approved";
}

function isPendingApprovalPiece(piece) {
  return normalizeRoleValue(piece?.karigar_status) === "pending_approval";
}

function pieceMatchesAssignTab(piece, activeTab) {
  if (activeTab === "all") return true;
  const normalized = normalizeRoleValue(piece.piece_name);
  if (activeTab === "waistcoat") return normalized.includes("waistcoat");
  return normalized.includes(activeTab);
}

function OrderListCard({
  order,
  shopName,
  total,
  orderItems,
  orderPieces,
  completeCount,
  isExpanded,
  busyAction,
  onToggle,
  onStatusChange,
  onApprovePiece,
  onDeliverOrder,
  onAssignWork
}) {
  const badge = orderBadge(order.status);
  const statusBusy =
    busyAction === "updateOrder" || busyAction === `deliver:${order.order_id}`;
  const readyForDelivery =
    order.status === "ready" ||
    (!!orderPieces.length && orderPieces.every((piece) => isApprovedPiece(piece)));

  return (
    <article className={`order-row-card ${isExpanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="order-summary-row"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="order-summary-main">
          <strong className="order-number">{order.order_number}</strong>
          <span className="order-shop">{shopName}</span>
        </span>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </button>

      {isExpanded ? (
        <div className="order-expanded-body">
          <div className="order-details-grid">
            <div className="order-detail-cell">
              <span>Delivery</span>
              <strong>{formatDate(order.delivery_date)}</strong>
            </div>
            <div className="order-detail-cell">
              <span>Bill</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            <div className="order-detail-cell">
              <span>Items</span>
              <strong>{orderItems.length}</strong>
            </div>
            <div className="order-detail-cell">
              <span>Completed</span>
              <strong>
                {completeCount}/{orderPieces.length}
              </strong>
            </div>
          </div>

          <div className="progress-track">
            <span
              style={{
                width: `${orderPieces.length ? (completeCount / orderPieces.length) * 100 : 0}%`
              }}
            />
          </div>

          <div className="order-piece-list">
            {orderPieces.length ? (
              orderPieces.map((piece) => {
                const pBadge = pieceBadge(piece.karigar_status);
                const approvalBusy = busyAction === `approve:${piece.piece_id}`;
                return (
                  <div className="inline-list-row" key={piece.piece_id}>
                    <span>
                      {piece.piece_name} - {piece.item_type}
                    </span>
                    <span className="piece-row-actions">
                      {isPendingApprovalPiece(piece) ? (
                        <button
                          type="button"
                          className="button success small"
                          onClick={() => onApprovePiece(piece.piece_id)}
                          disabled={approvalBusy}
                        >
                          {approvalBusy ? "Approving..." : "Approve"}
                        </button>
                      ) : null}
                      <StatusBadge label={pBadge.label} tone={pBadge.tone} />
                    </span>
                  </div>
                );
              })
            ) : orderItems.length ? (
              orderItems.map((item, index) => (
                <div className="inline-list-row" key={`${order.order_id}-item-${index}`}>
                  <span>{item.piece_type || item.product_id || `Item ${index + 1}`}</span>
                  <span className="muted">{item.item_type || "-"}</span>
                </div>
              ))
            ) : (
              <p className="muted">No item details available.</p>
            )}
          </div>

          <div className="order-expanded-actions">
            <label>
              Status
              <select
                className="input"
                value={order.status || "pending"}
                onChange={(event) => onStatusChange(event.target.value)}
                disabled={statusBusy}
              >
                {Object.entries(ORDER_STATUS_META).map(([status, meta]) => (
                  <option key={status} value={status}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="button ghost" onClick={onAssignWork}>
              Assign Work
            </button>

            {readyForDelivery && order.status !== "delivered" ? (
              <button
                type="button"
                className="button success"
                onClick={onDeliverOrder}
                disabled={busyAction === `deliver:${order.order_id}`}
              >
                {busyAction === `deliver:${order.order_id}`
                  ? "Delivering..."
                  : "Mark as Delivered"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function getBase64Size(dataUrl) {
  const base64 = (dataUrl || "").split(",")[1] || "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.round((base64.length * 3) / 4 - padding);
}

function loadImageForCompression(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load image"));
    };
    image.src = url;
  });
}

async function compressImageFile(file, maxDimension = 1024, targetKb = 300) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Unsupported file type");
  }

  const image = await loadImageForCompression(file);
  let { width, height } = image;
  const maxSide = Math.max(width, height);
  if (maxSide > maxDimension) {
    const ratio = maxDimension / maxSide;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.92;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  let size = getBase64Size(dataUrl);
  const minBytes = 200 * 1024;
  const maxBytes = 500 * 1024;
  let attempts = 0;

  while (attempts < 8 && size > maxBytes) {
    quality = Math.max(0.45, quality * Math.min(0.9, maxBytes / size));
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    size = getBase64Size(dataUrl);
    attempts += 1;
  }

  attempts = 0;
  while (attempts < 4 && size < minBytes && quality < 0.99) {
    quality = Math.min(0.99, quality + 0.05);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    size = getBase64Size(dataUrl);
    attempts += 1;
  }

  return dataUrl;
}

export function AdminApp({
  data,
  actions,
  busyAction,
  orderSearchQuery = "",
  onOrderSearchChange,
  selectedTab,
  onTabChange
}) {
  const [internalTab, setInternalTab] = useState("dashboard");
  const tab = selectedTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  const [orderForm, setOrderForm] = useState(emptyOrderForm());
  const [orderFilter, setOrderFilter] = useState({ status: "all", shop_id: "all" });
  const [dashboardFilter, setDashboardFilter] = useState("all");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [assignWorkTab, setAssignWorkTab] = useState("all");
  const [selectedShopId, setSelectedShopId] = useState("");
  const [selectedKarigarId, setSelectedKarigarId] = useState("");
  const [karigarProfileTab, setKarigarProfileTab] = useState("history");
  const [cuttingDraft, setCuttingDraft] = useState({});

  const [assignDraft, setAssignDraft] = useState({});

  const [shopForm, setShopForm] = useState({ shop_name: "", contact: "", password: "" });
  const [shopEditForm, setShopEditForm] = useState({
    shop_id: "",
    shop_name: "",
    contact: "",
    password: ""
  });
  const [shopRateForm, setShopRateForm] = useState({
    shop_id: "",
    piece_name: "coat",
    item_type: "normal",
    rate: ""
  });

  const [karigarForm, setKarigarForm] = useState({ name: "", contact: "", password: "", role: "" });
  const [karigarEditForm, setKarigarEditForm] = useState({
    karigar_id: "",
    name: "",
    contact: "",
    role: "",
    password: ""
  });
  const [karigarRateForm, setKarigarRateForm] = useState({
    karigar_id: "",
    piece_name: "coat",
    item_type: "normal",
    rate: ""
  });

  const [shopPaymentForm, setShopPaymentForm] = useState({
    shop_id: "",
    amount: "",
    payment_date: "",
    note: ""
  });
  const [karigarPaymentForm, setKarigarPaymentForm] = useState({
    karigar_id: "",
    amount: "",
    payment_date: "",
    note: ""
  });

  const [settingsTab, setSettingsTab] = useState("products");
  const [productForm, setProductForm] = useState({ product_name: "", shop_name: "", shop_rate: "", cutting_rate: "" });
  const [subProductForm, setSubProductForm] = useState({ product_id: "", sub_product_name: "", worker_rate: "" });
  const [syncBusy, setSyncBusy] = useState(false);

  const [settingForm, setSettingForm] = useState({ key: "", value: "", description: "" });
  const [trackOrderId, setTrackOrderId] = useState("");

  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);
  const shopUsersByEntityId = useMemo(() => {
    return (data.users || []).reduce((map, entry) => {
      if (entry.role === "shop" && entry.entity_id) {
        map[entry.entity_id] = entry;
      }
      return map;
    }, {});
  }, [data.users]);
  const productsForSelectedShop = useMemo(() => {
    const selectedShopName = shopsById[orderForm.shop_id]?.shop_name;
    if (!selectedShopName) return [];
    return data.products.filter((product) => product.shop_name === selectedShopName);
  }, [data.products, orderForm.shop_id, shopsById]);

  const karigarById = useMemo(() => byId(data.karigars, "karigar_id"), [data.karigars]);
  const cuttingMasters = useMemo(
    () => data.karigars.filter((karigar) => karigarHasRequiredRole(karigar, "cutting_master")),
    [data.karigars]
  );
  const karigarUsersByEntityId = useMemo(() => {
    return (data.users || []).reduce((map, entry) => {
      if (entry.role === "karigar" && entry.entity_id) {
        map[entry.entity_id] = entry;
      }
      return map;
    }, {});
  }, [data.users]);

  const ordersById = useMemo(() => byId(data.orders, "order_id"), [data.orders]);
  const selectedShop = data.shops.find(
    (shop) => shop.shop_id === (selectedShopId || data.shops[0]?.shop_id)
  );
  const selectedKarigar = data.karigars.find(
    (karigar) => karigar.karigar_id === (selectedKarigarId || data.karigars[0]?.karigar_id)
  );
  const normalizedOrderSearchQuery = orderSearchQuery.trim().toLowerCase();

  const orderMatchesGlobalSearch = useCallback(
    (order) => {
      if (!normalizedOrderSearchQuery) return true;
      if (!order) return false;

      const orderNumber = order.order_number?.toString().toLowerCase() || "";
      const shopId = order.shop_id?.toString().toLowerCase() || "";
      const shopName = shopsById[order.shop_id]?.shop_name?.toLowerCase() || "";

      return [orderNumber, shopId, shopName].some((value) =>
        value.includes(normalizedOrderSearchQuery)
      );
    },
    [normalizedOrderSearchQuery, shopsById]
  );

  const orderItemsByOrder = useMemo(() => {
    return data.orderItems.reduce((map, item) => {
      if (!map[item.order_id]) map[item.order_id] = [];
      map[item.order_id].push(item);
      return map;
    }, {});
  }, [data.orderItems]);

  const piecesByOrder = useMemo(() => {
    return data.pieces.reduce((map, piece) => {
      if (!map[piece.order_id]) map[piece.order_id] = [];
      map[piece.order_id].push(piece);
      return map;
    }, {});
  }, [data.pieces]);

  const debouncedSetOrderFilter = useCallback(
    debounce((newFilter) => setOrderFilter(newFilter), 300),
    []
  );

  const handleDashboardFilterClick = useCallback((category) => {
    setDashboardFilter((current) => (current === category ? "all" : category));
  }, []);

  const dueSummary = useMemo(() => filterTodayAndOverdue(data.orders), [data.orders]);

  const dashboardFilterLabel = useMemo(() => {
    switch (dashboardFilter) {
      case "active":
        return "Active Orders";
      case "dueToday":
        return "Due Today";
      case "overdue":
        return "Overdue";
      case "pendingCutting":
        return "Pending Cutting";
      case "pendingApproval":
        return "Pending Approvals";
      case "ready":
        return "Ready for Delivery";
      default:
        return "All Orders";
    }
  }, [dashboardFilter]);

  const pendingApprovalCount = useMemo(
    () => data.pieces.filter(isPendingApprovalPiece).length,
    [data.pieces]
  );

  const handleShopFilterChange = useCallback((value) => {
    debouncedSetOrderFilter((current) => ({ ...current, shop_id: value }));
  }, [debouncedSetOrderFilter]);

  const handleStatusFilterChange = useCallback((value) => {
    debouncedSetOrderFilter((current) => ({ ...current, status: value }));
  }, [debouncedSetOrderFilter]);

  const filteredOrders = useMemo(() => {
    const dueTodayIds = new Set(dueSummary.dueToday.map((order) => order.order_id));
    const overdueIds = new Set(dueSummary.overdue.map((order) => order.order_id));

    return data.orders.filter((order) => {
      if (orderFilter.status !== "all" && order.status !== orderFilter.status) return false;
      if (orderFilter.shop_id !== "all" && order.shop_id !== orderFilter.shop_id) return false;
      if (!orderMatchesGlobalSearch(order)) return false;

      if (dashboardFilter === "active" && order.status === "delivered") return false;
      if (dashboardFilter === "dueToday" && !dueTodayIds.has(order.order_id)) return false;
      if (dashboardFilter === "overdue" && !overdueIds.has(order.order_id)) return false;
      if (dashboardFilter === "pendingCutting") {
        const orderPieces = piecesByOrder[order.order_id] || [];
        if (!orderPieces.some((piece) => !normalizeBool(piece.cutting_done))) return false;
      }
      if (dashboardFilter === "pendingApproval") {
        const orderPieces = piecesByOrder[order.order_id] || [];
        if (!orderPieces.some(isPendingApprovalPiece)) return false;
      }
      if (dashboardFilter === "ready") {
        const orderPieces = piecesByOrder[order.order_id] || [];
        if (!orderPieces.length || !orderPieces.every(isApprovedPiece)) return false;
      }

      return true;
    });
  }, [data.orders, orderFilter, orderMatchesGlobalSearch, dashboardFilter, dueSummary, piecesByOrder]);

  const pendingCutPieces = useMemo(() => {
    const rawPending = data.pieces.filter((piece) => !normalizeBool(piece.cutting_done));
    const grouped = new Map();

    rawPending.forEach((piece) => {
      const key = piece.item_id || piece.piece_id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ...piece,
          _pendingCount: 0
        });
      }
      grouped.get(key)._pendingCount += 1;
    });

    return Array.from(grouped.values());
  }, [data.pieces]);

  const assignablePieces = useMemo(() => {
    return data.pieces.filter(
      (piece) =>
        normalizeBool(piece.cutting_done) && piece.karigar_status === "not_assigned"
    );
  }, [data.pieces]);

  const filteredAssignablePieces = useMemo(() => {
    return assignablePieces.filter(
      (piece) =>
        pieceMatchesAssignTab(piece, assignWorkTab) &&
        orderMatchesGlobalSearch(ordersById[piece.order_id])
    );
  }, [assignablePieces, assignWorkTab, orderMatchesGlobalSearch, ordersById]);

  const getEligibleKarigarsForPiece = useCallback(
    (piece) => {
      const requiredRole = normalizeRoleValue(piece?.assigned_role) || getRequiredRoleForPiece(piece?.piece_name);
      return data.karigars.filter((karigar) => karigarHasRequiredRole(karigar, requiredRole));
    },
    [data.karigars]
  );

  const dashboard = data.computed?.dashboard || {
    total_active_orders: 0,
    orders_ready_for_delivery: 0,
    pieces_pending_cutting: 0,
    pieces_assigned_pending_completion: 0,
    overdue_orders: 0
  };

  const trackSummary = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dayAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

    const overdue = [];
    const dueToday = [];
    const dueTomorrow = [];
    const ready = [];

    data.orders.forEach((order) => {
      const pieces = piecesByOrder[order.order_id] || [];
      const pendingPieces = pieces.filter((piece) => !isApprovedPiece(piece));

      if (!pendingPieces.length) {
        ready.push(order);
        return;
      }

      const delivery = new Date(order.delivery_date);
      if (Number.isNaN(delivery.getTime())) return;

      if (delivery < today) {
        overdue.push(order);
        return;
      }

      if (delivery >= today && delivery < tomorrow) {
        dueToday.push(order);
        return;
      }

      if (delivery >= tomorrow && delivery < dayAfterTomorrow) {
        dueTomorrow.push(order);
      }
    });

    return {
      overdue,
      dueToday,
      dueTomorrow,
      ready
    };
  }, [data.orders, piecesByOrder]);

  const karigarDelayRows = useMemo(() => {
    const now = new Date();

    return data.karigars.map((karigar) => {
      const assignedPieces = data.pieces.filter(
        (piece) =>
          piece.assigned_karigar_id === karigar.karigar_id &&
          !isApprovedPiece(piece)
      );

      const assignedDays = assignedPieces
        .map((piece) => {
          const assignedDate = new Date(piece.assigned_date || piece.updated_date || piece.created_date);
          if (Number.isNaN(assignedDate.getTime())) return 0;
          return Math.max(0, Math.floor((now - assignedDate) / (1000 * 60 * 60 * 24)));
        })
        .filter((value) => Number.isFinite(value));

      const averageAssignedDays = assignedDays.length
        ? assignedDays.reduce((sum, day) => sum + day, 0) / assignedDays.length
        : 0;

      const completedPieces = data.pieces.filter(
        (piece) =>
          piece.assigned_karigar_id === karigar.karigar_id &&
          isApprovedPiece(piece)
      );

      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);

      const completedThisWeek = completedPieces.filter((piece) => {
        const date = new Date(piece.karigar_complete_date);
        return !Number.isNaN(date.getTime()) && date >= weekAgo;
      }).length;

      const completedThisMonth = completedPieces.filter((piece) => {
        const date = new Date(piece.karigar_complete_date);
        return !Number.isNaN(date.getTime()) && date >= monthAgo;
      }).length;

      return {
        karigar,
        assignedNow: assignedPieces.length,
        averageAssignedDays,
        completedThisWeek,
        completedThisMonth
      };
    });
  }, [data.karigars, data.pieces]);

  const selectedTrackOrderId = trackOrderId || data.orders[0]?.order_id || "";
  const selectedTrackOrder = data.orders.find((order) => order.order_id === selectedTrackOrderId);
  const selectedTrackPieces = piecesByOrder[selectedTrackOrderId] || [];
  const selectedShopOrders = selectedShop
    ? data.orders.filter((order) => order.shop_id === selectedShop.shop_id)
    : [];
  const selectedShopPayments = selectedShop
    ? data.paymentsShops.filter((payment) => payment.shop_id === selectedShop.shop_id)
    : [];
  const selectedShopFinancial = selectedShop
    ? data.computed?.shopFinancials?.[selectedShop.shop_id] || { billed: 0, paid: 0, balance: 0 }
    : { billed: 0, paid: 0, balance: 0 };
  const selectedKarigarPieces = selectedKarigar
    ? data.pieces.filter(
        (piece) =>
          piece.assigned_karigar_id === selectedKarigar.karigar_id ||
          piece.cutting_by === selectedKarigar.karigar_id
      )
    : [];
  const selectedKarigarPayments = selectedKarigar
    ? data.paymentsKarigar.filter((payment) => payment.karigar_id === selectedKarigar.karigar_id)
    : [];
  const selectedKarigarFinancial = selectedKarigar
    ? data.computed?.karigarFinancials?.[selectedKarigar.karigar_id] || {
        earned: 0,
        pending: 0,
        paid: 0,
        balance: 0
      }
    : { earned: 0, pending: 0, paid: 0, balance: 0 };
  const selectedKarigarCompletedCount = selectedKarigarPieces.filter(
    (piece) =>
      piece.cutting_by === selectedKarigar?.karigar_id
        ? normalizeBool(piece.cutting_done)
        : isApprovedPiece(piece) || isPendingApprovalPiece(piece)
  ).length;
  const selectedKarigarApprovedPieces = selectedKarigarPieces.filter((piece) =>
    piece.cutting_by === selectedKarigar?.karigar_id
      ? normalizeBool(piece.cutting_done)
      : isApprovedPiece(piece)
  );

  const financialOverview = useMemo(() => {
    const karigarRows = data.karigars
      .map((karigar) => {
        const financial = data.computed?.karigarFinancials?.[karigar.karigar_id] || {
          earned: 0,
          pending: 0,
          paid: 0,
          balance: 0
        };
        const payable = Math.max(0, number(financial.balance) + number(financial.pending));
        return {
          id: karigar.karigar_id,
          name: karigar.name,
          payable,
          pending: number(financial.pending),
          balance: number(financial.balance)
        };
      })
      .filter((row) => row.payable > 0)
      .sort((a, b) => b.payable - a.payable);

    const shopRows = data.shops
      .map((shop) => {
        const financial = data.computed?.shopFinancials?.[shop.shop_id] || {
          billed: 0,
          paid: 0,
          balance: 0
        };
        const receivable = Math.max(0, number(financial.balance));
        return {
          id: shop.shop_id,
          name: shop.shop_name,
          receivable
        };
      })
      .filter((row) => row.receivable > 0)
      .sort((a, b) => b.receivable - a.receivable);

    return {
      karigarRows,
      shopRows,
      totalPayable: karigarRows.reduce((sum, row) => sum + row.payable, 0),
      totalReceivable: shopRows.reduce((sum, row) => sum + row.receivable, 0)
    };
  }, [data.computed?.karigarFinancials, data.computed?.shopFinancials, data.karigars, data.shops]);

  const submitOrder = async (event) => {
    event.preventDefault();
    const payload = {
      ...orderForm,
      designing_shop_charge: orderForm.designing_enabled
        ? number(orderForm.designing_shop_charge)
        : 0,
      items: orderForm.items.map((item) => {
        const product = data.products.find((p) => p.product_id === item.product_id);
        return {
          ...item,
          piece_type: product?.product_name || item.piece_type || "",
          item_rate: item.item_rate === "" ? undefined : number(item.item_rate)
        };
      })
    };

    const ok = await actions.createOrder(payload);
    if (ok) {
      setOrderForm(emptyOrderForm());
      setTab("orders");
    }
  };

  const handleSyncPayroll = async () => {
    const confirmed = window.confirm(
      "Sync all approved/completed pending pieces to payroll balances?"
    );
    if (!confirmed) return;

    setSyncBusy(true);
    try {
      console.log("[ADMIN_SYNC] Clicked, calling actions.syncPayroll...");
      const result = await actions.syncPayroll();
      console.log("[ADMIN_SYNC_RESULT]", result);
      if (result?.syncedPieces?.length > 0) {
        const total = result.syncedPieces.reduce(
          (sum, p) => sum + number(p.karigar_rate || 0) + number(p.designing_karigar_charge || 0),
          0
        );
        generateMasterPayrollPdf(result.syncedPieces, total);
      }
    } finally {
      setSyncBusy(false);
    }
  };


  const selectSlipPhoto = async (file) => {
    if (!file) return;

    try {
      const dataUrl = await compressImageFile(file, 1024, 300);
      setOrderForm((current) => ({
        ...current,
        slip_photo_data_url: dataUrl,
        slip_photo_name: file.name || "slip-photo.jpg"
      }));
    } catch {
      setOrderForm((current) => ({
        ...current,
        slip_photo_data_url: "",
        slip_photo_name: ""
      }));
    }
  };

  const uploadCuttingPhoto = async (pieceId, file) => {
    if (!file) return;

    try {
      const { payload, meta } = await preparePhotoPayloadForApi(file, {
        folder: "bin-hassan-bespoke/cutting"
      });
      console.log(
        "[ADMIN_CUTTING_UPLOAD]",
        JSON.stringify({
          pieceId,
          uploadMode: meta.uploadMode,
          compressedBytes: meta.compressedBytes
        })
      );
      await actions.markPieceCut({
        piece_id: pieceId,
        cutting_karigar_id: cuttingDraft[pieceId]?.karigar_id || cuttingMasters[0]?.karigar_id || "",
        ...payload
      });
    } catch (err) {
      console.error("Cutting upload failed:", err);
      if (/too large/i.test(err.message || "")) {
        window.alert(err.message);
      }
      // Ignore local read errors; app-level error toast handles API issues.
    }
  };

  const markCuttingPiece = async (pieceId) => {
    await actions.markPieceCut({
      piece_id: pieceId,
      cutting_karigar_id: cuttingDraft[pieceId]?.karigar_id || cuttingMasters[0]?.karigar_id || ""
    });
  };

  const updateOrderStatus = async (orderId, status) => {
    if (!status || ordersById[orderId]?.status === status) return;

    const payload = {
      order_id: orderId,
      status
    };

    if (status === "delivered") {
      payload.is_archived = true;
    }

    await actions.updateOrder(payload);
  };

  const updateOrderItem = (index, field, value) => {
    setOrderForm((current) => {
      const items = [...current.items];
      items[index] = {
        ...items[index],
        [field]: value
      };
      return {
        ...current,
        items
      };
    });
  };

  const addOrderItem = () => {
    setOrderForm((current) => ({
      ...current,
      items: [...current.items, emptyOrderItem()]
    }));
  };

  const removeOrderItem = (index) => {
    setOrderForm((current) => {
      if (current.items.length <= 1) return current;
      return {
        ...current,
        items: current.items.filter((_, itemIndex) => itemIndex !== index)
      };
    });
  };

  const assignPiece = async (pieceId) => {
    const draft = assignDraft[pieceId] || {};
    if (!draft.karigar_id) return;

    const ok = await actions.assignPiece({
      piece_id: pieceId,
      karigar_id: draft.karigar_id,
      designing_karigar_charge: number(draft.designing_karigar_charge || 0)
    });

    if (ok) {
      setAssignDraft((current) => {
        const next = { ...current };
        delete next[pieceId];
        return next;
      });
    }
  };

  const toggleKarigarRole = (target, roleValue) => {
    const setter = target === "edit" ? setKarigarEditForm : setKarigarForm;
    setter((current) => {
      const roles = new Set(getRoleValues(current.role));
      if (roles.has(roleValue)) {
        roles.delete(roleValue);
      } else {
        roles.add(roleValue);
      }
      return {
        ...current,
        role: Array.from(roles).join(",")
      };
    });
  };

  const handleApprovePiece = async (pieceId) => {
    await actions.approvePiece({ piece_id: pieceId });
  };

  const handleRequestPieceApproval = async (pieceId) => {
    await actions.completePiece({ piece_id: pieceId });
  };

  const handleMarkOrderDelivered = async (orderId) => {
    await updateOrderStatus(orderId, "delivered");
  };

  const submitProduct = async (event) => {
    event.preventDefault();
    const payload = {
      product_name: productForm.product_name,
      shop_name: productForm.shop_name,
      shop_rate: number(productForm.shop_rate),
      cutting_rate: number(productForm.cutting_rate || 0)
    };
    const ok = await actions.saveProduct(payload);
    if (ok) {
      setProductForm({ product_name: "", shop_name: "", shop_rate: "", cutting_rate: "" });
    }
  };

  const submitSubProduct = async (event) => {
    event.preventDefault();
    const payload = {
      product_id: subProductForm.product_id,
      sub_product_name: subProductForm.sub_product_name,
      worker_rate: number(subProductForm.worker_rate)
    };
    const ok = await actions.saveSubProduct(payload);
    if (ok) {
      setSubProductForm({ product_id: "", sub_product_name: "", worker_rate: "" });
    }
  };

  const submitShop = async (event) => {
    event.preventDefault();
    const ok = await actions.createShop(shopForm);
    if (ok) setShopForm({ shop_name: "", contact: "", password: "" });
  };

  const submitShopUpdate = async (event) => {
    event.preventDefault();
    const ok = await actions.updateShop(shopEditForm);
    if (ok) {
      setShopEditForm({ shop_id: "", shop_name: "", contact: "", password: "" });
    }
  };

  const submitShopRate = async (event) => {
    event.preventDefault();
    const ok = await actions.saveShopRates({
      rates: [{ ...shopRateForm, rate: number(shopRateForm.rate) }]
    });
    if (ok) {
      setShopRateForm((current) => ({
        ...current,
        rate: ""
      }));
    }
  };

  const submitKarigar = async (event) => {
    event.preventDefault();
    if (!getRoleValues(karigarForm.role).length) {
      window.alert("Please select at least one role/specialty for this karigar.");
      return;
    }
    const ok = await actions.createKarigar(karigarForm);
    if (ok) setKarigarForm({ name: "", contact: "", password: "", role: "" });
  };

  const submitKarigarUpdate = async (event) => {
    event.preventDefault();
    if (!getRoleValues(karigarEditForm.role).length) {
      window.alert("Please select at least one role/specialty for this karigar.");
      return;
    }
    const ok = await actions.updateKarigar(karigarEditForm);
    if (ok) {
      setKarigarEditForm({ karigar_id: "", name: "", contact: "", role: "", password: "" });
    }
  };

  const submitKarigarRate = async (event) => {
    event.preventDefault();
    const ok = await actions.saveKarigarRates({
      rates: [{ ...karigarRateForm, rate: number(karigarRateForm.rate) }]
    });
    if (ok) {
      setKarigarRateForm((current) => ({
        ...current,
        rate: ""
      }));
    }
  };

  const submitShopPayment = async (event) => {
    event.preventDefault();
    const ok = await actions.createShopPayment({
      ...shopPaymentForm,
      amount: number(shopPaymentForm.amount)
    });
    if (ok) {
      setShopPaymentForm({ shop_id: "", amount: "", payment_date: "", note: "" });
    }
  };

  const submitKarigarPayment = async (event) => {
    event.preventDefault();
    const ok = await actions.createKarigarPayment({
      ...karigarPaymentForm,
      amount: number(karigarPaymentForm.amount)
    });
    if (ok) {
      setKarigarPaymentForm({
        karigar_id: "",
        amount: "",
        payment_date: "",
        note: ""
      });
    }
  };

  const submitSetting = async (event) => {
    event.preventDefault();
    const ok = await actions.saveSettings({
      settings: [{ ...settingForm }]
    });

    if (ok) {
      setSettingForm({ key: "", value: "", description: "" });
    }
  };

  const handleDeleteAllData = async () => {
    const confirmed = window.confirm(
      "Delete all application data from Google Sheet and clear local cache after sync?"
    );
    if (!confirmed) return;
    await actions.clearAllData();
  };

  const handleDeleteShop = async () => {
    if (!shopEditForm.shop_id) return;

    // Validation: prevent deletion if shop has non-delivered orders
    const activeOrders = (data.orders || []).filter(
      (o) => o.shop_id === shopEditForm.shop_id && o.status !== "delivered"
    );

    if (activeOrders.length > 0) {
      window.alert(
        `Cannot delete shop "${shopEditForm.shop_name}" because it has ${activeOrders.length} active (non-delivered) orders. Please deliver or cancel them first.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete shop "${shopEditForm.shop_name}" and its login account?`
    );
    if (!confirmed) return;
    const ok = await actions.deleteShop({ shop_id: shopEditForm.shop_id });
    if (ok) {
      setShopEditForm({ shop_id: "", shop_name: "", contact: "", password: "" });
    }
  };

  const handleDeleteKarigar = async () => {
    if (!karigarEditForm.karigar_id) return;

    // Validation: prevent deletion if karigar has pending pieces
    const pendingPieces = (data.pieces || []).filter(
      (p) =>
        p.assigned_karigar_id === karigarEditForm.karigar_id &&
        !isApprovedPiece(p)
    );

    if (pendingPieces.length > 0) {
      window.alert(
        `Cannot delete karigar "${karigarEditForm.name}" because they have ${pendingPieces.length} pending pieces assigned. Please complete or unassign them first.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete karigar "${karigarEditForm.name}" and its login account?`
    );
    if (!confirmed) return;
    const ok = await actions.deleteKarigar({ karigar_id: karigarEditForm.karigar_id });
    if (ok) {
      setKarigarEditForm({ karigar_id: "", name: "", contact: "", role: "", password: "" });
    }
  };

  const renderOrderList = (orders, emptyText = "No orders found.") => (
    <div className="order-list">
      {orders.map((order) => {
        const orderPieces = piecesByOrder[order.order_id] || [];
        const orderItems = orderItemsByOrder[order.order_id] || [];
        const completeCount = orderPieces.filter(isApprovedPiece).length;
        const total = data.computed?.orderTotals?.[order.order_id]?.grand_total || 0;
        const shopName = shopsById[order.shop_id]?.shop_name || order.shop_id || "-";
        const isExpanded = expandedOrderId === order.order_id;

        return (
          <OrderListCard
            key={order.order_id}
            order={order}
            shopName={shopName}
            total={total}
            orderItems={orderItems}
            orderPieces={orderPieces}
            completeCount={completeCount}
            isExpanded={isExpanded}
            busyAction={busyAction}
            onToggle={() =>
              setExpandedOrderId((current) =>
                current === order.order_id ? "" : order.order_id
              )
            }
            onStatusChange={(status) => updateOrderStatus(order.order_id, status)}
            onApprovePiece={handleApprovePiece}
            onDeliverOrder={() => handleMarkOrderDelivered(order.order_id)}
            onAssignWork={() => {
              if (typeof onOrderSearchChange === "function") {
                onOrderSearchChange(order.order_number?.toString() || "");
              }
              setTab("assign");
            }}
          />
        );
      })}

      {!orders.length ? (
        <div className="empty-list-state">
          <p className="muted">{emptyText}</p>
        </div>
      ) : null}
    </div>
  );

  const isMainShopsTab = tab === "shops";
  const isSettingsShopsTab = tab === "settings" && settingsTab === "shops";
  const isMainKarigarTab = tab === "karigar";
  const isSettingsKarigarTab = tab === "settings" && settingsTab === "karigar";

  return (
    <div className="role-shell">
      <div className="tab-row main-tab-row wrap">
        {TAB_LIST.map((entry) => (
          <button
            key={entry.key}
            className={tab === entry.key ? "tab-button active" : "tab-button"}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        <section className="panel">
          <h2>Live Dashboard</h2>

          <div className="metrics-grid five">
            <button
              type="button"
              className={`metric-card metric-card-action ${dashboardFilter === "active" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("active")}
              aria-pressed={dashboardFilter === "active"}
            >
              <p>Active Orders</p>
              <h3>{dashboard.total_active_orders}</h3>
            </button>
            <button
              type="button"
              className={`metric-card metric-card-action ${dashboardFilter === "dueToday" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("dueToday")}
              aria-pressed={dashboardFilter === "dueToday"}
            >
              <p>Due Today</p>
              <h3>{dueSummary.dueToday.length}</h3>
            </button>
            <button
              type="button"
              className={`metric-card metric-card-action ${dashboardFilter === "overdue" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("overdue")}
              aria-pressed={dashboardFilter === "overdue"}
            >
              <p>Overdue</p>
              <h3>{dashboard.overdue_orders}</h3>
            </button>
            <button
              type="button"
              className={`metric-card metric-card-action ${dashboardFilter === "pendingCutting" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("pendingCutting")}
              aria-pressed={dashboardFilter === "pendingCutting"}
            >
              <p>Pending Cutting</p>
              <h3>{dashboard.pieces_pending_cutting}</h3>
            </button>
            <button
              type="button"
              className={`metric-card metric-card-action ${dashboardFilter === "pendingApproval" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("pendingApproval")}
              aria-pressed={dashboardFilter === "pendingApproval"}
            >
              <p>Pending Approvals</p>
              <h3>{pendingApprovalCount}</h3>
            </button>
            <button
              type="button"
              className={`metric-card metric-card-action highlight ${dashboardFilter === "ready" ? "selected" : ""}`}
              onClick={() => handleDashboardFilterClick("ready")}
              aria-pressed={dashboardFilter === "ready"}
            >
              <p>Ready for Delivery</p>
              <h3>{dashboard.orders_ready_for_delivery}</h3>
            </button>
          </div>

          <div className="financial-stats-grid">
            <div className="panel inset financial-stats-card">
              <div className="panel-head">
                <div>
                  <h3>Payable to Karigars</h3>
                  <p className="muted">Approved and pending-sync work liability</p>
                </div>
                <strong>{formatCurrency(financialOverview.totalPayable)}</strong>
              </div>
              <div className="inline-list compact-list">
                {financialOverview.karigarRows.slice(0, 6).map((row) => (
                  <div className="inline-list-row" key={row.id}>
                    <span>{row.name}</span>
                    <strong>{formatCurrency(row.payable)}</strong>
                  </div>
                ))}
                {!financialOverview.karigarRows.length ? (
                  <p className="muted">No payable balance right now.</p>
                ) : null}
              </div>
            </div>

            <div className="panel inset financial-stats-card">
              <div className="panel-head">
                <div>
                  <h3>Receivable from Shops</h3>
                  <p className="muted">Outstanding shop billing balance</p>
                </div>
                <strong>{formatCurrency(financialOverview.totalReceivable)}</strong>
              </div>
              <div className="inline-list compact-list">
                {financialOverview.shopRows.slice(0, 6).map((row) => (
                  <div className="inline-list-row" key={row.id}>
                    <span>{row.name}</span>
                    <strong>{formatCurrency(row.receivable)}</strong>
                  </div>
                ))}
                {!financialOverview.shopRows.length ? (
                  <p className="muted">No receivable balance right now.</p>
                ) : null}
              </div>
            </div>
          </div>

          {dashboardFilter !== "all" ? (
            <div className="panel inset" style={{ margin: "1rem 0" }}>
              <div className="panel-head">
                <h3>{dashboardFilterLabel}</h3>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setDashboardFilter("all")}
                >
                  Clear filter
                </button>
              </div>
              {renderOrderList(
                filteredOrders,
                dashboardFilter === "pendingCutting"
                  ? "No pending tasks."
                  : `No ${dashboardFilterLabel.toLowerCase()} orders found.`
              )}
            </div>
          ) : (
            <div className="panel inset" style={{ margin: "1rem 0" }}>
              <p className="muted">Select a category to view orders.</p>
            </div>
          )}
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="panel">
          <h2>Settings</h2>
          <div className="tab-row wrap" style={{ marginBottom: "1rem" }}>
            <button
              className={settingsTab === "products" ? "tab-button active" : "tab-button"}
              onClick={() => setSettingsTab("products")}
            >
              Product Manager
            </button>
            <button
              className={settingsTab === "shops" ? "tab-button active" : "tab-button"}
              onClick={() => setSettingsTab("shops")}
            >
              Shops
            </button>
            <button
              className={settingsTab === "karigar" ? "tab-button active" : "tab-button"}
              onClick={() => setSettingsTab("karigar")}
            >
              Karigar
            </button>
          </div>
        </section>
      ) : null}

      {tab === "products" || (tab === "settings" && settingsTab === "products") ? (
        <section className="panel">
          <h2>Product Manager</h2>
          <div className="split-grid">
            <div className="panel inset">
              <h3>Add New Product</h3>
              <form className="form-grid" onSubmit={submitProduct}>
                <label>Product Name (e.g. 3-Piece VIP)
                  <input className="input" value={productForm.product_name} onChange={e => setProductForm({...productForm, product_name: e.target.value})} required />
                </label>
                <label>Shop Name
                  <select
                    className="input"
                    value={productForm.shop_name}
                    onChange={e => setProductForm({...productForm, shop_name: e.target.value})}
                    required
                  >
                    <option value="">Select Shop</option>
                    {data.shops.map((shop) => (
                      <option key={shop.shop_id} value={shop.shop_name}>
                        {shop.shop_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Shop Rate
                  <input type="number" className="input" value={productForm.shop_rate} onChange={e => setProductForm({...productForm, shop_rate: e.target.value})} required />
                </label>
                <label>Cutting Rate
                  <input type="number" className="input" value={productForm.cutting_rate} onChange={e => setProductForm({...productForm, cutting_rate: e.target.value})} required />
                </label>
                <button className="button primary" type="submit">Save Product</button>
              </form>
            </div>
            <div className="panel inset">
              <h3>Define Sub-Products & Worker Rates</h3>
              <form className="form-grid" onSubmit={submitSubProduct}>
                <label>Parent Product
                  <select className="input" value={subProductForm.product_id} onChange={e => setSubProductForm({...subProductForm, product_id: e.target.value})} required>
                    <option value="">Select Product</option>
                    {data.products.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name} ({p.shop_name})</option>)}
                  </select>
                </label>
                <label>Sub-Product Name (e.g. Coat)
                  <input className="input" value={subProductForm.sub_product_name} onChange={e => setSubProductForm({...subProductForm, sub_product_name: e.target.value})} required />
                </label>
                <label>Worker Rate
                  <input type="number" className="input" value={subProductForm.worker_rate} onChange={e => setSubProductForm({...subProductForm, worker_rate: e.target.value})} required />
                </label>
                <button className="button warning" type="submit">Add Sub-Product</button>
              </form>
            </div>
          </div>

          <div className="table-wrap" style={{marginTop:'2rem'}}>
            <table>
              <thead>
                <tr><th>Product</th><th>Shop Rate</th><th>Cutting Rate</th><th>Sub-Products</th></tr>
              </thead>
              <tbody>
                {data.products.map(p => (
                  <tr key={p.product_id}>
                    <td>{p.product_name}</td>
                    <td>{p.shop_rate}</td>
                    <td>{p.cutting_rate || 0}</td>
                    <td>
                      {data.productSubProducts.filter(s => s.product_id === p.product_id).map(s => (
                        <span key={s.sub_id} className="badge" style={{marginRight:'4px'}}>
                          {s.sub_product_name}: {s.worker_rate}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "orders" ? (
        <section className="panel">
          <h2>Create Order</h2>
          {dashboardFilter !== "all" ? (
            <p className="muted" style={{ marginBottom: "1rem" }}>
              Active filter: {dashboardFilter === "active" ? "Active Orders" : dashboardFilter === "dueToday" ? "Due Today" : dashboardFilter === "overdue" ? "Overdue" : dashboardFilter === "pendingCutting" ? "Pending Cutting" : dashboardFilter === "ready" ? "Ready for Delivery" : "All Orders"}
            </p>
          ) : null}
          <form className="form-grid" onSubmit={submitOrder}>
            <label>
              Order Number
              <input
                className="input"
                value={orderForm.order_number}
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    order_number: event.target.value
                  }))
                }
                required
              />
            </label>

            <label>
              Shop
              <select
                className="input"
                value={orderForm.shop_id}
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    shop_id: event.target.value,
                    items: current.items.map((item) => ({
                      ...item,
                      product_id: "",
                      piece_type: ""
                    }))
                  }))
                }
                required
              >
                <option value="">Select shop</option>
                {data.shops.map((shop) => (
                  <option key={shop.shop_id} value={shop.shop_id}>
                    {shop.shop_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Delivery Date
              <input
                type="date"
                className="input"
                value={orderForm.delivery_date}
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    delivery_date: event.target.value
                  }))
                }
                required
              />
            </label>

            <label className="toggle-label">
              <input
                type="checkbox"
                checked={orderForm.designing_enabled}
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    designing_enabled: event.target.checked
                  }))
                }
              />
              Designing Enabled
            </label>

            {orderForm.designing_enabled ? (
              <label>
                Shop Designing Charge
                <input
                  type="number"
                  className="input"
                  min="0"
                  value={orderForm.designing_shop_charge}
                  onChange={(event) =>
                    setOrderForm((current) => ({
                      ...current,
                      designing_shop_charge: event.target.value
                    }))
                  }
                />
              </label>
            ) : null}
            <div className="panel inset">
              <h3>Reference Measurement Slip</h3>
              <label className="file-upload">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => selectSlipPhoto(event.target.files?.[0])}
                />
                <span>{orderForm.slip_photo_name || "Upload Measurement Slip Photo (Optional)"}</span>
              </label>

              {orderForm.slip_photo_data_url ? (
                <img
                  src={orderForm.slip_photo_data_url}
                  alt="Measurement slip"
                  className="slip-thumb large"
                />
              ) : (
                <p className="muted">
                  Slip photo is optional. You can submit the order without uploading an image.
                </p>
              )}
            </div>

            <div className="sub-panel"> 
              <div className="panel-head">
                <h3>Items</h3>
                <button type="button" className="button ghost" onClick={addOrderItem}>
                  Add Item
                </button>
              </div>

              {orderForm.items.map((item, index) => (
                <div className="item-row" key={`item-${index}`}>
                  <label>
                Product Configuration
                <select
                  className="input"
                  value={item.product_id}
                  onChange={(event) => updateOrderItem(index, "product_id", event.target.value)}
                  disabled={!orderForm.shop_id}
                  required
                >
                  <option value="">{orderForm.shop_id ? "Select Product Configuration" : "Select Shop First"}</option>
                  {productsForSelectedShop.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.product_name} ({p.shop_name})
                    </option>
                  ))}
                </select>
              </label>

                  <label>
                    Item Type
                    <select
                      className="input"
                      value={item.item_type}
                      onChange={(event) =>
                        updateOrderItem(index, "item_type", event.target.value)
                      }
                    >
                      {ITEM_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Measurement Photo URL
                    <input
                      className="input"
                      value={item.measurement_photo_url}
                      onChange={(event) =>
                        updateOrderItem(index, "measurement_photo_url", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Override Rate (optional)
                    <input
                      type="number"
                      className="input"
                      min="0"
                      value={item.item_rate}
                      onChange={(event) =>
                        updateOrderItem(index, "item_rate", event.target.value)
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="button danger ghost"
                    onClick={() => removeOrderItem(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <button className="button" type="submit" disabled={busyAction === "createOrder"}>
              {busyAction === "createOrder" ? "Saving..." : "Save Order"}
            </button>
          </form>

          <div className="panel inset">
            <div className="panel-head">
              <h3>Orders</h3>
              <div className="inline-controls">
                <select
                  className="input"
                  value={orderFilter.shop_id}
                  onChange={(event) => handleShopFilterChange(event.target.value)}
                >
                  <option value="all">All Shops</option>
                  {data.shops.map((shop) => (
                    <option key={shop.shop_id} value={shop.shop_id}>
                      {shop.shop_name}
                    </option>
                  ))}
                </select>

                <select
                  className="input"
                  value={orderFilter.status}
                  onChange={(event) => handleStatusFilterChange(event.target.value)}
                >
                  <option value="all">All Status</option>
                  {Object.keys(ORDER_STATUS_META).map((status) => (
                    <option key={status} value={status}>
                      {ORDER_STATUS_META[status].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {renderOrderList(
              filteredOrders,
              orderSearchQuery.trim()
                ? "No orders found matching your search."
                : "No orders found."
            )}
          </div>
        </section>
      ) : null}

      {tab === "cutting" ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Cutting Queue</h2>
            </div>
          </div>

          <div className="cards-grid">
            {pendingCutPieces.map((piece) => {
              const order = data.orders.find((entry) => entry.order_id === piece.order_id);
              const displayName = piece.bundle_piece_type || piece.piece_name;
              const selectedCuttingMasterId =
                cuttingDraft[piece.piece_id]?.karigar_id || cuttingMasters[0]?.karigar_id || "";

              return (
                <article className="card" key={piece.piece_id}>
                  <p>
                    <strong>{displayName}</strong> - {piece.item_type}
                  </p>
                  <p className="muted">Order: {order?.order_number || "-"}</p>
                  <p className="muted">
                    Shop: {shopsById[order?.shop_id]?.shop_name || order?.shop_id || "-"}
                  </p>
                  {piece._pendingCount > 1 ? (
                    <p className="muted">Includes {piece._pendingCount} sub-products</p>
                  ) : null}
                  {piece.reference_slip_url ? (
                    <a className="link" href={piece.reference_slip_url} target="_blank" rel="noreferrer">
                      <img src={piece.reference_slip_url} alt="Reference slip" className="slip-thumb" />
                    </a>
                  ) : null}
                  <label>
                    Cutting Master
                    <select
                      className="input"
                      value={selectedCuttingMasterId}
                      onChange={(event) =>
                        setCuttingDraft((current) => ({
                          ...current,
                          [piece.piece_id]: {
                            ...current[piece.piece_id],
                            karigar_id: event.target.value
                          }
                        }))
                      }
                    >
                      <option value="">Uncredited / legacy cutting</option>
                      {cuttingMasters.map((karigar) => (
                        <option key={karigar.karigar_id} value={karigar.karigar_id}>
                          {karigar.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {piece.reference_slip_url ? (
                    <>
                      <label className="file-upload">
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => uploadCuttingPhoto(piece.piece_id, event.target.files?.[0])}
                          disabled={busyAction === `cut:${piece.piece_id}`}
                        />
                        <span>
                          {busyAction === `cut:${piece.piece_id}` ? "Uploading..." : "Upload Cutting Photo"}
                        </span>
                      </label>
                      <button
                        className="button secondary small"
                        onClick={() => markCuttingPiece(piece.piece_id)}
                        disabled={busyAction === `cut:${piece.piece_id}`}
                        style={{ marginTop: "0.5rem" }}
                      >
                        Mark Cut
                      </button>
                    </>
                  ) : (
                    <button
                      className="button primary small"
                      onClick={() => markCuttingPiece(piece.piece_id)}
                      disabled={busyAction === `cut:${piece.piece_id}`}
                    >
                      Mark Cut
                    </button>
                  )}
                </article>
              );
            })}
            {!pendingCutPieces.length ? <p className="muted">All pieces are cut.</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "assign" ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Assign Work</h2>
            </div>
          </div>

          <div className="tab-row wrap" style={{ marginBottom: "1rem" }}>
            {ASSIGN_WORK_TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={assignWorkTab === entry.key ? "tab-button active" : "tab-button"}
                onClick={() => setAssignWorkTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="cards-grid">
            {filteredAssignablePieces.map((piece) => {
              const draft = assignDraft[piece.piece_id] || {
                karigar_id: "",
                designing_karigar_charge: "0"
              };

              const order = data.orders.find((entry) => entry.order_id === piece.order_id);
              const requiredRole = normalizeRoleValue(piece.assigned_role) || getRequiredRoleForPiece(piece.piece_name);
              const eligibleKarigars = getEligibleKarigarsForPiece(piece);

              return (
                <article className="card" key={piece.piece_id}>
                  <p>
                    <strong>{piece.piece_name}</strong> - {piece.item_type}
                  </p>
                  <p className="muted">Order: {order?.order_number || "-"}</p>
                  <p className="muted">
                    Shop: {shopsById[order?.shop_id]?.shop_name || order?.shop_id || "-"}
                  </p>
                  <p className="muted">Required: {formatKarigarRoles(requiredRole)}</p>

                  <label>
                    Karigar
                    <select
                      className="input"
                      value={draft.karigar_id}
                      onChange={(event) =>
                        setAssignDraft((current) => ({
                          ...current,
                          [piece.piece_id]: {
                            ...draft,
                            karigar_id: event.target.value
                          }
                        }))
                      }
                    >
                      <option value="">Select karigar</option>
                      {eligibleKarigars.map((karigar) => (
                        <option key={karigar.karigar_id} value={karigar.karigar_id}>
                          {karigar.name} - {formatKarigarRoles(karigar.role || karigar.skills)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!eligibleKarigars.length ? (
                    <p className="muted">No karigar has the required role yet.</p>
                  ) : null}

                  <label>
                    Designing Charge
                    <input
                      type="number"
                      className="input"
                      min="0"
                      value={draft.designing_karigar_charge}
                      onChange={(event) =>
                        setAssignDraft((current) => ({
                          ...current,
                          [piece.piece_id]: {
                            ...draft,
                            designing_karigar_charge: event.target.value
                          }
                        }))
                      }
                    />
                  </label>

                  <button
                    className="button"
                    onClick={() => assignPiece(piece.piece_id)}
                    disabled={
                      busyAction === `assign:${piece.piece_id}` ||
                      !eligibleKarigars.length ||
                      !draft.karigar_id
                    }
                  >
                    {busyAction === `assign:${piece.piece_id}`
                      ? "Saving..."
                      : "Assign"}
                  </button>
                </article>
              );
            })}
            {!filteredAssignablePieces.length ? (
              <p className="muted">
                {orderSearchQuery.trim()
                  ? "No assignable work found matching your search."
                  : "No pieces are ready for assignment."}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isMainShopsTab || isSettingsShopsTab ? (
        <section className="panel">
          <h2>Shops</h2>

          {isSettingsShopsTab ? (
            <>
              <div className="split-grid">
                <form className="panel inset" onSubmit={submitShop}>
                  <h3>Add Shop</h3>
                  <p className="muted">
                    Login username will be the same as the shop name.
                  </p>
                  <label>
                    Shop Name
                    <input
                      className="input"
                      value={shopForm.shop_name}
                      onChange={(event) =>
                        setShopForm((current) => ({
                          ...current,
                          shop_name: event.target.value
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Contact
                    <input
                      className="input"
                      value={shopForm.contact}
                      onChange={(event) =>
                        setShopForm((current) => ({
                          ...current,
                          contact: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label>
                    Login Password
                    <input
                      type="password"
                      className="input"
                      value={shopForm.password}
                      onChange={(event) =>
                        setShopForm((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      required
                    />
                  </label>
                  <button className="button" type="submit">
                    Save Shop
                  </button>
                </form>

                <form className="panel inset" onSubmit={submitShopUpdate}>
                  <h3>Edit Shop</h3>
                  <label>
                    Select Shop
                    <select
                      className="input"
                      value={shopEditForm.shop_id}
                      onChange={(event) => {
                        const selected = data.shops.find(
                          (shop) => shop.shop_id === event.target.value
                        );
                        setShopEditForm({
                          shop_id: selected?.shop_id || "",
                          shop_name: selected?.shop_name || "",
                          contact: selected?.contact || "",
                          password: ""
                        });
                      }}
                    >
                      <option value="">Select shop</option>
                      {data.shops.map((shop) => (
                        <option key={shop.shop_id} value={shop.shop_id}>
                          {shop.shop_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Shop Name
                    <input
                      className="input"
                      value={shopEditForm.shop_name}
                      onChange={(event) =>
                        setShopEditForm((current) => ({
                          ...current,
                          shop_name: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label>
                    Contact
                    <input
                      className="input"
                      value={shopEditForm.contact}
                      onChange={(event) =>
                        setShopEditForm((current) => ({
                          ...current,
                          contact: event.target.value
                        }))
                      }
                    />
                  </label>
                  <p className="muted">
                    Login username: {shopUsersByEntityId[shopEditForm.shop_id]?.username || shopEditForm.shop_name || "-"}
                  </p>
                  <label>
                    Reset Password (optional)
                    <input
                      type="password"
                      className="input"
                      value={shopEditForm.password}
                      onChange={(event) =>
                        setShopEditForm((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button className="button" type="submit" disabled={!shopEditForm.shop_id}>
                    Update Shop
                  </button>
                  <button
                    className="button danger ghost"
                    type="button"
                    onClick={handleDeleteShop}
                    disabled={!shopEditForm.shop_id || busyAction === `deleteShop:${shopEditForm.shop_id}`}
                  >
                    {busyAction === `deleteShop:${shopEditForm.shop_id}` ? "Deleting..." : "Delete Shop"}
                  </button>
                </form>
              </div>

              <form className="panel inset" onSubmit={submitShopRate}>
                <h3>Set Shop Rate</h3>
                <div className="form-grid three">
                  <label>
                    Shop
                    <select
                      className="input"
                      value={shopRateForm.shop_id}
                      onChange={(event) =>
                        setShopRateForm((current) => ({
                          ...current,
                          shop_id: event.target.value
                        }))
                      }
                      required
                    >
                      <option value="">Select shop</option>
                      {data.shops.map((shop) => (
                        <option key={shop.shop_id} value={shop.shop_id}>
                          {shop.shop_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Piece Name
                    <select
                      className="input"
                      value={shopRateForm.piece_name}
                      onChange={(event) =>
                        setShopRateForm((current) => ({
                          ...current,
                          piece_name: event.target.value
                        }))
                      }
                    >
                      {PIECE_TYPES.map((pieceType) => (
                        <option key={pieceType} value={pieceType}>
                          {pieceType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Item Type
                    <select
                      className="input"
                      value={shopRateForm.item_type}
                      onChange={(event) =>
                        setShopRateForm((current) => ({
                          ...current,
                          item_type: event.target.value
                        }))
                      }
                    >
                      {ITEM_TYPES.map((itemType) => (
                        <option key={itemType} value={itemType}>
                          {itemType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Rate
                    <input
                      type="number"
                      className="input"
                      min="0"
                      value={shopRateForm.rate}
                      onChange={(event) =>
                        setShopRateForm((current) => ({
                          ...current,
                          rate: event.target.value
                        }))
                      }
                      required
                    />
                  </label>
                </div>
                <button className="button" type="submit">
                  Save Shop Rate
                </button>
              </form>
            </>
          ) : null}

          {isMainShopsTab ? (
          <div className="entity-dashboard">
            <div className="entity-list-panel">
              <h3>Partner Shops</h3>
              <div className="entity-list">
                {data.shops.map((shop) => {
                  const financial = data.computed?.shopFinancials?.[shop.shop_id] || {
                    billed: 0,
                    paid: 0,
                    balance: 0
                  };
                  const isSelected = selectedShop?.shop_id === shop.shop_id;

                  return (
                    <button
                      key={shop.shop_id}
                      type="button"
                      className={isSelected ? "entity-list-row active" : "entity-list-row"}
                      onClick={() => setSelectedShopId(shop.shop_id)}
                    >
                      <span>
                        <strong>{shop.shop_name}</strong>
                        <small>{shop.contact || "No contact"}</small>
                      </span>
                      <span>{formatCurrency(financial.balance)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="entity-detail-panel">
              {selectedShop ? (
                <>
                  <div className="panel-head">
                    <div>
                      <h3>{selectedShop.shop_name}</h3>
                      <p className="muted">{selectedShop.contact || "No contact saved"}</p>
                    </div>
                    <StatusBadge label={`${selectedShopOrders.length} Orders`} tone="in-progress" />
                  </div>
                  <div className="metrics-grid three">
                    <div className="metric-card">
                      <p>Total Billed</p>
                      <h3>{formatCurrency(selectedShopFinancial.billed)}</h3>
                    </div>
                    <div className="metric-card">
                      <p>Total Received</p>
                      <h3>{formatCurrency(selectedShopFinancial.paid)}</h3>
                    </div>
                    <div className="metric-card highlight">
                      <p>Balance</p>
                      <h3>{formatCurrency(selectedShopFinancial.balance)}</h3>
                    </div>
                  </div>

                  <div className="inline-list entity-history">
                    {selectedShopOrders.slice(0, 8).map((order) => (
                      <div className="inline-list-row" key={order.order_id}>
                        <span>
                          <strong>{order.order_number}</strong> - {formatDate(order.delivery_date)}
                        </span>
                        <StatusBadge
                          label={orderBadge(order.status).label}
                          tone={orderBadge(order.status).tone}
                        />
                      </div>
                    ))}
                    {!selectedShopOrders.length ? (
                      <p className="muted">No orders for this shop yet.</p>
                    ) : null}
                  </div>

                  <div className="inline-list entity-history">
                    {selectedShopPayments.slice(0, 5).map((payment) => (
                      <div className="inline-list-row" key={payment.payment_id}>
                        <span>{formatDate(payment.payment_date)}</span>
                        <strong>{formatCurrency(payment.amount)}</strong>
                      </div>
                    ))}
                    {!selectedShopPayments.length ? (
                      <p className="muted">No payment history yet.</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="muted">No shop selected.</p>
              )}
            </div>
          </div>
          ) : null}

          {isSettingsShopsTab ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Contact</th>
                  <th>Total Billed</th>
                  <th>Total Received</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.shops.map((shop) => {
                  const financial = data.computed?.shopFinancials?.[shop.shop_id] || {
                    billed: 0,
                    paid: 0,
                    balance: 0
                  };

                  return (
                    <tr key={shop.shop_id}>
                      <td>{shop.shop_name}</td>
                      <td>{shop.contact || "-"}</td>
                      <td>{formatCurrency(financial.billed)}</td>
                      <td>{formatCurrency(financial.paid)}</td>
                      <td>{formatCurrency(financial.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : null}
        </section>
      ) : null}

      {isMainKarigarTab || isSettingsKarigarTab ? (
        <section className="panel">
          <h2>Karigar</h2>

          {isSettingsKarigarTab ? (
            <>
          <div className="split-grid">
            <form className="panel inset" onSubmit={submitKarigar}>
              <h3>Add Karigar</h3>
              <p className="muted">
                Login username will be the same as the karigar name.
              </p>
              <label>
                Name
                <input
                  className="input"
                  value={karigarForm.name}
                  onChange={(event) =>
                    setKarigarForm((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Contact
                <input
                  className="input"
                  value={karigarForm.contact}
                  onChange={(event) =>
                    setKarigarForm((current) => ({
                      ...current,
                      contact: event.target.value
                    }))
                  }
                />
              </label>
              <div className="field-block">
                <span className="field-label">Role/Specialty</span>
                <div className="role-option-grid">
                  {KARIGAR_ROLE_OPTIONS.map((role) => (
                    <label className="check-tile" key={role.value}>
                      <input
                        type="checkbox"
                        checked={getRoleValues(karigarForm.role).includes(role.value)}
                        onChange={() => toggleKarigarRole("add", role.value)}
                      />
                      <span>{role.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label>
                Login Password
                <input
                  type="password"
                  className="input"
                  value={karigarForm.password}
                  onChange={(event) =>
                    setKarigarForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <button className="button" type="submit">
                Save Karigar
              </button>
            </form>

            <form className="panel inset" onSubmit={submitKarigarUpdate}>
              <h3>Edit Karigar</h3>
              <label>
                Select Karigar
                <select
                  className="input"
                  value={karigarEditForm.karigar_id}
                  onChange={(event) => {
                    const selected = data.karigars.find(
                      (entry) => entry.karigar_id === event.target.value
                    );
                    setKarigarEditForm({
                      karigar_id: selected?.karigar_id || "",
                      name: selected?.name || "",
                      contact: selected?.contact || "",
                      role: selected?.role || selected?.skills || "",
                      password: ""
                    });
                  }}
                >
                  <option value="">Select karigar</option>
                  {data.karigars.map((entry) => (
                    <option key={entry.karigar_id} value={entry.karigar_id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input
                  className="input"
                  value={karigarEditForm.name}
                  onChange={(event) =>
                    setKarigarEditForm((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Contact
                <input
                  className="input"
                  value={karigarEditForm.contact}
                  onChange={(event) =>
                    setKarigarEditForm((current) => ({
                      ...current,
                      contact: event.target.value
                    }))
                  }
                />
              </label>
              <div className="field-block">
                <span className="field-label">Role/Specialty</span>
                <div className="role-option-grid">
                  {KARIGAR_ROLE_OPTIONS.map((role) => (
                    <label className="check-tile" key={role.value}>
                      <input
                        type="checkbox"
                        checked={getRoleValues(karigarEditForm.role).includes(role.value)}
                        onChange={() => toggleKarigarRole("edit", role.value)}
                      />
                      <span>{role.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="muted">
                Login username: {karigarUsersByEntityId[karigarEditForm.karigar_id]?.username || karigarEditForm.name || "-"}
              </p>
              <label>
                Reset Password (optional)
                <input
                  type="password"
                  className="input"
                  value={karigarEditForm.password}
                  onChange={(event) =>
                    setKarigarEditForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                />
              </label>
              <button
                className="button"
                type="submit"
                disabled={!karigarEditForm.karigar_id}
              >
                Update Karigar
              </button>
              <button
                className="button danger ghost"
                type="button"
                onClick={handleDeleteKarigar}
                disabled={
                  !karigarEditForm.karigar_id ||
                  busyAction === `deleteKarigar:${karigarEditForm.karigar_id}`
                }
              >
                {busyAction === `deleteKarigar:${karigarEditForm.karigar_id}`
                  ? "Deleting..."
                  : "Delete Karigar"}
              </button>
            </form>
          </div>

          <form className="panel inset" onSubmit={submitKarigarRate}>
            <h3>Set Karigar Rate</h3>
            <div className="form-grid three">
              <label>
                Karigar
                <select
                  className="input"
                  value={karigarRateForm.karigar_id}
                  onChange={(event) =>
                    setKarigarRateForm((current) => ({
                      ...current,
                      karigar_id: event.target.value
                    }))
                  }
                  required
                >
                  <option value="">Select karigar</option>
                  {data.karigars.map((entry) => (
                    <option key={entry.karigar_id} value={entry.karigar_id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Piece Name
                <select
                  className="input"
                  value={karigarRateForm.piece_name}
                  onChange={(event) =>
                    setKarigarRateForm((current) => ({
                      ...current,
                      piece_name: event.target.value
                    }))
                  }
                >
                  {[...PIECE_TYPES, "inner_waistcoat"].map((pieceType) => (
                    <option key={pieceType} value={pieceType}>
                      {pieceType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Item Type
                <select
                  className="input"
                  value={karigarRateForm.item_type}
                  onChange={(event) =>
                    setKarigarRateForm((current) => ({
                      ...current,
                      item_type: event.target.value
                    }))
                  }
                >
                  {ITEM_TYPES.map((itemType) => (
                    <option key={itemType} value={itemType}>
                      {itemType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rate
                <input
                  type="number"
                  className="input"
                  min="0"
                  value={karigarRateForm.rate}
                  onChange={(event) =>
                    setKarigarRateForm((current) => ({
                      ...current,
                      rate: event.target.value
                    }))
                  }
                  required
                />
              </label>
            </div>
            <button className="button" type="submit">
              Save Karigar Rate
            </button>
          </form>
            </>
          ) : null}

          {isMainKarigarTab ? (
          <div className="entity-dashboard">
            <div className="entity-list-panel">
              <h3>Workers</h3>
              <div className="entity-list">
                {data.karigars.map((karigar) => {
                  const financial = data.computed?.karigarFinancials?.[karigar.karigar_id] || {
                    earned: 0,
                    pending: 0,
                    paid: 0,
                    balance: 0
                  };
                  const isSelected = selectedKarigar?.karigar_id === karigar.karigar_id;

                  return (
                    <button
                      key={karigar.karigar_id}
                      type="button"
                      className={isSelected ? "entity-list-row active" : "entity-list-row"}
                      onClick={() => setSelectedKarigarId(karigar.karigar_id)}
                    >
                      <span>
                        <strong>{karigar.name}</strong>
                        <small>{formatKarigarRoles(karigar.role || karigar.skills)}</small>
                      </span>
                      <span>{formatCurrency(financial.balance)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="entity-detail-panel">
              {selectedKarigar ? (
                <>
                  <div className="panel-head">
                    <div>
                      <h3>{selectedKarigar.name}</h3>
                      <p className="muted">
                        {formatKarigarRoles(selectedKarigar.role || selectedKarigar.skills)}
                      </p>
                    </div>
                    <StatusBadge
                      label={`${selectedKarigarCompletedCount}/${selectedKarigarPieces.length} Done`}
                      tone="ready"
                    />
                  </div>
                  <div className="metrics-grid three">
                    <div className="metric-card">
                      <p>Earned</p>
                      <h3>{formatCurrency(selectedKarigarFinancial.earned)}</h3>
                    </div>
                    <div className="metric-card">
                      <p>Pending Sync</p>
                      <h3>{formatCurrency(selectedKarigarFinancial.pending)}</h3>
                    </div>
                    <div className="metric-card highlight">
                      <p>Balance</p>
                      <h3>{formatCurrency(selectedKarigarFinancial.balance)}</h3>
                    </div>
                  </div>

                  <div className="tab-row wrap compact-tabs">
                    <button
                      type="button"
                      className={karigarProfileTab === "history" ? "tab-button active" : "tab-button"}
                      onClick={() => setKarigarProfileTab("history")}
                    >
                      Work History
                    </button>
                    <button
                      type="button"
                      className={karigarProfileTab === "approved" ? "tab-button active" : "tab-button"}
                      onClick={() => setKarigarProfileTab("approved")}
                    >
                      Approved Work
                    </button>
                  </div>

                  {karigarProfileTab === "history" ? (
                  <div className="inline-list entity-history">
                    {selectedKarigarPieces.slice(0, 10).map((piece) => {
                      const order = ordersById[piece.order_id];
                      const isCuttingCredit = piece.cutting_by === selectedKarigar.karigar_id;
                      const requestBusy = busyAction === `complete:${piece.piece_id}`;
                      return (
                        <div className="inline-list-row" key={`${piece.piece_id}-${isCuttingCredit ? "cut" : "work"}`}>
                          <span>
                            <strong>
                              {isCuttingCredit
                                ? `Cutting: ${piece.bundle_piece_type || piece.piece_name}`
                                : piece.piece_name}
                            </strong>{" "}
                            - Order {order?.order_number || "-"}
                          </span>
                          <span className="piece-row-actions">
                            {!isCuttingCredit && piece.karigar_status === "assigned" ? (
                              <button
                                type="button"
                                className="button small"
                                onClick={() => handleRequestPieceApproval(piece.piece_id)}
                                disabled={requestBusy}
                              >
                                {requestBusy ? "Sending..." : "Request Approval"}
                              </button>
                            ) : null}
                            <StatusBadge
                              label={
                                isCuttingCredit
                                  ? "Cut"
                                  : pieceBadge(piece.karigar_status).label
                              }
                              tone={
                                isCuttingCredit
                                  ? "cutting"
                                  : pieceBadge(piece.karigar_status).tone
                              }
                            />
                          </span>
                        </div>
                      );
                    })}
                    {!selectedKarigarPieces.length ? (
                      <p className="muted">No work history for this karigar yet.</p>
                    ) : null}
                  </div>
                  ) : (
                  <div className="inline-list entity-history">
                    {selectedKarigarApprovedPieces.map((piece) => {
                      const order = ordersById[piece.order_id];
                      const isCuttingCredit = piece.cutting_by === selectedKarigar.karigar_id;
                      return (
                        <div className="inline-list-row" key={`${piece.piece_id}-approved-${isCuttingCredit ? "cut" : "work"}`}>
                          <span>
                            <strong>
                              {isCuttingCredit
                                ? `Cutting: ${piece.bundle_piece_type || piece.piece_name}`
                                : piece.piece_name}
                            </strong>{" "}
                            - Order {order?.order_number || "-"}
                          </span>
                          <StatusBadge label="Approved" tone="ready" />
                        </div>
                      );
                    })}
                    {!selectedKarigarApprovedPieces.length ? (
                      <p className="muted">No approved work yet.</p>
                    ) : null}
                  </div>
                  )}

                  <div className="inline-list entity-history">
                    {selectedKarigarPayments.slice(0, 5).map((payment) => (
                      <div className="inline-list-row" key={payment.payment_id}>
                        <span>{formatDate(payment.payment_date)}</span>
                        <strong>{formatCurrency(payment.amount)}</strong>
                      </div>
                    ))}
                    {!selectedKarigarPayments.length ? (
                      <p className="muted">No payment history yet.</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="muted">No karigar selected.</p>
              )}
            </div>
          </div>
          ) : null}

          {isSettingsKarigarTab ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Total Earned</th>
                  <th>Total Paid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.karigars.map((entry) => {
                  const financial = data.computed?.karigarFinancials?.[entry.karigar_id] || {
                    earned: 0,
                    paid: 0,
                    balance: 0
                  };
                  return (
                    <tr key={entry.karigar_id}>
                      <td>{entry.name}</td>
                      <td>{entry.contact || "-"}</td>
                      <td>{formatKarigarRoles(entry.role || entry.skills)}</td>
                      <td>{formatCurrency(financial.earned)}</td>
                      <td>{formatCurrency(financial.paid)}</td>
                      <td>{formatCurrency(financial.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : null}
        </section>
      ) : null}

      {tab === "payments" ? (
        <section className="panel">
          <h2>Payments</h2>

          <div className="split-grid">
            <form className="panel inset" onSubmit={submitShopPayment}>
              <h3>Record Shop Payment</h3>
              <label>
                Shop
                <select
                  className="input"
                  value={shopPaymentForm.shop_id}
                  onChange={(event) =>
                    setShopPaymentForm((current) => ({
                      ...current,
                      shop_id: event.target.value
                    }))
                  }
                  required
                >
                  <option value="">Select shop</option>
                  {data.shops.map((shop) => (
                    <option key={shop.shop_id} value={shop.shop_id}>
                      {shop.shop_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  type="number"
                  className="input"
                  min="0"
                  value={shopPaymentForm.amount}
                  onChange={(event) =>
                    setShopPaymentForm((current) => ({
                      ...current,
                      amount: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  className="input"
                  value={shopPaymentForm.payment_date}
                  onChange={(event) =>
                    setShopPaymentForm((current) => ({
                      ...current,
                      payment_date: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Note
                <input
                  className="input"
                  value={shopPaymentForm.note}
                  onChange={(event) =>
                    setShopPaymentForm((current) => ({
                      ...current,
                      note: event.target.value
                    }))
                  }
                />
              </label>
              <button className="button" type="submit">
                Save Shop Payment
              </button>
            </form>

            <form className="panel inset" onSubmit={submitKarigarPayment}>
              <h3>Record Karigar Payment</h3>
              <label>
                Karigar
                <select
                  className="input"
                  value={karigarPaymentForm.karigar_id}
                  onChange={(event) =>
                    setKarigarPaymentForm((current) => ({
                      ...current,
                      karigar_id: event.target.value
                    }))
                  }
                  required
                >
                  <option value="">Select karigar</option>
                  {data.karigars.map((entry) => (
                    <option key={entry.karigar_id} value={entry.karigar_id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  type="number"
                  className="input"
                  min="0"
                  value={karigarPaymentForm.amount}
                  onChange={(event) =>
                    setKarigarPaymentForm((current) => ({
                      ...current,
                      amount: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  className="input"
                  value={karigarPaymentForm.payment_date}
                  onChange={(event) =>
                    setKarigarPaymentForm((current) => ({
                      ...current,
                      payment_date: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Note
                <input
                  className="input"
                  value={karigarPaymentForm.note}
                  onChange={(event) =>
                    setKarigarPaymentForm((current) => ({
                      ...current,
                      note: event.target.value
                    }))
                  }
                />
              </label>
              <button className="button" type="submit">
                Save Karigar Payment
              </button>
            </form>
          </div>

          <div className="split-grid">
            <div className="panel inset">
              <h3>Shop Payments History</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Shop</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.paymentsShops]
                      .sort(
                        (a, b) =>
                          new Date(b.payment_date || 0) - new Date(a.payment_date || 0)
                      )
                      .map((payment) => (
                        <tr key={payment.payment_id}>
                          <td>{formatDate(payment.payment_date)}</td>
                          <td>{shopsById[payment.shop_id]?.shop_name || payment.shop_id}</td>
                          <td>{formatCurrency(payment.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel inset">
              <h3>Karigar Payments History</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Karigar</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.paymentsKarigar]
                      .sort(
                        (a, b) =>
                          new Date(b.payment_date || 0) - new Date(a.payment_date || 0)
                      )
                      .map((payment) => (
                        <tr key={payment.payment_id}>
                          <td>{formatDate(payment.payment_date)}</td>
                          <td>
                            {karigarById[payment.karigar_id]?.name || payment.karigar_id}
                          </td>
                          <td>{formatCurrency(payment.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      ) : null}


      {tab === "track" ? (
        <section className="panel">
          <h2>Track & Alerts</h2>

          <div className="split-grid">
            <div className="panel inset">
              <h3>Overdue</h3>
              {trackSummary.overdue.map((order) => {
                const pending = (piecesByOrder[order.order_id] || []).filter(
                  (piece) => !isApprovedPiece(piece)
                );
                return (
                  <div className="track-card" key={`overdue-${order.order_id}`}>
                    <p>
                      <strong>{order.order_number}</strong> - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                    </p>
                    <p className="muted">Delivery: {formatDate(order.delivery_date)}</p>
                    {pending.map((piece) => (
                      <div className="inline-list-row" key={piece.piece_id}>
                        <span>
                          {piece.piece_name} - {karigarById[piece.assigned_karigar_id]?.name || "Not assigned"}
                        </span>
                        <StatusBadge label="Overdue" tone="overdue" />
                      </div>
                    ))}
                  </div>
                );
              })}
              {!trackSummary.overdue.length ? <p className="muted">No overdue orders.</p> : null}
            </div>

            <div className="panel inset">
              <h3>Due Today</h3>
              {trackSummary.dueToday.map((order) => {
                const pending = (piecesByOrder[order.order_id] || []).filter(
                  (piece) => !isApprovedPiece(piece)
                );
                return (
                  <div className="track-card" key={`today-${order.order_id}`}>
                    <p>
                      <strong>{order.order_number}</strong> - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                    </p>
                    <p className="muted">Delivery: {formatDate(order.delivery_date)}</p>
                    {pending.map((piece) => (
                      <div className="inline-list-row" key={piece.piece_id}>
                        <span>{piece.piece_name}</span>
                        <StatusBadge label="Due Today" tone="pending" />
                      </div>
                    ))}
                  </div>
                );
              })}
              {!trackSummary.dueToday.length ? <p className="muted">No orders due today.</p> : null}
            </div>
          </div>

          <div className="split-grid">
            <div className="panel inset">
              <h3>Due Tomorrow</h3>
              {trackSummary.dueTomorrow.map((order) => (
                <div className="track-card" key={`tomorrow-${order.order_id}`}>
                  <p>
                    <strong>{order.order_number}</strong> - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                  </p>
                  <p className="muted">Delivery: {formatDate(order.delivery_date)}</p>
                  <StatusBadge label="Due Tomorrow" tone="in-progress" />
                </div>
              ))}
              {!trackSummary.dueTomorrow.length ? (
                <p className="muted">No high-risk orders for tomorrow.</p>
              ) : null}
            </div>

            <div className="panel inset">
              <h3>Ready Orders</h3>
              {trackSummary.ready.map((order) => (
                <div className="track-card" key={`ready-${order.order_id}`}>
                  <div className="inline-list-row">
                    <p>
                      <strong>{order.order_number}</strong> - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                    </p>
                    <StatusBadge label="Ready" tone="ready" />
                  </div>
                  <button
                    type="button"
                    className="button success small"
                    onClick={() => handleMarkOrderDelivered(order.order_id)}
                    disabled={busyAction === `deliver:${order.order_id}`}
                  >
                    {busyAction === `deliver:${order.order_id}`
                      ? "Delivering..."
                      : "Mark as Delivered"}
                  </button>
                </div>
              ))}
              {!trackSummary.ready.length ? <p className="muted">No ready orders.</p> : null}
            </div>
          </div>

          <div className="panel inset">
            <h3>Karigar Delay Report</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Karigar</th>
                    <th>Assigned Now</th>
                    <th>Avg Assigned Days</th>
                    <th>Completed (7d)</th>
                    <th>Completed (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {karigarDelayRows.map((row) => (
                    <tr key={row.karigar.karigar_id}>
                      <td>{row.karigar.name}</td>
                      <td>{row.assignedNow}</td>
                      <td>{row.averageAssignedDays.toFixed(1)}</td>
                      <td>{row.completedThisWeek}</td>
                      <td>{row.completedThisMonth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel inset">
            <h3>Piece-Level Status View</h3>
            <label>
              Select Order
              <select
                className="input"
                value={selectedTrackOrderId}
                onChange={(event) => setTrackOrderId(event.target.value)}
              >
                {data.orders.map((order) => (
                  <option key={order.order_id} value={order.order_id}>
                    {order.order_number} - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                  </option>
                ))}
              </select>
            </label>

            {selectedTrackOrder ? (
              <div className="track-card">
                <p>
                  <strong>{selectedTrackOrder.order_number}</strong> - {shopsById[selectedTrackOrder.shop_id]?.shop_name || selectedTrackOrder.shop_id}
                </p>
                <p className="muted">Delivery: {formatDate(selectedTrackOrder.delivery_date)}</p>

                {selectedTrackOrder.slip_photo_url ? (
                  <a className="link" href={selectedTrackOrder.slip_photo_url} target="_blank" rel="noreferrer">
                    <img src={selectedTrackOrder.slip_photo_url} alt="Slip" className="slip-thumb" />
                  </a>
                ) : null}

                <div className="inline-list">
                  {selectedTrackPieces.map((piece) => (
                    <div className="inline-list-row" key={piece.piece_id}>
                      <span>
                        {piece.piece_name} - {karigarById[piece.assigned_karigar_id]?.name || "Not assigned"}
                      </span>
                      <div className="inline-controls">
                        <StatusBadge
                          label={pieceBadge(piece.karigar_status).label}
                          tone={pieceBadge(piece.karigar_status).tone}
                        />
                        {piece.completion_photo_url ? (
                          <a
                            className="link"
                            href={piece.completion_photo_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Completion Photo
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted">No order selected.</p>
            )}
          </div>
        </section>
      ) : null}
      {tab === "settings" && settingsTab === "system" ? (
        <section className="panel">
          <h2>System Settings</h2>
          <div className="panel inset">
            <p className="muted">
              Shop aur karigar accounts ab unke apne add/edit forms se manage honge.
              Alag manual user creation hata di gayi hai.
            </p>
          </div>

          <form className="panel inset" onSubmit={submitSetting}>
            <h3>Save Setting</h3>
            <div className="form-grid three">
              <label>
                Key
                <input
                  className="input"
                  value={settingForm.key}
                  onChange={(event) =>
                    setSettingForm((current) => ({ ...current, key: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Value
                <input
                  className="input"
                  value={settingForm.value}
                  onChange={(event) =>
                    setSettingForm((current) => ({ ...current, value: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Description
                <input
                  className="input"
                  value={settingForm.description}
                  onChange={(event) =>
                    setSettingForm((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <button className="button" type="submit">
              Save Setting
            </button>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settings.map((setting) => (
                    <tr key={setting.key}>
                      <td>{setting.key}</td>
                      <td>{setting.value}</td>
                      <td>{setting.description || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel inset warning-box" style={{ marginTop: "1rem" }}>
              <h3>Danger Zone</h3>
              <p className="muted">
                This is hidden under Settings to prevent accidental deletion.
              </p>
              <button
                type="button"
                className="button danger"
                onClick={handleDeleteAllData}
                disabled={busyAction === "clearAllData"}
              >
                {busyAction === "clearAllData" ? "Queueing..." : "Delete All Data"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
