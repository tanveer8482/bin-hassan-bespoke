const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { SHEETS } = require("./constants");
const { getEnv } = require("./env");
const { getRecords } = require("./sheets");
const { normalizeKey } = require("./utils");

function stripPrivateUser(user) {
  return {
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    entity_id: user.entity_id || ""
  };
}

async function resolveEntityId(user) {
  if (user.entity_id) return user.entity_id;

  if (user.role === "shop") {
    const shops = await getRecords(SHEETS.SHOPS);
    const match = shops.find((shop) => {
      return (
        normalizeKey(shop.shop_name) === normalizeKey(user.display_name) ||
        normalizeKey(shop.shop_name) === normalizeKey(user.username) ||
        normalizeKey(shop.shop_id) === normalizeKey(user.username)
      );
    });
    return match?.shop_id || "";
  }

  if (user.role === "karigar") {
    const karigars = await getRecords(SHEETS.KARIGAR);
    const match = karigars.find((karigar) => {
      return (
        normalizeKey(karigar.name) === normalizeKey(user.display_name) ||
        normalizeKey(karigar.name) === normalizeKey(user.username) ||
        normalizeKey(karigar.karigar_id) === normalizeKey(user.username)
      );
    });
    return match?.karigar_id || "";
  }

  return "";
}

async function authenticate(username, password) {
  const users = await getRecords(SHEETS.USERS);
  const user = users.find(
    (candidate) => normalizeKey(candidate.username) === normalizeKey(username)
  );

  if (!user) {
    const error = new Error("Invalid username or password");
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await bcrypt.compare(String(password || ""), String(user.password || ""));
  if (!isMatch) {
    const error = new Error("Invalid username or password");
    error.statusCode = 401;
    throw error;
  }

  const entityId = await resolveEntityId(user);
  return {
    ...stripPrivateUser(user),
    entity_id: entityId
  };
}

function createToken(user) {
  const env = getEnv();
  return jwt.sign(
    {
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      entity_id: user.entity_id
    },
    env.jwtSecret,
    { expiresIn: "8h" }
  );
}

function parseAuthHeader(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
  return auth.replace("Bearer ", "");
}

function requireAuth(req) {
  const env = getEnv();
  const token = parseAuthHeader(req);
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (error) {
    const authError = new Error("Invalid token");
    authError.statusCode = 401;
    throw authError;
  }
}

function requireRole(req, roles) {
  const user = requireAuth(req);
  if (!roles.includes(user.role)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  return user;
}

module.exports = {
  authenticate,
  createToken,
  requireAuth,
  requireRole,
  stripPrivateUser
};
