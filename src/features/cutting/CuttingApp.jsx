import { useMemo, useState } from "react";
import { byId, formatDate } from "../../lib/format";
import { preparePhotoPayloadForApi } from "../../lib/api";

export function CuttingApp({ data, onUploadCuttingPhoto, busyAction }) {
  const [uploadError, setUploadError] = useState("");
  // #region agent log
  fetch('http://127.0.0.1:7303/ingest/470ad46e-749f-4aff-a2a7-ed436dce2a04',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'672361'},body:JSON.stringify({sessionId:'672361',runId:'pre-fix',hypothesisId:'H6',location:'src/features/cutting/CuttingApp.jsx:8',message:'CuttingApp rendered',data:{piecesCount:Array.isArray(data?.pieces)?data.pieces.length:0,busyAction:busyAction||''},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const ordersById = useMemo(() => byId(data.orders, "order_id"), [data.orders]);
  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);

  const pendingPieces = useMemo(() => {
    return data.pieces.filter((piece) => String(piece.cutting_done) !== "true");
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

            return (
              <article className="card" key={piece.piece_id}>
                <div>
                  <p className="muted">Order #{order.order_number || "-"}</p>
                  <h3>{piece.piece_name}</h3>
                  <p className="muted">
                    {piece.item_type} | {shop.shop_name || order.shop_id || "-"}
                  </p>
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
                    style={{marginTop: '0.5rem'}}
                  >
                    Mark Cut (No Photo)
                  </button>
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
