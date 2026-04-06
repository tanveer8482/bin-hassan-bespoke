const { ROLES, SHEETS } = require("./_lib/constants");
const { refreshOrderStatuses } = require("./_lib/domain");
const { requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { resolvePhotoInput } = require("./_lib/media");
const { verifyPhotoAgainstOrderNumber } = require("./_lib/vision");
const { ensureWorkbook, getRecords, updateByField } = require("./_lib/sheets");
const {
  boolToCell,
  nowISO,
  parseBody,
  parseBoolean,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["POST"]);
  const user = requireRole(req, [ROLES.ADMIN, ROLES.CUTTING]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["piece_id"]);

  const [pieces, orders] = await Promise.all([
    getRecords(SHEETS.PIECES),
    getRecords(SHEETS.ORDERS)
  ]);

  const piece = pieces.find((record) => record.piece_id === body.piece_id);
  if (!piece) {
    const error = new Error("Piece not found");
    error.statusCode = 404;
    throw error;
  }

  const order = orders.find((record) => record.order_id === piece.order_id);
  if (!order) {
    const error = new Error("Order not found for selected piece");
    error.statusCode = 404;
    throw error;
  }

  const { photoUrl, photoBase64 } = await resolvePhotoInput({
    photoUrl: body.photo_url,
    photoDataUrl: body.photo_data_url,
    folder: "bin-hassan/cutting"
  });

  await verifyPhotoAgainstOrderNumber({
    orderNumber: order.order_number,
    photoUrl,
    photoBase64,
    mismatchMessage: "Wrong order slip shown",
    noTextMessage:
      "Slip not visible or wrong order. Please retake photo showing the correct slip clearly."
  });

  const now = nowISO();

  const updated = await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, {
    cutting_done: boolToCell(true),
    cutting_by: body.cutting_by || user.display_name || user.username,
    cutting_date: now,
    cutting_photo_url: photoUrl,
    cutting_verified: boolToCell(true),
    cutting_verified_date: now,
    updated_date: now
  });

  await refreshOrderStatuses([updated.order_id]);

  sendOk(res, {
    message: parseBoolean(piece.cutting_done)
      ? "Cutting photo re-verified"
      : "Cutting verified successfully",
    piece: stripMeta(updated)
  });
<<<<<<< HEAD
});
=======
});
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
