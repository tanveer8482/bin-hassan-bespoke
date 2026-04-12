let cache = null;

function getEnv() {
  if (cache) return cache;

  const required = [
    "GOOGLE_SHEETS_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "JWT_SECRET",
    "MY_ADMIN_KEY"
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
    error.statusCode = 500;
    throw error;
  }

  cache = {
    sheetsId: process.env.GOOGLE_SHEETS_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, "\n")
      .replace(/\"/g, ""),
    jwtSecret: process.env.JWT_SECRET,
    myAdminKey: process.env.MY_ADMIN_KEY,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 20000),
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
    skipVisionVerification:
      String(process.env.SKIP_VISION_VERIFICATION || "false").toLowerCase() ===
      "true",
    geminiApiKey: process.env.GEMINI_API_KEY || ""
  };

  return cache;
}

module.exports = { getEnv };
