import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { getServerGeminiApiKey } from '@/lib/env';

export async function POST() {
  // Initialize the client on the server using the secret server-side key
  const apiKey = getServerGeminiApiKey();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server missing GEMINI_API_KEY configuration." },
      { status: 500 }
    );
  }

  const ai = new GoogleGenAI({ 
    apiKey,
    httpOptions: { apiVersion: "v1alpha" } 
  }); 

  try {
    // Generate a secure short-lived token restricted to the Live API
    // 30 minutes maximum session length
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
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
