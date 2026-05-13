import { useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { SearchBar } from "../../components/SearchBar";
import {
  byId,
  formatCurrency,
  formatDate,
  normalizeBool,
  number,
  PIECE_STATUS_META
} from "../../lib/format";
import { preparePhotoPayloadForApi } from "../../lib/api";
import { generateKarigarLedgerPdf } from "../../lib/pdfReport";

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

function hasRole(worker, role) {
  return new Set([...getRoleValues(worker?.role), ...getRoleValues(worker?.skills)]).has(role);
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesKarigarUser(karigar, user) {
  const userKeys = new Set(
    [user?.entity_id, user?.username, user?.display_name]
      .map(normalizeIdentity)
      .filter(Boolean)
  );
  return [karigar?.karigar_id, karigar?.name]
    .map(normalizeIdentity)
    .filter(Boolean)
    .some((value) => userKeys.has(value));
}

function isApprovedPieceStatus(status) {
  const normalized = normalizeRoleValue(status);
  return normalized === "complete" || normalized === "approved";
}

export function KarigarApp({ user, data, onCompletePiece, onMarkPieceCut, busyAction }) {
  const [tab, setTab] = useState("work");
  const [filter, setFilter] = useState("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [cuttingSearchQuery, setCuttingSearchQuery] = useState("");
  const [uploadError, setUploadError] = useState("");

  const shops = Array.isArray(data?.shops) ? data.shops : [];
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const karigars = Array.isArray(data?.karigars) ? data.karigars : [];
  const paymentsKarigar = Array.isArray(data?.paymentsKarigar) ? data.paymentsKarigar : [];
  const currentKarigar = karigars.find((karigar) => matchesKarigarUser(karigar, user));
  const currentKarigarId = user.entity_id || currentKarigar?.karigar_id || "";
  const visiblePieces = Array.isArray(data?.pieces)
    ? data.pieces.filter((piece) => piece.assigned_karigar_id === currentKarigarId)
    : [];

  const shopsById = useMemo(() => byId(shops, "shop_id"), [shops]);
  const ordersById = useMemo(() => byId(orders, "order_id"), [orders]);
  const canHandleCutting = hasRole(currentKarigar, "cutting_master");

  const pieces = useMemo(() => {
    const sorted = [...visiblePieces].sort((a, b) => {
      return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });

    if (filter === "all") return sorted;
    if (filter === "complete") {
      return sorted.filter(
        (piece) =>
          isApprovedPieceStatus(piece.karigar_status) ||
          piece.karigar_status === "pending_approval"
      );
    }
    return sorted.filter(
      (piece) =>
        !isApprovedPieceStatus(piece.karigar_status) &&
        piece.karigar_status !== "pending_approval"
    );
  }, [visiblePieces, filter]);

  const approvedPieces = useMemo(() => {
    return [...visiblePieces]
      .filter((piece) => isApprovedPieceStatus(piece.karigar_status))
      .sort(
        (a, b) =>
          new Date(b.karigar_complete_date || b.updated_date || 0) -
          new Date(a.karigar_complete_date || a.updated_date || 0)
      );
  }, [visiblePieces]);

  const filteredPieces = useMemo(() => {
    if (!searchQuery.trim()) return pieces;
    const query = searchQuery.toLowerCase();
    return pieces.filter((piece) => {
      const order = ordersById[piece.order_id];
      const orderNumber = order?.order_number?.toString().toLowerCase() || "";
      return orderNumber.includes(query);
    });
  }, [pieces, searchQuery, ordersById]);

  const paymentSummary = data.computed?.karigarFinancials?.[currentKarigarId] || {
    earned: 0,
    pending: 0,
    paid: 0,
    balance: 0
  };

  const cuttingPieces = useMemo(() => {
    if (!canHandleCutting || !Array.isArray(data?.pieces)) return [];
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
      const entry = grouped.get(key);
      entry._pendingCount += 1;
      if (!entry.reference_slip_url && piece.reference_slip_url) {
        entry.reference_slip_url = piece.reference_slip_url;
      }
    });

    return Array.from(grouped.values());
  }, [canHandleCutting, data?.pieces]);

  const cuttingLedgerPieces = useMemo(() => {
    if (!canHandleCutting || !Array.isArray(data?.pieces)) return [];
    return data.pieces
      .filter((piece) => piece.cutting_by === currentKarigarId)
      .map((piece) => ({
        ...piece,
        assigned_karigar_id: currentKarigarId,
        piece_name: `Cutting: ${piece.bundle_piece_type || piece.piece_name}`,
        karigar_rate: piece.cutting_credit_amount,
        karigar_status: normalizeBool(piece.cutting_done) ? "complete" : "assigned"
      }));
  }, [canHandleCutting, currentKarigarId, data?.pieces]);

  const ledgerPieces = useMemo(() => {
    const cuttingIds = new Set(cuttingLedgerPieces.map((piece) => `${piece.piece_id}:cutting`));
    const cuttingRows = cuttingLedgerPieces.map((piece) => ({
      ...piece,
      piece_id: `${piece.piece_id}:cutting`
    }));
    return [
      ...visiblePieces.filter((piece) => !cuttingIds.has(piece.piece_id)),
      ...cuttingRows
    ];
  }, [visiblePieces, cuttingLedgerPieces]);

  const filteredCuttingPieces = useMemo(() => {
    if (!cuttingSearchQuery.trim()) return cuttingPieces;
    const query = cuttingSearchQuery.toLowerCase();
    return cuttingPieces.filter((piece) => {
      const order = ordersById[piece.order_id];
      const orderNumber = order?.order_number?.toString().toLowerCase() || "";
      const shopName = shopsById[order?.shop_id]?.shop_name?.toLowerCase() || "";
      return orderNumber.includes(query) || shopName.includes(query);
    });
  }, [cuttingPieces, cuttingSearchQuery, ordersById, shopsById]);

  const requestCompletion = async (pieceId, extraPayload = {}) => {
    setUploadError("");
    try {
      const ok = await onCompletePiece({
        piece_id: pieceId,
        karigar_id: currentKarigarId,
        ...extraPayload
      });
      if (ok === false) setUploadError("Completion request could not be queued.");
    } catch (error) {
      setUploadError(error.message || "Completion request failed");
    }
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

      await requestCompletion(pieceId, payload);
    } catch (error) {
      if (/too large/i.test(error.message || "")) {
        window.alert(error.message);
      }
      setUploadError(error.message || "Upload failed");
    }
  };

  const submitCuttingPhoto = async (pieceId, file) => {
    if (!file) return;

    setUploadError("");

    try {
      const { payload, meta } = await preparePhotoPayloadForApi(file, {
        folder: "bin-hassan-bespoke/cutting"
      });

      console.log(
        "[CUTTING_MASTER_UPLOAD]",
        JSON.stringify({
          pieceId,
          uploadMode: meta.uploadMode,
          compressedBytes: meta.compressedBytes
        })
      );

      await onMarkPieceCut({
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
          className={tab === "approved" ? "tab-button active" : "tab-button"}
          onClick={() => setTab("approved")}
        >
          Approved Work
        </button>
        {canHandleCutting ? (
          <button
            className={tab === "cutting" ? "tab-button active" : "tab-button"}
            onClick={() => setTab("cutting")}
          >
            Cutting Queue
          </button>
        ) : null}
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
            <div className="inline-controls">
              <SearchBar 
                value={searchQuery} 
                onChange={setSearchQuery}
                placeholder="Search by order number..."
              />
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
          </div>

          {uploadError ? <div className="alert error">{uploadError}</div> : null}

          <div className="cards-grid">
            {filteredPieces.map((piece) => {
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
                        onClick={() => requestCompletion(piece.piece_id)}
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
            {!filteredPieces.length ? (
              <p className="muted">
                {searchQuery
                  ? "No pieces found matching your search."
                  : "No pieces found for this filter."}
              </p>
            ) : null}
          </div>
        </section>
      ) : tab === "approved" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Approved Work</h2>
            <StatusBadge label={`${approvedPieces.length} Approved`} tone="ready" />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order Number</th>
                  <th>Piece Type</th>
                  <th>Payment Amount</th>
                </tr>
              </thead>
              <tbody>
                {approvedPieces.map((piece) => {
                  const order = ordersById[piece.order_id];
                  const paymentAmount =
                    number(piece.karigar_rate) + number(piece.designing_karigar_charge);
                  return (
                    <tr key={piece.piece_id}>
                      <td>{order?.order_number || "-"}</td>
                      <td>{piece.piece_name || piece.sub_product_name || "-"}</td>
                      <td>{formatCurrency(paymentAmount)}</td>
                    </tr>
                  );
                })}
                {!approvedPieces.length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No approved work yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "cutting" && canHandleCutting ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Cutting Queue</h2>
            </div>
            <SearchBar
              value={cuttingSearchQuery}
              onChange={setCuttingSearchQuery}
              placeholder="Search order or shop..."
            />
          </div>

          {uploadError ? <div className="alert error">{uploadError}</div> : null}

          <div className="cards-grid">
            {filteredCuttingPieces.map((piece) => {
              const order = ordersById[piece.order_id] || {};
              const shop = shopsById[order.shop_id] || {};
              const displayName = piece.bundle_piece_type || piece.piece_name;

              return (
                <article className="card" key={piece.piece_id}>
                  <div>
                    <p className="muted">Order #{order.order_number || "-"}</p>
                    <h3>{displayName}</h3>
                    <p className="muted">
                      {piece.item_type} | {shop.shop_name || order.shop_id || "-"}
                    </p>
                    {piece._pendingCount > 1 ? (
                      <p className="muted">Includes {piece._pendingCount} sub-products</p>
                    ) : null}
                    <p className="muted">Cutting Rate: {formatCurrency(piece.cutting_credit_amount)}</p>
                    <p className="muted">Delivery: {formatDate(order.delivery_date)}</p>
                  </div>

                  {piece.reference_slip_url ? (
                    <a href={piece.reference_slip_url} target="_blank" rel="noreferrer">
                      <img
                        src={piece.reference_slip_url}
                        alt="Reference slip"
                        className="slip-thumb"
                      />
                    </a>
                  ) : (
                    <p className="muted">Reference slip not available</p>
                  )}

                  <div className="button-group-vertical">
                    {piece.reference_slip_url ? (
                      <>
                        <label className="file-upload">
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) =>
                              submitCuttingPhoto(piece.piece_id, event.target.files?.[0])
                            }
                            disabled={busyAction === `cut:${piece.piece_id}`}
                          />
                          <span>
                            {busyAction === `cut:${piece.piece_id}`
                              ? "Uploading..."
                              : "Upload Cutting Photo"}
                          </span>
                        </label>

                        <button
                          className="button secondary small"
                          onClick={() => onMarkPieceCut({ piece_id: piece.piece_id })}
                          disabled={busyAction === `cut:${piece.piece_id}`}
                          style={{ marginTop: "0.5rem" }}
                        >
                          Mark Cut (No Photo)
                        </button>
                      </>
                    ) : (
                      <button
                        className="button primary small"
                        onClick={() => onMarkPieceCut({ piece_id: piece.piece_id })}
                        disabled={busyAction === `cut:${piece.piece_id}`}
                      >
                        Mark Cut
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {!filteredCuttingPieces.length ? (
              <p className="muted">
                {cuttingSearchQuery
                  ? "No cutting work found matching your search."
                  : "No pending cutting pieces right now."}
              </p>
            ) : null}
          </div>
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
      ) : tab === "ledger" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Financial Ledger</h2>
            <button 
              className="button primary"
              onClick={() => {
                console.log("[KARIGAR_LEDGER_CLICK]", { user, pieceCount: ledgerPieces.length });
                generateKarigarLedgerPdf(
                  currentKarigar || user,
                  ledgerPieces,
                  paymentsKarigar,
                  paymentSummary,
                  ordersById
                );
              }}
            >
              Download My Ledger (PDF)
            </button>
          </div>
          <p className="muted" style={{marginBottom: '1rem'}}>
            This report includes your complete work history and payment records.
          </p>
          <div className="metrics-grid three">
            <div className="metric-card">
              <p>Earned</p>
              <h3>{formatCurrency(paymentSummary.earned)}</h3>
            </div>
            <div className="metric-card">
              <p>Paid</p>
              <h3>{formatCurrency(paymentSummary.paid)}</h3>
            </div>
            <div className="metric-card highlight">
              <p>Balance</p>
              <h3>{formatCurrency(paymentSummary.balance)}</h3>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
