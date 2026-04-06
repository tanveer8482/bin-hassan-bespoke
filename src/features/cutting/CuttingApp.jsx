import { useMemo, useState } from "react";
import { byId, formatDate } from "../../lib/format";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

export function CuttingApp({ data, onUploadCuttingPhoto, busyAction }) {
  const [uploadError, setUploadError] = useState("");

  const ordersById = useMemo(() => byId(data.orders, "order_id"), [data.orders]);
  const shopsById = useMemo(() => byId(data.shops, "shop_id"), [data.shops]);

  const pendingPieces = useMemo(() => {
    return data.pieces.filter((piece) => String(piece.cutting_done) !== "true");
  }, [data.pieces]);

  const handleFileChange = async (pieceId, file) => {
    if (!file) return;

    setUploadError("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onUploadCuttingPhoto({
        piece_id: pieceId,
        photo_data_url: dataUrl
      });
    } catch (error) {
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
<<<<<<< HEAD
}
=======
}
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
