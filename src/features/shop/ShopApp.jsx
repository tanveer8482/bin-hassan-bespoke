import { useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import {
  byId,
  formatCurrency,
  formatDate,
  number,
  ORDER_STATUS_META,
  PIECE_STATUS_META
} from "../../lib/format";

function orderBadge(status) {
  return ORDER_STATUS_META[status] || { label: status, tone: "pending" };
}

function pieceBadge(status) {
  return PIECE_STATUS_META[status] || { label: status, tone: "pending" };
}

export function ShopApp({ user, data }) {
  const [tab, setTab] = useState("orders");

  const orders = useMemo(() => {
    return [...data.orders].sort((a, b) => {
      return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
    });
  }, [data.orders]);

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

  const financial = data.computed?.shopFinancials?.[user.entity_id] || {
    billed: 0,
    paid: 0,
    balance: 0
  };

  const karigarById = useMemo(() => byId(data.karigars, "karigar_id"), [data.karigars]);

  return (
    <div className="role-shell">
      <div className="tab-row">
        <button
          className={tab === "orders" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("orders")}
        >
          My Orders
        </button>
        <button
          className={tab === "payments" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("payments")}
        >
          My Payments
        </button>
      </div>

      {tab === "orders" ? (
        <section className="panel">
          <h2>Orders</h2>

          <div className="cards-grid">
            {orders.map((order) => {
              const pieces = piecesByOrder[order.order_id] || [];
              const items = orderItemsByOrder[order.order_id] || [];
              const completeCount = pieces.filter(
                (piece) => piece.karigar_status === "complete"
              ).length;
              const badge = orderBadge(order.status);

              return (
                <article className="card" key={order.order_id}>
                  <div className="card-head compact">
                    <div>
                      <p className="muted">Order #</p>
                      <h3>{order.order_number}</h3>
                    </div>
                    <StatusBadge label={badge.label} tone={badge.tone} />
                  </div>

                  <p>Delivery: {formatDate(order.delivery_date)}</p>
                  <p className="muted">
                    Items: {items.length} | Pieces complete: {completeCount}/{pieces.length}
                  </p>

                  <div className="progress-track" aria-label="order progress">
                    <span
                      style={{
                        width: `${pieces.length ? (completeCount / pieces.length) * 100 : 0}%`
                      }}
                    />
                  </div>

                  <div className="inline-list">
                    {pieces.map((piece) => {
                      const pieceMeta = pieceBadge(piece.karigar_status);
                      const karigarName = karigarById[piece.assigned_karigar_id]?.name;

                      return (
                        <div className="inline-list-row" key={piece.piece_id}>
                          <div>
                            <strong>{piece.piece_name}</strong> - {piece.item_type}
                            {karigarName ? (
                              <span className="muted"> by {karigarName}</span>
                            ) : null}
                          </div>
                          <StatusBadge label={pieceMeta.label} tone={pieceMeta.tone} />
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            {!orders.length ? <p className="muted">No orders found.</p> : null}
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>Payment Summary</h2>

          <div className="metrics-grid three">
            <div className="metric-card">
              <p>Total Billed</p>
              <h3>{formatCurrency(financial.billed)}</h3>
            </div>
            <div className="metric-card">
              <p>Total Paid</p>
              <h3>{formatCurrency(financial.paid)}</h3>
            </div>
            <div className="metric-card highlight">
              <p>Pending Balance</p>
              <h3>{formatCurrency(financial.balance)}</h3>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {[...data.paymentsShops]
                  .sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0))
                  .map((payment) => (
                    <tr key={payment.payment_id}>
                      <td>{formatDate(payment.payment_date)}</td>
                      <td>{formatCurrency(number(payment.amount))}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                {!data.paymentsShops.length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No payment records yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
