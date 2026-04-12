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

  const providedPassword = String(password || "");
  const storedPassword = String(user.password || "");

  let isMatch = false;
  const looksHashed =
    storedPassword.startsWith("$2a$") ||
    storedPassword.startsWith("$2b$") ||
    storedPassword.startsWith("$2y$");

  if (looksHashed) {
    try {
      isMatch = await bcrypt.compare(providedPassword, storedPassword);
    } catch {
      isMatch = false;
    }
  }

  if (!isMatch) {
    // Backward-compatible fallback for legacy plain-text rows.
    isMatch = providedPassword === storedPassword;
  }

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
  let auth = "";
  let tokenSource = "none";

  // 1. Prioritize Query String Token (as requested for fallback)
  if (req.url) {
    try {
      const url = new URL(req.url, "http://localhost");
      const queryToken = url.searchParams.get("token");
      if (queryToken && queryToken !== "undefined" && queryToken !== "null") {
        tokenSource = "query";
        auth = queryToken;
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  // 2. Fallback to Authorization Header
  if (!auth && req && req.headers) {
    // Debug Header Logging
    try {
      if (typeof req.headers.get === "function") {
        const headersJson = {};
        req.headers.forEach((v, k) => { headersJson[k] = v; });
        console.log("Incoming Headers:", JSON.stringify(headersJson));
      } else {
        console.log("Incoming Headers:", JSON.stringify(req.headers));
      }
    } catch (e) {
      console.log("Logging failed", e.message);
    }

    if (typeof req.headers.get === "function") {
      auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    } else {
      auth = req.headers.authorization || req.headers.Authorization || "";
      if (!auth) {
        for (const key in req.headers) {
          if (key.toLowerCase() === "authorization") {
            auth = req.headers[key];
            break;
          }
        }
      }
    }
    if (auth) tokenSource = "header";
  }

  if (!auth) {
    const error = new Error("Unauthorized: No token provided");
    error.statusCode = 401;
    throw error;
  }

  // 3. Robust Bearer Splitting
  auth = auth.trim();
  const bearerRegex = /^bearer\s+/i;
  if (bearerRegex.test(auth)) {
    auth = auth.replace(bearerRegex, "").trim();
  }

  console.log("[AUTH] Token parsed from:", tokenSource);
  return auth;
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

function isDecodedUser(candidate) {
  return (
    !!candidate &&
    typeof candidate === "object" &&
    typeof candidate.username === "string" &&
    typeof candidate.role === "string" &&
    !candidate.headers
  );
}

function requireRole(reqOrUser, roles) {
  const user = isDecodedUser(reqOrUser) ? reqOrUser : requireAuth(reqOrUser);
  if (!roles.includes(user.role)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  console.log("[AUTH] Role check passed:", user.role, "allowed:", roles.join(","));
  return user;
}

module.exports = {
  authenticate,
  createToken,
  requireAuth,
  requireRole,
  stripPrivateUser
};
