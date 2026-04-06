const { requireAuth } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { withErrorHandler } = require("./_lib/utils");

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);

  sendOk(res, {
    user,
    last_synced: new Date().toISOString()
  });
<<<<<<< HEAD
});
=======
});
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
