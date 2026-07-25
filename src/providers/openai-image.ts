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
      // cf#223: the provider MESSAGE is not ours and is not content-free. A moderation refusal from
      // this API quotes the prompt back, so interpolating it verbatim put a USER PROMPT into an
      // exception message -- which reaches the caller and every log sink. The enumerated code/type
      // says what happened; the prose is dropped.
      const e = (await resp.json()) as { error?: { code?: string; type?: string } };
      const reason = e?.error?.code ?? e?.error?.type;
      detail = reason ? ` (${reason})` : "";
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
