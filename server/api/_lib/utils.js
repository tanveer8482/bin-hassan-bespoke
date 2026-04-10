const { v4: uuidv4 } = require("uuid");

function nowISO() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeKey(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function boolToCell(value) {
  return value ? "true" : "false";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => normalizeText(payload?.[field]) === "");
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
}

function id(prefix) {
  return `${prefix}_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
}

function sendJSON(res, statusCode, data) {
  res.status(statusCode).json(data);
}

async function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (error) {
    const parseError = new Error("Invalid JSON body");
    parseError.statusCode = 400;
    throw parseError;
  }
}

function withErrorHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[API HANDLER ERROR]", req.method, req.url, error);

      const statusCode = error.statusCode || 500;
      const payload = {
        ok: false,
        message: error.message || "Server error"
      };

      if (process.env.NODE_ENV !== "production") {
        payload.stack = error.stack;
      }

      sendJSON(res, statusCode, payload);
    }
  };
}

module.exports = {
  boolToCell,
  id,
  normalizeKey,
  normalizeText,
  nowISO,
  parseBody,
  parseBoolean,
  requireFields,
  sendJSON,
  toNumber,
  withErrorHandler
};
