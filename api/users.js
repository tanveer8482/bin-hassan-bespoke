const bcrypt = require("bcryptjs");
const { ROLES, SHEETS } = require("./_lib/constants");
const { requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  appendRecord,
  deleteRecord,
  ensureWorkbook,
  getRecords,
  updateRecord
} = require("./_lib/sheets");
const {
  normalizeKey,
  normalizeText,
  parseBody,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

const ALLOWED_ROLES = new Set(Object.values(ROLES));

function stripPrivateUser(user) {
  const { __rowNumber, password, ...rest } = user;
  return rest;
}

function validateRole(role) {
  const normalized = normalizeKey(role);
  if (!ALLOWED_ROLES.has(normalized)) {
    const error = new Error(`Invalid role: ${role}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST", "PATCH", "DELETE"]);
  const currentAdmin = requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  if (req.method === "GET") {
    const users = await getRecords(SHEETS.USERS);
    return sendOk(res, {
      users: users.map(stripPrivateUser),
      last_synced: new Date().toISOString()
    });
  }

  const body = await parseBody(req);

  if (req.method === "POST") {
    requireFields(body, ["username", "password", "role", "display_name"]);

    const users = await getRecords(SHEETS.USERS);
    const username = normalizeText(body.username);

    const duplicate = users.some(
      (user) => normalizeKey(user.username) === normalizeKey(username)
    );
    if (duplicate) {
      const error = new Error("Username already exists");
      error.statusCode = 400;
      throw error;
    }

    const hashed = await bcrypt.hash(String(body.password), 10);
    const role = validateRole(body.role);

    const record = {
      username,
      password: hashed,
      role,
      display_name: normalizeText(body.display_name),
      entity_id:
        role === ROLES.ADMIN || role === ROLES.CUTTING ? "" : normalizeText(body.entity_id || body.username)
    };

    await appendRecord(SHEETS.USERS, record);

    return sendOk(res, {
      message: "User created",
      user: stripPrivateUser(record)
    });
  }

  if (req.method === "PATCH") {
    requireFields(body, ["username"]);

    const users = await getRecords(SHEETS.USERS);
    const user = users.find(
      (candidate) =>
        normalizeKey(candidate.username) === normalizeKey(body.username)
    );

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const patch = { ...user };

    if (body.new_username !== undefined) {
      const nextUsername = normalizeText(body.new_username);
      const duplicate = users.some(
        (candidate) =>
          normalizeKey(candidate.username) === normalizeKey(nextUsername) &&
          candidate.__rowNumber !== user.__rowNumber
      );
      if (duplicate) {
        const error = new Error("new_username already in use");
        error.statusCode = 400;
        throw error;
      }
      patch.username = nextUsername;
    }

    if (body.password !== undefined) {
      patch.password = await bcrypt.hash(String(body.password), 10);
    }

    if (body.role !== undefined) {
      patch.role = validateRole(body.role);
    }

    if (body.display_name !== undefined) {
      patch.display_name = normalizeText(body.display_name);
    }

    if (body.entity_id !== undefined) {
      patch.entity_id = normalizeText(body.entity_id);
    }

    if (patch.role === ROLES.ADMIN || patch.role === ROLES.CUTTING) {
      patch.entity_id = "";
    }

    const updated = await updateRecord(SHEETS.USERS, user.__rowNumber, patch);

    return sendOk(res, {
      message: "User updated",
      user: stripPrivateUser(updated)
    });
  }

  requireFields(body, ["username"]);
  const users = await getRecords(SHEETS.USERS);
  const target = users.find(
    (candidate) =>
      normalizeKey(candidate.username) === normalizeKey(body.username)
  );

  if (!target) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (normalizeKey(target.username) === normalizeKey(currentAdmin.username)) {
    const error = new Error("You cannot delete your own active admin account");
    error.statusCode = 400;
    throw error;
  }

  if (target.role === ROLES.ADMIN) {
    const adminCount = users.filter((user) => user.role === ROLES.ADMIN).length;
    if (adminCount <= 1) {
      const error = new Error("At least one admin user is required");
      error.statusCode = 400;
      throw error;
    }
  }

  await deleteRecord(SHEETS.USERS, target.__rowNumber);

  sendOk(res, {
    message: "User deleted",
    username: target.username
  });
});

