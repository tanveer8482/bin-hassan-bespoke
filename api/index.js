const { URL } = require("url");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const handlers = {
  bootstrap: require("../server/api/bootstrap"),
  shops: require("../server/api/shops")
};

module.exports = async function (req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const segments = url.pathname.replace(/^\/+/g, "").split("/").filter(Boolean);
  const route = segments[0] === "api" ? segments[1] : segments[0];

  if (!route || !handlers[route]) {
    return sendJson(res, 404, { error: "Not found" });
  }

  return handlers[route](req, res);
};
