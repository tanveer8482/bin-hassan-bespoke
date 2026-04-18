import { useMemo, useState } from "react";
import { byId, formatDate, normalizeBool } from "../../lib/format";
import { preparePhotoPayloadForApi } from "../../lib/api";

export function CuttingApp({ data, onUploadCuttingPhoto, busyAction }) {
  const [uploadError, setUploadError] = useState("");

  const ordersById = useMemo(() => byId(data.orders, "order_id"), [data.orders]);
  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);

  const pendingPieces = useMemo(() => {
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
  }, [data.pieces]);

  const handleFileChange = async (pieceId, file) => {
    if (!file) return;

    setUploadError("");

    try {
      const { payload, meta } = await preparePhotoPayloadForApi(file, {
        folder: "bin-hassan-bespoke/cutting"
      });

      console.log(
        "[CUTTING_UPLOAD]",
        JSON.stringify({
          pieceId,
          uploadMode: meta.uploadMode,
          compressedBytes: meta.compressedBytes
        })
      );

      await onUploadCuttingPhoto({
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
      <section className="panel">
        <h2>Cutting Queue</h2>
        <p className="muted">
          Upload photo showing fabric + reference slip to auto-verify cutting.
        </p>

        {uploadError ? <div className="alert error">{uploadError}</div> : null}

        <div className="cards-grid">
          {pendingPieces.map((piece) => {
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
                  <p className="muted">Cutting Rate: {piece.cutting_credit_amount || 0}</p>
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
                            handleFileChange(piece.piece_id, event.target.files?.[0])
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
                        onClick={() => onUploadCuttingPhoto({ piece_id: piece.piece_id })}
                        disabled={busyAction === `cut:${piece.piece_id}`}
                        style={{ marginTop: "0.5rem" }}
                      >
                        Mark Cut (No Photo)
                      </button>
                    </>
                  ) : (
                    <button
                      className="button primary small"
                      onClick={() => onUploadCuttingPhoto({ piece_id: piece.piece_id })}
                      disabled={busyAction === `cut:${piece.piece_id}`}
                    >
                      Mark Cut
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {!pendingPieces.length ? (
            <p className="muted">No pending cutting pieces right now.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
