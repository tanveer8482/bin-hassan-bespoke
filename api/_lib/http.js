const { sendJSON } = require("./utils");

function ensureMethod(req, allowedMethods) {
  if (allowedMethods.includes(req.method)) return;

  const error = new Error(`Method ${req.method} not allowed`);
  error.statusCode = 405;
  throw error;
}

function isAdmin(user) {
  return user?.role === "admin";
}

function sendOk(res, data = {}) {
  sendJSON(res, 200, {
    ok: true,
    ...data
  });
}

module.exports = {
  ensureMethod,
  isAdmin,
  sendOk
};
