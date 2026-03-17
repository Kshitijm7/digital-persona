import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { getServerGeminiApiKey } from '@/lib/env';

type GenAIGlobalCache = {
  __genAIClient?: GoogleGenAI;
  __genAIClientApiKey?: string;
};

let productionClient: GoogleGenAI | null = null;

function getCachedClient(apiKey: string): GoogleGenAI {
  if (process.env.NODE_ENV === "production") {
    if (!productionClient) {
      productionClient = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" },
      });
    }
    return productionClient;
  }

  const globalCache = globalThis as unknown as GenAIGlobalCache;
  const shouldRecreate =
    !globalCache.__genAIClient || globalCache.__genAIClientApiKey !== apiKey;

  if (shouldRecreate) {
    globalCache.__genAIClient = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    globalCache.__genAIClientApiKey = apiKey;
  }

  return globalCache.__genAIClient!;
}

export async function POST() {
  // Initialize the client on the server using the secret server-side key
  const apiKey = getServerGeminiApiKey();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server missing GEMINI_API_KEY configuration." },
      { status: 500 }
    );
  }

  const ai = getCachedClient(apiKey);

  try {
    // Generate a secure short-lived token restricted to the Live API
    // 1 hours maximum session length
    const expireTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    // Connect within 60 seconds, and only allow 1 use of this token 
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();
    
    const response = await ai.authTokens.create({
      config: { 
        expireTime,
        newSessionExpireTime,
        uses: 1,
      }
    });
    
    return NextResponse.json({ token: response.name });
  } catch (error) {
    console.error("Token generation failed:", error);
    return NextResponse.json(
      { error: "Token generation failed" }, 
      { status: 500 }
    );
  }
}
