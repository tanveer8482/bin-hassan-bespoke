import { useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import {
  byId,
  formatCurrency,
  formatDate,
  number,
  PIECE_STATUS_META
} from "../../lib/format";
import { preparePhotoPayloadForApi } from "../../lib/api";
import { generateKarigarLedgerPdf } from "../../lib/pdfReport";

function pieceBadge(status) {
  return PIECE_STATUS_META[status] || { label: status, tone: "pending" };
}

export function KarigarApp({ user, data, onCompletePiece, busyAction }) {
  const [tab, setTab] = useState("work");
  const [filter, setFilter] = useState("pending");
  const [uploadError, setUploadError] = useState("");

  const shops = Array.isArray(data?.shops) ? data.shops : [];
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const paymentsKarigar = Array.isArray(data?.paymentsKarigar) ? data.paymentsKarigar : [];
  const visiblePieces = Array.isArray(data?.pieces)
    ? data.pieces.filter((piece) => piece.assigned_karigar_id === user.entity_id)
    : [];

  const shopsById = useMemo(() => byId(shops, "shop_id"), [shops]);
  const ordersById = useMemo(() => byId(orders, "order_id"), [orders]);

  const pieces = useMemo(() => {
    const sorted = [...visiblePieces].sort((a, b) => {
      return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });

    if (filter === "all") return sorted;
    if (filter === "complete") {
      return sorted.filter(
        (piece) =>
          piece.karigar_status === "complete" || piece.karigar_status === "pending_approval"
      );
    }
    return sorted.filter(
      (piece) =>
        piece.karigar_status !== "complete" && piece.karigar_status !== "pending_approval"
    );
  }, [visiblePieces, filter]);

  const paymentSummary = data.computed?.karigarFinancials?.[user.entity_id] || {
    earned: 0,
    paid: 0,
    balance: 0
  };

  const submitCompletionPhoto = async (pieceId, file) => {
    if (!file) return;

    setUploadError("");

    try {
      const { payload, meta } = await preparePhotoPayloadForApi(file, {
        folder: "bin-hassan-bespoke/completion"
      });

      console.log(
        "[WORKER_UPLOAD]",
        JSON.stringify({
          pieceId,
          uploadMode: meta.uploadMode,
          compressedBytes: meta.compressedBytes
        })
      );

      await onCompletePiece({
        piece_id: pieceId,
        ...payload
      });
    } catch (error) {
      if (/too large/i.test(error.message || "")) {
        window.alert(error.message);
      }
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
        <button
          className={tab === "ledger" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("ledger")}
        >
          My Ledger
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

                  {piece.karigar_status === "assigned" ? (
                    <div className="button-group-vertical">
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
                            : "Request Approval (With Photo)"}
                        </span>
                      </label>

                      <button 
                        className="button secondary small"
                        onClick={() => onCompletePiece({ piece_id: piece.piece_id })}
                        disabled={busyAction === `complete:${piece.piece_id}`}
                        style={{marginTop: '0.5rem'}}
                      >
                        Request Approval (No Photo)
                      </button>
                    </div>
                  ) : piece.karigar_status === "pending_approval" ? (
                    <div className="alert highlight">
                      Waiting for Admin Approval
                    </div>
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
        </section>
      ) : tab === "payments" ? (
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
                {[...paymentsKarigar]
                  .sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0))
                  .map((payment) => (
                    <tr key={payment.payment_id}>
                      <td>{formatDate(payment.payment_date)}</td>
                      <td>{formatCurrency(number(payment.amount))}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                {!paymentsKarigar.length ? (
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
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>Detailed Financial Ledger</h2>
            <button 
              className="button success"
              onClick={() => generateKarigarLedgerPdf(
                { name: user.display_name },
                visiblePieces,
                paymentsKarigar
              )}
            >
              Download My Ledger (PDF)
            </button>
          </div>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            This report includes all your earnings from synced pieces and your payout history.
          </p>
          <div className="metrics-grid three">
            <div className="metric-card">
              <p>Total Life-time Earned</p>
              <h3>{formatCurrency(paymentSummary.earned)}</h3>
            </div>
            <div className="metric-card">
              <p>Total Life-time Received</p>
              <h3>{formatCurrency(paymentSummary.paid)}</h3>
            </div>
            <div className="metric-card highlight">
              <p>Current Balance</p>
              <h3>{formatCurrency(paymentSummary.balance)}</h3>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
