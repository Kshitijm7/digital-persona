/**
 * POST /api/generate-skin
 * Uses Gemini Nano Banana 2 (gemini-3.1-flash-image-preview) to generate
 * a photorealistic skin texture from a text prompt + optional reference image.
 *
 * Request body:
 *   { prompt: string; imageBase64?: string; mimeType?: string }
 *
 * Response:
 *   { imageBase64: string; mimeType: string }
 */

import { GoogleGenAI, Part } from "@google/genai";
import { getServerGeminiApiKey } from "@/lib/env";

const SKIN_SYSTEM_PROMPT = `You are a 3D assets specialist. Generate a photorealistic human skin texture for a 3D avatar head.
Requirements:
- Seamless, tileable texture suitable for a head mesh
- Neutral lighting — no harsh shadows, no specular highlights baked in
- No hair, no clothing, no background
- Realistic skin with subtle pores, natural color variation
- PBR-compatible albedo map (flat, evenly lit)
- Resolution: maximize output quality
- Format: PNG`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, imageBase64, mimeType } = body as {
      prompt: string;
      imageBase64?: string;
      mimeType?: string;
    };

    const apiKey = getServerGeminiApiKey();
    if (!apiKey) {
      return Response.json(
        { error: "Server missing GEMINI_API_KEY configuration" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Build the contents array. If a reference image was uploaded, include it.
    const contentParts: Part[] = [];

    if (imageBase64 && mimeType) {
      // Reference portrait image for skin tone matching
      contentParts.push({
        inlineData: {
          data: imageBase64,
          mimeType: mimeType as string,
        },
      });
      contentParts.push({
        text: `${SKIN_SYSTEM_PROMPT}\n\nReference image provided above. Match the skin tone and texture characteristics. ${prompt}`,
      });
    } else {
      contentParts.push({
        text: `${SKIN_SYSTEM_PROMPT}\n\n${prompt}`,
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview", // Nano Banana 2
      contents: [{ role: "user", parts: contentParts }],
    });

    // Find the inline image part in the response
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: Part) => p.inlineData?.data);

    if (!imagePart?.inlineData) {
      // Fallback: if model returned text description instead of image
      const textPart = parts.find((p: Part) => p.text);
      return Response.json(
        {
          error: "Nano Banana 2 returned text, not an image. Try a more specific skin texture prompt.",
          fallbackText: textPart?.text ?? "",
        },
        { status: 422 }
      );
    }

    return Response.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-skin] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
