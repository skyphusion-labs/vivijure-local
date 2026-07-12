// OpenAI direct (BYOK) image generation (ported from vivijure/src/providers/openai-image.ts).

import { base64ToBytes } from "../utils.js";

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
}

export async function generateOpenAIImage(
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<GeneratedImage> {
  const model = modelId.replace(/^openai\//, "");

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      output_format: "png",
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      const e = (await resp.json()) as { error?: { message?: string } };
      detail = e?.error?.message ? `: ${e.error.message}` : "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`OpenAI image API ${resp.status}${detail}`);
  }

  const data = (await resp.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image API returned no b64_json image data");

  return { bytes: base64ToBytes(b64), mime: "image/png" };
}
