import { useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import {
  byId,
  formatCurrency,
  formatDate,
  number,
  PIECE_STATUS_META
} from "../../lib/format";

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

export function KarigarApp({ user, data, onCompletePiece, busyAction }) {
  const [tab, setTab] = useState("work");
  const [filter, setFilter] = useState("pending");
  const [uploadError, setUploadError] = useState("");

  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);
  const ordersById = useMemo(() => byId(data.orders, "order_id"), [data.orders]);

  const pieces = useMemo(() => {
    const sorted = [...data.pieces].sort((a, b) => {
      return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });

    if (filter === "all") return sorted;
    if (filter === "complete") {
      return sorted.filter((piece) => piece.karigar_status === "complete");
    }
    return sorted.filter((piece) => piece.karigar_status !== "complete");
  }, [data.pieces, filter]);

  const paymentSummary = data.computed?.karigarFinancials?.[user.entity_id] || {
    earned: 0,
    paid: 0,
    balance: 0
  };

  const submitCompletionPhoto = async (pieceId, file) => {
    if (!file) return;

    setUploadError("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onCompletePiece({
        piece_id: pieceId,
        photo_data_url: dataUrl
      });
    } catch (error) {
      setUploadError(error.message || "Upload failed");
    }
  };

  return (
    <div className="role-shell">
      <div className="tab-row">
        <button
          className={tab === "work" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("work")}
        >
          My Work
        </button>
        <button
          className={tab === "payments" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("payments")}
        >
          My Payments
        </button>
      </div>

      {tab === "work" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Assigned Pieces</h2>
            <select
              className="input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="complete">Completed</option>
              <option value="all">All</option>
            </select>
          </div>

          {uploadError ? <div className="alert error">{uploadError}</div> : null}

          <div className="cards-grid">
            {pieces.map((piece) => {
              const order = ordersById[piece.order_id];
              const shop = shopsById[order?.shop_id] || {};
              const badge = pieceBadge(piece.karigar_status);

              return (
                <article className="card" key={piece.piece_id}>
                  <div className="card-head compact">
                    <div>
                      <p className="muted">Order</p>
                      <h3>{order?.order_number || "-"}</h3>
                    </div>
                    <StatusBadge label={badge.label} tone={badge.tone} />
                  </div>

                  <p>
                    <strong>{piece.piece_name}</strong> - {piece.item_type}
                  </p>
                  <p className="muted">Shop: {shop.shop_name || "-"}</p>
                  <p className="muted">Delivery: {formatDate(order?.delivery_date)}</p>

                  {piece.reference_slip_url ? (
                    <a
                      className="link"
                      href={piece.reference_slip_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={piece.reference_slip_url}
                        alt="Reference slip"
                        className="slip-thumb"
                      />
                    </a>
                  ) : (
                    <p className="muted">Reference slip not available</p>
                  )}

                  {piece.karigar_status !== "complete" ? (
                    <label className="file-upload">
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(event) =>
                          submitCompletionPhoto(piece.piece_id, event.target.files?.[0])
                        }
                        disabled={busyAction === `complete:${piece.piece_id}`}
                      />
                      <span>
                        {busyAction === `complete:${piece.piece_id}`
                          ? "Uploading..."
                          : "Upload Completion Photo"}
                      </span>
                    </label>
                  ) : piece.completion_photo_url ? (
                    <a
                      className="link"
                      href={piece.completion_photo_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Completion Photo
                    </a>
                  ) : (
                    <p className="muted">Completion photo unavailable</p>
                  )}
                </article>
              );
            })}
            {!pieces.length ? <p className="muted">No pieces found for this filter.</p> : null}
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>Payment Summary</h2>
          <div className="metrics-grid three">
            <div className="metric-card">
              <p>Total Earned</p>
              <h3>{formatCurrency(paymentSummary.earned)}</h3>
            </div>
            <div className="metric-card">
              <p>Total Received</p>
              <h3>{formatCurrency(paymentSummary.paid)}</h3>
            </div>
            <div className="metric-card highlight">
              <p>Pending Balance</p>
              <h3>{formatCurrency(paymentSummary.balance)}</h3>
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
                {[...data.paymentsKarigar]
                  .sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0))
                  .map((payment) => (
                    <tr key={payment.payment_id}>
                      <td>{formatDate(payment.payment_date)}</td>
                      <td>{formatCurrency(number(payment.amount))}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                {!data.paymentsKarigar.length ? (
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
}


