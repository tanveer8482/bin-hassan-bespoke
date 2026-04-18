const API_BASE = "/api";

const REQUEST_TIMEOUT_MS = 10000;
const MAX_VERCEL_SAFE_BODY_BYTES = Math.floor(4.2 * 1024 * 1024);

export const TOKEN_KEY = "bhb_token";
export const USER_KEY = "bhb_user";
export const MAX_UPLOAD_BYTES = 800 * 1024;

const DEFAULT_MAX_IMAGE_DIMENSION = 1600;
const CLOUDINARY_CLOUD_NAME = (
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || ""
).trim();
const CLOUDINARY_UNSIGNED_UPLOAD_PRESET = (
  import.meta.env.VITE_CLOUDINARY_UNSIGNED_UPLOAD_PRESET || ""
).trim();

function hasCloudinaryUnsignedConfig() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UNSIGNED_UPLOAD_PRESET);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read compressed image"));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to load selected image"));
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

export async function compressImageBeforeUpload(
  file,
  { maxBytes = MAX_UPLOAD_BYTES, maxDimension = DEFAULT_MAX_IMAGE_DIMENSION } = {}
) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("Please select a valid image file");
  }

  const image = await loadImageFromFile(file);

  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;

  const largestSide = Math.max(width, height);
  if (largestSide > maxDimension) {
    const scale = maxDimension / largestSide;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser image canvas is unavailable");
  }

  let quality = 0.9;
  let attempts = 0;
  let currentWidth = width;
  let currentHeight = height;
  let lastBlob = null;

  while (attempts < 12) {
    canvas.width = currentWidth;
    canvas.height = currentHeight;
    ctx.clearRect(0, 0, currentWidth, currentHeight);
    ctx.drawImage(image, 0, 0, currentWidth, currentHeight);

    lastBlob = await canvasToBlob(canvas, quality);
    if (lastBlob.size <= maxBytes) {
      return {
        blob: lastBlob,
        fileName: (file.name || "upload").replace(/\.[^.]+$/, "") + ".jpg",
        mimeType: "image/jpeg",
        sizeBytes: lastBlob.size,
        width: currentWidth,
        height: currentHeight,
        quality
      };
    }

    attempts += 1;

    if (quality > 0.55) {
      quality = Math.max(0.5, quality - 0.1);
      continue;
    }

    currentWidth = Math.max(480, Math.round(currentWidth * 0.85));
    currentHeight = Math.max(480, Math.round(currentHeight * 0.85));
    quality = 0.82;
  }

  const finalKb = Math.round((lastBlob?.size || 0) / 1024);
  throw new Error(
    `Image is still too large after compression (${finalKb}KB). Please capture a smaller image.`
  );
}

async function uploadToCloudinaryUnsigned(blob, fileName, folder = "") {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const uploadPreset = CLOUDINARY_UNSIGNED_UPLOAD_PRESET;

  const formData = new FormData();
  // Unsigned upload: upload_preset must be first.
  formData.append("upload_preset", uploadPreset);
  formData.append("file", blob, fileName || "upload.jpg");
  if (folder) {
    formData.append("folder", folder);
  }

  // Unsigned upload payload must never include signed-upload fields.
  const unsignedFields = [];
  for (const [key, value] of formData.entries()) {
    if (key === "file") continue;
    unsignedFields.push({ key, value: String(value) });
  }

  console.log(
    "[UPLOAD] Cloudinary unsigned request",
    JSON.stringify({
      endpoint,
      fields: unsignedFields
    })
  );

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.secure_url) {
    throw new Error(payload.error?.message || "Cloudinary unsigned upload failed");
  }

  return payload.secure_url;
}

export async function preparePhotoPayloadForApi(
  file,
  { folder = "bin-hassan-bespoke", maxBytes = MAX_UPLOAD_BYTES } = {}
) {
  const compressed = await compressImageBeforeUpload(file, { maxBytes });

  console.log(
    "[UPLOAD] Compression complete",
    JSON.stringify({
      fileName: compressed.fileName,
      sizeBytes: compressed.sizeBytes,
      sizeKb: Math.round(compressed.sizeBytes / 1024),
      width: compressed.width,
      height: compressed.height,
      quality: compressed.quality
    })
  );

  if (compressed.sizeBytes > maxBytes) {
    throw new Error("File is still too large after compression. Please select another image.");
  }

  if (hasCloudinaryUnsignedConfig()) {
    const photoUrl = await uploadToCloudinaryUnsigned(
      compressed.blob,
      compressed.fileName,
      folder
    );

    console.log("[UPLOAD] Cloudinary unsigned upload success", photoUrl);

    return {
      payload: {
        photo_url: photoUrl
      },
      meta: {
        uploadMode: "cloudinary_unsigned_formdata",
        compressedBytes: compressed.sizeBytes
      }
    };
  }

  const dataUrl = await blobToDataUrl(compressed.blob);
  const estimatedBodyBytes = new TextEncoder().encode(
    JSON.stringify({ photo_data_url: dataUrl })
  ).length;

  if (estimatedBodyBytes > MAX_VERCEL_SAFE_BODY_BYTES) {
    throw new Error(
      "Compressed payload is still too large for Vercel body limit. Configure Cloudinary unsigned upload."
    );
  }

  console.warn(
    "[UPLOAD] Falling back to base64 JSON payload. Configure VITE_CLOUDINARY_CLOUD_NAME + VITE_CLOUDINARY_UNSIGNED_UPLOAD_PRESET to bypass Vercel body limits."
  );

  return {
    payload: {
      photo_data_url: dataUrl
    },
    meta: {
      uploadMode: "base64_json_fallback",
      compressedBytes: compressed.sizeBytes,
      estimatedBodyBytes
    }
  };
}

export async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || REQUEST_TIMEOUT_MS;
  const timer = window.setTimeout(() => controller.abort(), timeout);

  let requestToken = options.token;

  const isInvalidToken =
    !requestToken ||
    requestToken === "undefined" ||
    requestToken === "null" ||
    (typeof requestToken === "string" && requestToken.trim() === "");

  if (isInvalidToken && typeof window !== "undefined") {
    requestToken = window.localStorage.getItem(TOKEN_KEY) || "";
  }

  requestToken = typeof requestToken === "string" ? requestToken.trim() : "";
  if (requestToken === "undefined" || requestToken === "null") requestToken = "";

  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headersObj = {
    ...(options.headers || {})
  };

  if (!isFormData && !headersObj["Content-Type"] && !headersObj["content-type"]) {
    headersObj["Content-Type"] = "application/json";
  }

  // Double-lock part 1: Authorization header
  if (requestToken) {
    headersObj.Authorization = `Bearer ${requestToken}`;
  }

  // Double-lock part 2: token query parameter
  let finalPath = path;
  if (requestToken && !/[?&]token=/.test(path)) {
    const divider = path.includes("?") ? "&" : "?";
    finalPath = `${path}${divider}token=${encodeURIComponent(requestToken)}`;
  }

  const method = options.method || "GET";
  const requestUrl = `${API_BASE}${finalPath}`;
  const tokenPrefix = requestToken ? `${requestToken.slice(0, 12)}...` : "none";
  console.log(`[API] ${method} ${requestUrl} tokenPrefix=${tokenPrefix}`);

  try {
    const response = await fetch(requestUrl, {
      method,
      headers: headersObj,
      body: options.body
        ? isFormData
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      const message = payload.message || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Request timed out after 10 seconds");
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  // All API calls use the consolidated /api/index?action=... endpoint
  login: async (body) => {
    const res = await request("/index?action=login", { method: "POST", body });
    if (res && res.token && typeof window !== "undefined") {
      console.log("Saving token to localStorage:", TOKEN_KEY);
      window.localStorage.setItem(TOKEN_KEY, res.token);

      const saved = window.localStorage.getItem(TOKEN_KEY);
      console.log("Verified token in localStorage:", saved ? "EXISTS" : "MISSING");

      if (res.user) {
        window.localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      }
    }
    return res;
  },
  getMe: (token) => request("/index?action=getMe", { token }),
  getSnapshot: (token) => request("/index?action=getSnapshot", { token }),
  bootstrap: (body) => request("/index?action=bootstrap", { method: "POST", body }),

  listOrders: (token) => request("/index?action=listOrders", { token }),
  createOrder: (token, body) =>
    request("/index?action=createOrder", { method: "POST", token, body }),
  updateOrder: (token, body) =>
    request("/index?action=updateOrder", { method: "PATCH", token, body }),
  extractOrder: (token, body) =>
    request("/index?action=extractOrder", { method: "POST", token, body }),

  markPieceCut: (token, body) =>
    request("/index?action=markPieceCut", { method: "POST", token, body }),
  assignPiece: (token, body) =>
    request("/index?action=assignPiece", { method: "POST", token, body }),
  requestApproval: (token, body) =>
    request("/index?action=requestApproval", { method: "POST", token, body }),
  approvePiece: (token, body) =>
    request("/index?action=approvePiece", { method: "POST", token, body }),
  syncPayroll: (token, body) =>
    request("/index?action=syncPayroll", { method: "POST", token, body }),
  generateInvoice: (token, body) =>
    request("/index?action=generateInvoice", { method: "POST", token, body }),

  completePiece: (token, body) =>
    request("/index?action=requestApproval", { method: "POST", token, body }),

  listShops: (token) => request("/index?action=listShops", { token }),
  createShop: (token, body) =>
    request("/index?action=createShop", { method: "POST", token, body }),
  updateShop: (token, body) =>
    request("/index?action=updateShop", { method: "PATCH", token, body }),

  listKarigar: (token) => request("/index?action=listKarigar", { token }),
  createKarigar: (token, body) =>
    request("/index?action=createKarigar", { method: "POST", token, body }),
  updateKarigar: (token, body) =>
    request("/index?action=updateKarigar", { method: "PATCH", token, body }),

  listProducts: (token) => request("/index?action=listProducts", { token }),
  saveProduct: (token, body) =>
    request("/index?action=saveProduct", { method: "POST", token, body }),
  listSubProducts: (token) => request("/index?action=listSubProducts", { token }),
  saveSubProduct: (token, body) =>
    request("/index?action=saveSubProduct", { method: "POST", token, body }),

  listShopPayments: (token) => request("/index?action=listShopPayments", { token }),
  createShopPayment: (token, body) =>
    request("/index?action=createShopPayment", { method: "POST", token, body }),

  listKarigarPayments: (token) =>
    request("/index?action=listKarigarPayments", { token }),
  createKarigarPayment: (token, body) =>
    request("/index?action=createKarigarPayment", { method: "POST", token, body }),

  listUsers: (token) => request("/index?action=listUsers", { token }),
  createUser: (token, body) =>
    request("/index?action=createUser", { method: "POST", token, body }),
  updateUser: (token, body) =>
    request("/index?action=updateUser", { method: "PATCH", token, body }),
  deleteUser: (token, body) =>
    request("/index?action=deleteUser", { method: "DELETE", token, body }),

  listSettings: (token) => request("/index?action=listSettings", { token }),
  saveSettings: (token, body) =>
    request("/index?action=saveSettings", { method: "POST", token, body }),
  clearAllData: (token, body) =>
    request("/index?action=clearAllData", { method: "POST", token, body })
};


