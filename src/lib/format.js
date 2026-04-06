export function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function byId(records, idField) {
  return records.reduce((map, record) => {
    map[record[idField]] = record;
    return map;
  }, {});
}

export function normalizeBool(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const ORDER_STATUS_META = {
  pending: { label: "Pending", tone: "pending" },
  cutting: { label: "Cutting", tone: "cutting" },
  in_progress: { label: "In Progress", tone: "in-progress" },
  ready: { label: "Ready", tone: "ready" },
  delivered: { label: "Delivered", tone: "delivered" }
};

export const PIECE_STATUS_META = {
  not_assigned: { label: "Pending", tone: "pending" },
  assigned: { label: "Assigned", tone: "in-progress" },
  complete: { label: "Complete", tone: "ready" }
};

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function filterTodayAndOverdue(orders) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const dueToday = [];
  const overdue = [];

  orders.forEach((order) => {
    const delivery = new Date(order.delivery_date);
    if (Number.isNaN(delivery.getTime())) return;

    if (delivery >= todayStart && delivery < tomorrowStart) {
      dueToday.push(order);
      return;
    }

    if (delivery < todayStart && order.status !== "delivered") {
      overdue.push(order);
    }
  });

  return {
    dueToday,
    overdue
  };
}
