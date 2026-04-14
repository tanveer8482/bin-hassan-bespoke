
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

const PIECE_TYPES = ["coat", "pent", "waistcoat", "suit_2piece", "suit_3piece"];
const ITEM_TYPES = ["normal", "vip", "chapma"];

const TAB_LIST = [
  { key: "dashboard", label: "Dashboard" },
  { key: "orders", label: "Orders" },
  { key: "products", label: "Product Manager" },
  { key: "cutting", label: "Cutting" },
  { key: "assign", label: "Assign Work" },
  { key: "shops", label: "Shops" },
  { key: "karigar", label: "Karigar" },
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
    piece_type: "coat",
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

export function AdminApp({ data, actions, busyAction }) {
  const [tab, setTab] = useState("dashboard");

  const [orderForm, setOrderForm] = useState(emptyOrderForm());
  const [orderFilter, setOrderFilter] = useState({ status: "all", shop_id: "all" });

  const [assignDraft, setAssignDraft] = useState({});

  const [shopForm, setShopForm] = useState({ shop_name: "", contact: "" });
  const [shopEditForm, setShopEditForm] = useState({ shop_id: "", shop_name: "", contact: "" });
  const [shopRateForm, setShopRateForm] = useState({
    shop_id: "",
    piece_name: "coat",
    item_type: "normal",
    rate: ""
  });

  const [karigarForm, setKarigarForm] = useState({ name: "", contact: "" });
  const [karigarEditForm, setKarigarEditForm] = useState({
    karigar_id: "",
    name: "",
    contact: ""
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

  const [userCreateForm, setUserCreateForm] = useState({
    username: "",
    password: "",
    role: "shop",
    display_name: "",
    entity_id: ""
  });
  const [userUpdateForm, setUserUpdateForm] = useState({
    username: "",
    new_username: "",
    password: "",
    role: "",
    display_name: "",
    entity_id: ""
  });

  const [productForm, setProductForm] = useState({ product_name: "", shop_name: "", shop_rate: "" });
  const [subProductForm, setSubProductForm] = useState({ product_id: "", sub_product_name: "", worker_rate: "" });
  const [syncBusy, setSyncBusy] = useState(false);

  const [settingForm, setSettingForm] = useState({ key: "", value: "", description: "" });
  const [trackOrderId, setTrackOrderId] = useState("");

  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);
  const karigarById = useMemo(() => byId(data.karigars, "karigar_id"), [data.karigars]);

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

  const handleShopFilterChange = useCallback((value) => {
    debouncedSetOrderFilter((current) => ({ ...current, shop_id: value }));
  }, [debouncedSetOrderFilter]);

  const handleStatusFilterChange = useCallback((value) => {
    debouncedSetOrderFilter((current) => ({ ...current, status: value }));
  }, [debouncedSetOrderFilter]);

  const filteredOrders = useMemo(() => {
    return data.orders.filter((order) => {
      if (orderFilter.status !== "all" && order.status !== orderFilter.status) return false;
      if (orderFilter.shop_id !== "all" && order.shop_id !== orderFilter.shop_id) return false;
      return true;
    });
  }, [data.orders, orderFilter]);

  const pendingCutPieces = useMemo(() => {
    return data.pieces.filter((piece) => !normalizeBool(piece.cutting_done));
  }, [data.pieces]);

  const assignablePieces = useMemo(() => {
    return data.pieces.filter(
      (piece) =>
        normalizeBool(piece.cutting_done) && piece.karigar_status === "not_assigned"
    );
  }, [data.pieces]);

  const dashboard = data.computed?.dashboard || {
    total_active_orders: 0,
    orders_ready_for_delivery: 0,
    pieces_pending_cutting: 0,
    pieces_assigned_pending_completion: 0,
    overdue_orders: 0
  };

  const dueSummary = filterTodayAndOverdue(data.orders);
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
      const pendingPieces = pieces.filter((piece) => piece.karigar_status !== "complete");

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
          piece.karigar_status !== "complete"
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
          piece.karigar_status === "complete"
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

  const submitOrder = async (event) => {
    event.preventDefault();
    const payload = {
      ...orderForm,
      designing_shop_charge: orderForm.designing_enabled
        ? number(orderForm.designing_shop_charge)
        : 0,
      items: orderForm.items.map((item) => ({
        ...item,
        item_rate: item.item_rate === "" ? undefined : number(item.item_rate)
      }))
    };

    const ok = await actions.createOrder(payload);
    if (ok) {
      setOrderForm(emptyOrderForm());
      setTab("orders");
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
  const markDelivered = async (orderId) => {
    await actions.updateOrder({
      order_id: orderId,
      status: "delivered"
    });
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

  const submitShop = async (event) => {
    event.preventDefault();
    const ok = await actions.createShop(shopForm);
    if (ok) setShopForm({ shop_name: "", contact: "" });
  };

  const submitShopUpdate = async (event) => {
    event.preventDefault();
    const ok = await actions.updateShop(shopEditForm);
    if (ok) {
      setShopEditForm({ shop_id: "", shop_name: "", contact: "" });
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
    const ok = await actions.createKarigar(karigarForm);
    if (ok) setKarigarForm({ name: "", contact: "" });
  };

  const submitKarigarUpdate = async (event) => {
    event.preventDefault();
    const ok = await actions.updateKarigar(karigarEditForm);
    if (ok) {
      setKarigarEditForm({ karigar_id: "", name: "", contact: "" });
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

  const submitUserCreate = async (event) => {
    event.preventDefault();
    const payload = {
      ...userCreateForm,
      entity_id: ["admin", "cutting"].includes(userCreateForm.role) ? "" : userCreateForm.entity_id
    };
    const ok = await actions.createUser(payload);
    if (ok) {
      setUserCreateForm({
        username: "",
        password: "",
        role: "shop",
        display_name: "",
        entity_id: ""
      });
    }
  };

  const submitUserUpdate = async (event) => {
    event.preventDefault();

    const payload = {
      username: userUpdateForm.username
    };

    if (userUpdateForm.new_username) payload.new_username = userUpdateForm.new_username;
    if (userUpdateForm.password) payload.password = userUpdateForm.password;
    if (userUpdateForm.role) payload.role = userUpdateForm.role;
    if (userUpdateForm.display_name) payload.display_name = userUpdateForm.display_name;
    if (userUpdateForm.entity_id) payload.entity_id = userUpdateForm.entity_id;

    const ok = await actions.updateUser(payload);
    if (ok) {
      setUserUpdateForm({
        username: "",
        new_username: "",
        password: "",
        role: "",
        display_name: "",
        entity_id: ""
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

  return (
    <div className="role-shell">
      <div className="tab-row wrap">
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
            <div className="metric-card">
              <p>Active Orders</p>
              <h3>{dashboard.total_active_orders}</h3>
            </div>
            <div className="metric-card">
              <p>Due Today</p>
              <h3>{dueSummary.dueToday.length}</h3>
            </div>
            <div className="metric-card">
              <p>Overdue</p>
              <h3>{dashboard.overdue_orders}</h3>
            </div>
            <div className="metric-card">
              <p>Pending Cutting</p>
              <h3>{dashboard.pieces_pending_cutting}</h3>
            </div>
            <div className="metric-card highlight">
              <p>Ready for Delivery</p>
              <h3>{dashboard.orders_ready_for_delivery}</h3>
            </div>
          </div>

          <div className="panel inset warning-box" style={{ margin: '1rem 0' }}>
             <div className="panel-head">
                <h3>Admin Batch Controls</h3>
                <button 
                  className="button primary" 
                  onClick={handleSyncPayroll}
                  disabled={syncBusy}
                >
                  {syncBusy ? "Syncing..." : "Sync Completed Pieces to Payroll"}
                </button>
             </div>
          </div>

          <div className="split-grid">
            <div className="panel inset">
              <h3>Pending Approvals (QC)</h3>
              {data.pieces.filter(p => p.karigar_status === "pending_approval").map((piece) => (
                <div className="inline-list-row" key={piece.piece_id}>
                  <div>
                    <strong>{piece.piece_name}</strong> - {piece.item_type}
                    <p className="muted">Order: {ordersById[piece.order_id]?.order_number}</p>
                  </div>
                  <button className="button success small" onClick={() => handleApprovePiece(piece.piece_id)}>
                    Approve
                  </button>
                </div>
              ))}
              {!data.pieces.filter(p => p.karigar_status === "pending_approval").length ? (
                <p className="muted">No pieces waiting for approval.</p>
              ) : null}
            </div>

            <div className="panel inset">
              <h3>Due Today</h3>
              {dueSummary.dueToday.map((order) => (
                <div className="inline-list-row" key={order.order_id}>
                  <span>
                    {order.order_number} - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                  </span>
                  <StatusBadge
                    label={orderBadge(order.status).label}
                    tone={orderBadge(order.status).tone}
                  />
                </div>
              ))}
              {!dueSummary.dueToday.length ? (
                <p className="muted">No orders due today.</p>
              ) : null}
            </div>
            <div className="panel inset">
              <h3>Overdue Orders</h3>
              {dueSummary.overdue.map((order) => (
                <div className="inline-list-row" key={order.order_id}>
                  <span>
                    {order.order_number} - {formatDate(order.delivery_date)}
                  </span>
                  <StatusBadge
                    label={orderBadge(order.status).label}
                    tone={orderBadge(order.status).tone}
                  />
                </div>
              ))}
              {!dueSummary.overdue.length ? (
                <p className="muted">No overdue orders.</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "products" ? (
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
                  <input className="input" value={productForm.shop_name} onChange={e => setProductForm({...productForm, shop_name: e.target.value})} required />
                </label>
                <label>Shop Rate
                  <input type="number" className="input" value={productForm.shop_rate} onChange={e => setProductForm({...productForm, shop_rate: e.target.value})} required />
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
                <tr><th>Product</th><th>Shop Rate</th><th>Sub-Products</th></tr>
              </thead>
              <tbody>
                {data.products.map(p => (
                  <tr key={p.product_id}>
                    <td>{p.product_name}</td>
                    <td>{p.shop_rate}</td>
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
                  setOrderForm((current) => ({ ...current, shop_id: event.target.value }))
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
                  required={!orderForm.slip_photo_data_url}
                />
                <span>{orderForm.slip_photo_name || "Upload Measurement Slip Photo"}</span>
              </label>

              {orderForm.slip_photo_data_url ? (
                <img
                  src={orderForm.slip_photo_data_url}
                  alt="Measurement slip"
                  className="slip-thumb large"
                />
              ) : (
                <p className="muted">
                  Slip photo is required. This is used as the verification reference.
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
                  value={item.piece_type}
                  onChange={(event) => updateOrderItem(index, "piece_type", event.target.value)}
                  required
                >
                  <option value="">Select Product Configuration</option>
                  {data.products.map((p) => (
                    <option key={p.product_id} value={p.product_name}>
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

            <div className="cards-grid">
              {filteredOrders.map((order) => {
                const orderPieces = piecesByOrder[order.order_id] || [];
                const orderItems = orderItemsByOrder[order.order_id] || [];
                const completeCount = orderPieces.filter(
                  (piece) => piece.karigar_status === "complete"
                ).length;
                const total = data.computed?.orderTotals?.[order.order_id]?.grand_total || 0;
                const badge = orderBadge(order.status);

                return (
                  <article className="card" key={order.order_id}>
                    <div className="card-head compact">
                      <div>
                        <p className="muted">Order #</p>
                        <h3>{order.order_number}</h3>
                        <p className="muted">
                          {shopsById[order.shop_id]?.shop_name || order.shop_id}
                        </p>
                      </div>
                      <StatusBadge label={badge.label} tone={badge.tone} />
                    </div>

                    <p>Delivery: {formatDate(order.delivery_date)}</p>
                    <p>Total Bill: {formatCurrency(total)}</p>
                    <p className="muted">
                      Items: {orderItems.length} | Completed pieces: {completeCount}/
                      {orderPieces.length}
                    </p>

                    <div className="progress-track">
                      <span
                        style={{
                          width: `${
                            orderPieces.length
                              ? (completeCount / orderPieces.length) * 100
                              : 0
                          }%`
                        }}
                      />
                    </div>

                    {orderPieces.map((piece) => {
                      const pBadge = pieceBadge(piece.karigar_status);
                      return (
                        <div className="inline-list-row" key={piece.piece_id}>
                          <span>
                            {piece.piece_name} - {piece.item_type}
                          </span>
                          <StatusBadge label={pBadge.label} tone={pBadge.tone} />
                        </div>
                      );
                    })}

                    {order.status === "ready" ? (
                      <button
                        className="button"
                        onClick={() => markDelivered(order.order_id)}
                        disabled={busyAction === `deliver:${order.order_id}`}
                      >
                        {busyAction === `deliver:${order.order_id}`
                          ? "Saving..."
                          : "Mark Delivered"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
              {!filteredOrders.length ? <p className="muted">No orders found.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "cutting" ? (
        <section className="panel">
          <h2>Cutting Queue</h2>

          <div className="cards-grid">
            {pendingCutPieces.map((piece) => {
              const order = data.orders.find((entry) => entry.order_id === piece.order_id);

              return (
                <article className="card" key={piece.piece_id}>
                  <p>
                    <strong>{piece.piece_name}</strong> - {piece.item_type}
                  </p>
                  <p className="muted">Order: {order?.order_number || "-"}</p>
                  <p className="muted">
                    Shop: {shopsById[order?.shop_id]?.shop_name || order?.shop_id || "-"}
                  </p>
                  {piece.reference_slip_url ? (
                    <a className="link" href={piece.reference_slip_url} target="_blank" rel="noreferrer">
                      <img src={piece.reference_slip_url} alt="Reference slip" className="slip-thumb" />
                    </a>
                  ) : null}
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
                </article>
              );
            })}
            {!pendingCutPieces.length ? <p className="muted">All pieces are cut.</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "assign" ? (
        <section className="panel">
          <h2>Assign Work</h2>

          <div className="cards-grid">
            {assignablePieces.map((piece) => {
              const draft = assignDraft[piece.piece_id] || {
                karigar_id: "",
                designing_karigar_charge: "0"
              };

              const order = data.orders.find((entry) => entry.order_id === piece.order_id);

              return (
                <article className="card" key={piece.piece_id}>
                  <p>
                    <strong>{piece.piece_name}</strong> - {piece.item_type}
                  </p>
                  <p className="muted">Order: {order?.order_number || "-"}</p>

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
                      {data.karigars.map((karigar) => (
                        <option key={karigar.karigar_id} value={karigar.karigar_id}>
                          {karigar.name}
                        </option>
                      ))}
                    </select>
                  </label>

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
                    disabled={busyAction === `assign:${piece.piece_id}`}
                  >
                    {busyAction === `assign:${piece.piece_id}`
                      ? "Saving..."
                      : "Assign"}
                  </button>
                </article>
              );
            })}
            {!assignablePieces.length ? (
              <p className="muted">No pieces are ready for assignment.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "shops" ? (
        <section className="panel">
          <h2>Shops</h2>

          <div className="split-grid">
            <form className="panel inset" onSubmit={submitShop}>
              <h3>Add Shop</h3>
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
                      contact: selected?.contact || ""
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
              <button className="button" type="submit" disabled={!shopEditForm.shop_id}>
                Update Shop
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
        </section>
      ) : null}

      {tab === "karigar" ? (
        <section className="panel">
          <h2>Karigar</h2>

          <div className="split-grid">
            <form className="panel inset" onSubmit={submitKarigar}>
              <h3>Add Karigar</h3>
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
                      contact: selected?.contact || ""
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
              <button
                className="button"
                type="submit"
                disabled={!karigarEditForm.karigar_id}
              >
                Update Karigar
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

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
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
                      <td>{formatCurrency(financial.earned)}</td>
                      <td>{formatCurrency(financial.paid)}</td>
                      <td>{formatCurrency(financial.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                  (piece) => piece.karigar_status !== "complete"
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
                  (piece) => piece.karigar_status !== "complete"
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
                  <p>
                    <strong>{order.order_number}</strong> - {shopsById[order.shop_id]?.shop_name || order.shop_id}
                  </p>
                  <StatusBadge label="Ready" tone="ready" />
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
      {tab === "settings" ? (
        <section className="panel">
          <h2>Settings & Users</h2>

          <div className="split-grid">
            <form className="panel inset" onSubmit={submitUserCreate}>
              <h3>Create User</h3>
              <label>
                Username
                <input
                  className="input"
                  value={userCreateForm.username}
                  onChange={(event) =>
                    setUserCreateForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  className="input"
                  value={userCreateForm.password}
                  onChange={(event) =>
                    setUserCreateForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Role
                <select
                  className="input"
                  value={userCreateForm.role}
                  onChange={(event) =>
                    setUserCreateForm((current) => ({
                      ...current,
                      role: event.target.value
                    }))
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="karigar">Karigar</option>
                  <option value="shop">Shop</option>
                  <option value="cutting">Cutting Worker</option>
                </select>
              </label>
              <label>
                Display Name
                <input
                  className="input"
                  value={userCreateForm.display_name}
                  onChange={(event) =>
                    setUserCreateForm((current) => ({
                      ...current,
                      display_name: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label>
                Entity ID (shop_id / karigar_id)
                <input
                  className="input"
                  value={userCreateForm.entity_id}
                  onChange={(event) =>
                    setUserCreateForm((current) => ({
                      ...current,
                      entity_id: event.target.value
                    }))
                  }
                  disabled={["admin", "cutting"].includes(userCreateForm.role)}
                />
              </label>
              <button className="button" type="submit">
                Save User
              </button>
            </form>

            <form className="panel inset" onSubmit={submitUserUpdate}>
              <h3>Edit User</h3>
              <label>
                Select User
                <select
                  className="input"
                  value={userUpdateForm.username}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                  required
                >
                  <option value="">Select user</option>
                  {data.users.map((entry) => (
                    <option key={entry.username} value={entry.username}>
                      {entry.username} ({entry.role})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New Username (optional)
                <input
                  className="input"
                  value={userUpdateForm.new_username}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      new_username: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Reset Password (optional)
                <input
                  type="password"
                  className="input"
                  value={userUpdateForm.password}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                New Role (optional)
                <select
                  className="input"
                  value={userUpdateForm.role}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      role: event.target.value
                    }))
                  }
                >
                  <option value="">No change</option>
                  <option value="admin">Admin</option>
                  <option value="karigar">Karigar</option>
                  <option value="shop">Shop</option>
                  <option value="cutting">Cutting Worker</option>
                </select>
              </label>
              <label>
                Display Name (optional)
                <input
                  className="input"
                  value={userUpdateForm.display_name}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      display_name: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Entity ID (optional)
                <input
                  className="input"
                  value={userUpdateForm.entity_id}
                  onChange={(event) =>
                    setUserUpdateForm((current) => ({
                      ...current,
                      entity_id: event.target.value
                    }))
                  }
                />
              </label>
              <button className="button" type="submit">
                Update User
              </button>
            </form>
          </div>

          <div className="panel inset">
            <h3>Current Users</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Display</th>
                    <th>Entity</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((entry) => (
                    <tr key={entry.username}>
                      <td>{entry.username}</td>
                      <td>{entry.role}</td>
                      <td>{entry.display_name || "-"}</td>
                      <td>{entry.entity_id || "-"}</td>
                      <td>
                        {entry.role !== "admin" ? (
                          <button
                            className="button danger ghost small"
                            onClick={() => actions.deleteUser({ username: entry.username })}
                            disabled={busyAction === `deleteUser:${entry.username}`}
                          >
                            Delete
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          </form>
        </section>
      ) : null}
    </div>
  );
}































