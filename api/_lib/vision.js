const { google } = require("googleapis");
const { getEnv } = require("./env");
const { normalizeText } = require("./utils");

let authClientPromise = null;

function normalizeToken(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getVisionAuthClient() {
  if (authClientPromise) return authClientPromise;

  const env = getEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  authClientPromise = Promise.resolve(auth);
  return authClientPromise;
}

async function extractTextFromPhoto({ photoUrl, photoBase64 }) {
  const env = getEnv();

  if (env.skipVisionVerification) {
    return "";
  }

  if (!photoUrl && !photoBase64) {
    const error = new Error("Photo input missing for verification");
    error.statusCode = 400;
    throw error;
  }

  const auth = await getVisionAuthClient();
  const tokenResponse = await auth.authorize();
  const accessToken = tokenResponse?.access_token;

  if (!accessToken) {
    const error = new Error("Unable to authorize Google Vision API request");
    error.statusCode = 500;
    throw error;
  }

  const image = photoBase64
    ? { content: photoBase64 }
    : { source: { imageUri: photoUrl } };

  const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        {
          image,
          features: [{ type: "TEXT_DETECTION" }]
        }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  const first = payload.responses?.[0] || {};

  if (!response.ok || first.error) {
    const error = new Error(
      first.error?.message || payload.error?.message || "Vision API request failed"
    );
    error.statusCode = 500;
    throw error;
  }

  return (
    first.fullTextAnnotation?.text ||
    first.textAnnotations?.[0]?.description ||
    ""
  );
}

function doesTextContainOrderNumber(orderNumber, extractedText) {
  const normalizedOrder = normalizeToken(orderNumber);
  const normalizedText = normalizeToken(extractedText);

  if (!normalizedOrder || !normalizedText) return false;
  return normalizedText.includes(normalizedOrder);
}

async function verifyPhotoAgainstOrderNumber({
  orderNumber,
  photoUrl,
  photoBase64,
  mismatchMessage,
  noTextMessage
}) {
  const env = getEnv();

  if (env.skipVisionVerification) {
    return {
      verified: true,
      extractedText: ""
    };
  }

  const extractedText = await extractTextFromPhoto({ photoUrl, photoBase64 });

  if (!normalizeText(extractedText)) {
    const error = new Error(
      noTextMessage ||
        "Slip not visible or unreadable. Please retake photo clearly."
    );
    error.statusCode = 400;
    throw error;
  }

  const matches = doesTextContainOrderNumber(orderNumber, extractedText);
  if (!matches) {
    const error = new Error(mismatchMessage || "Wrong order slip shown");
    error.statusCode = 400;
    throw error;
  }

  return {
    verified: true,
    extractedText
  };
}

module.exports = {
  doesTextContainOrderNumber,
  extractTextFromPhoto,
  verifyPhotoAgainstOrderNumber
};
