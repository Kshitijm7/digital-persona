export function getServerGeminiApiKey(): string | null {
  const serverKey = process.env.GEMINI_API_KEY?.trim();
  if (serverKey) {
    return serverKey;
  }

  return null;
}