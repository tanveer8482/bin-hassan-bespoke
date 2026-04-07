const { ROLES, SHEETS, STATUS } = require("./_lib/constants");
const { refreshOrderStatuses } = require("./_lib/domain");
const { requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { resolvePhotoInput } = require("./_lib/media");
const { verifyPhotoAgainstOrderNumber } = require("./_lib/vision");
const { ensureWorkbook, getRecords, updateByField } = require("./_lib/sheets");
const {
  normalizeKey,
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
  const user = requireRole(req, [ROLES.ADMIN, ROLES.KARIGAR]);
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

  if (user.role === ROLES.KARIGAR && piece.assigned_karigar_id !== user.entity_id) {
    const error = new Error("You can only complete your own assigned pieces");
    error.statusCode = 403;
    throw error;
  }

  if (!parseBoolean(piece.cutting_done)) {
    const error = new Error("Cutting is not verified for this piece yet");
    error.statusCode = 400;
    throw error;
  }

  if (!piece.assigned_karigar_id) {
    const error = new Error("Piece is not assigned yet");
    error.statusCode = 400;
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
    folder: "bin-hassan/completions"
  });

  await verifyPhotoAgainstOrderNumber({
    orderNumber: order.order_number,
    photoUrl,
    photoBase64,
    mismatchMessage: "Wrong slip or slip not visible. Please retake photo with the correct order slip.",
    noTextMessage:
      "Wrong slip or slip not visible. Please retake photo with the correct order slip."
  });

  const now = nowISO();

  const updated = await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, {
    karigar_status: STATUS.KARIGAR.COMPLETE,
    karigar_complete_date: now,
    completion_photo_url: photoUrl,
    completion_verified: "true",
    completion_verified_date: now,
    updated_date: now
  });

  await refreshOrderStatuses([updated.order_id]);

  sendOk(res, {
    message:
      normalizeKey(piece.karigar_status) === STATUS.KARIGAR.COMPLETE
        ? "Completion photo re-verified"
        : "Piece completed with verification",
    piece: stripMeta(updated)
  });
});
