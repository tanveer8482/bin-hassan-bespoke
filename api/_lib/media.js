const crypto = require("crypto");
const { getEnv } = require("./env");
const { normalizeText } = require("./utils");

function parseDataUrl(dataUrl) {
  const value = normalizeText(dataUrl);
  const match = value.match(/^data:(.+);base64,(.+)$/);

  if (!match) {
    const error = new Error("Invalid photo data format");
    error.statusCode = 400;
    throw error;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

async function uploadDataUrlToCloudinary(dataUrl, folder) {
  const env = getEnv();

  if (
    !env.cloudinaryCloudName ||
    !env.cloudinaryApiKey ||
    !env.cloudinaryApiSecret
  ) {
    const error = new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
    );
    error.statusCode = 500;
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signBase = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(`${signBase}${env.cloudinaryApiSecret}`)
    .digest("hex");

  const body = new URLSearchParams();
  body.set("file", dataUrl);
  body.set("folder", folder);
  body.set("api_key", env.cloudinaryApiKey);
  body.set("timestamp", String(timestamp));
  body.set("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`,
    {
      method: "POST",
      body
    }
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.secure_url) {
    const error = new Error(payload.error?.message || "Photo upload failed");
    error.statusCode = 500;
    throw error;
  }

  return payload.secure_url;
}

async function resolvePhotoInput({ photoUrl, photoDataUrl, folder }) {
  const directUrl = normalizeText(photoUrl);
  const directData = normalizeText(photoDataUrl);

  if (directData) {
    const parsed = parseDataUrl(directData);

    try {
      const uploadedUrl = await uploadDataUrlToCloudinary(directData, folder);
      return {
        photoUrl: uploadedUrl,
        photoBase64: parsed.base64
      };
    } catch (error) {
      const missingCloudinary = /Cloudinary is not configured/i.test(
        error.message || ""
      );
      if (!missingCloudinary) throw error;

      return {
        photoUrl: directData,
        photoBase64: parsed.base64
      };
    }
  }

  if (directUrl) {
    return {
      photoUrl: directUrl,
      photoBase64: ""
    };
  }

  const error = new Error("Photo is required");
  error.statusCode = 400;
  throw error;
}

module.exports = {
  parseDataUrl,
  resolvePhotoInput,
  uploadDataUrlToCloudinary
<<<<<<< HEAD
};
=======
};
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
