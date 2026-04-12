const { getEnv } = require("./env");
const { normalizeKey } = require("./utils");

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    const error = new Error("Invalid image data URL format.");
    error.statusCode = 400;
    throw error;
  }
  return {
    mimeType: match[1],
    base64: match[2]
  };
}

async function imageInputToBase64(imageInput) {
  const value = String(imageInput || "").trim();
  if (!value) {
    const error = new Error("Image input is required for verification.");
    error.statusCode = 400;
    throw error;
  }

  if (value.startsWith("data:")) {
    return parseDataUrl(value);
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) {
      const error = new Error("Failed to fetch uploaded image for verification.");
      error.statusCode = 400;
      throw error;
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      mimeType: response.headers.get("content-type") || "image/jpeg",
      base64: Buffer.from(arrayBuffer).toString("base64")
    };
  }

  const error = new Error("Unsupported image input format for verification.");
  error.statusCode = 400;
  throw error;
}

async function verifyWithGemini(referenceUrl, cuttingImageInput) {
  const env = getEnv();

  if (env.skipVisionVerification) {
    return { verified: true, extractedText: "Skipped via env" };
  }

  if (!env.geminiApiKey) {
    const error = new Error("GEMINI_API_KEY is not configured.");
    error.statusCode = 500;
    throw error;
  }

  if (!referenceUrl || !cuttingImageInput) {
    const error = new Error("Both Reference Slip and Cutting Photo are required for verification.");
    error.statusCode = 400;
    throw error;
  }

  try {
    // 1. Fetch Reference Slip from URL and convert to Base64
    const refRes = await fetch(referenceUrl);
    if (!refRes.ok) throw new Error("Failed to fetch reference slip image");
    const refBuffer = await refRes.arrayBuffer();
    const referenceMime = refRes.headers.get("content-type") || "image/jpeg";
    const referenceBase64 = Buffer.from(refBuffer).toString("base64");
    
    // 2. Resolve Cutting Photo from either data URL or direct URL
    const cuttingImage = await imageInputToBase64(cuttingImageInput);
    const cuttingMime = cuttingImage.mimeType;
    const cuttingBase64 = cuttingImage.base64;

    const prompt = `You are a strict QA assistant. You must compare the reference measurement slip photo and the newly cut fabric photo (which also contains a slip).
1. Identify and extract the Order ID from the reference slip.
2. Identify and extract the Order ID visible on the slip lying on the cut fabric.
3. Compare the fabric color, pattern, and texture against any descriptions or swatches noted in the reference slip.
You must be VERY STRICT. If the Order IDs do not match EXACTLY, or if the fabric color/pattern clearly contradicts the slip, you must fail the match.
Output ONLY a JSON object with this exact structure, no markdown, no other text:
{"match": true/false, "slip_order": "extracted order from ref", "fabric_order": "extracted order on fabric"}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: referenceMime,
                    data: referenceBase64
                  }
                },
                {
                  inlineData: {
                    mimeType: cuttingMime,
                    data: cuttingBase64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const payload = await geminiRes.json();

    if (!geminiRes.ok) {
      throw new Error(payload.error?.message || "Gemini API failed");
    }

    const textRes = payload.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const result = JSON.parse(textRes);

    if (!result.match) {
      const err = new Error(`Verification failed. Found Order ID ${result.fabric_order} on fabric, but expected ${result.slip_order} from slip.`);
      err.statusCode = 400;
      throw err;
    }

    return {
      verified: true,
      extractedText: `Matched: ${result.slip_order}`
    };
  } catch (error) {
    if (!error.statusCode) error.statusCode = 500;
    throw error;
  }
}

module.exports = {
  verifyWithGemini
};
