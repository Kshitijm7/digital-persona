# Google Live API (Gemini Multimodal Live) Setup Guide

This guide explains how to obtain the necessary environment variables to power your Digital Persona.

## 1. Getting your Gemini API Key
To connect to the Gemini Multimodal Live API, you need a Google AI Studio API key.

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Review and accept the Terms of Service if prompted.
4. On the left navigation bar, click on **"Get API key"**.
5. Click the **"Create API key"** button. You can choose to link it to an existing Google Cloud Project or create a new one.
6. Copy the generated API string safely.

## 2. Environment Configuration
Create a `.env.local` file in the root of your Next.js project. Add the following variables:

```env
# Required: Your Gemini API Key from Google AI Studio
NEXT_PUBLIC_GEMINI_API_KEY=your_copied_api_key_here

# Required: The path to your compressed GLB model
NEXT_PUBLIC_MODEL_URL=/models/avatar-draco.glb
```

## 3. SDK Integration
This project uses the official `@google/genai` SDK for connecting to the Gemini Live API:
- **Package**: `@google/genai` — provides `GoogleGenAI`, `Session`, `LiveServerMessage`, `Modality` types
- **Model**: `gemini-2.5-flash-native-audio-preview-12-2025`
- **Connection**: `ai.live.connect()` handles WebSocket setup automatically
- **Sending audio**: `session.sendRealtimeInput({ audio: { data, mimeType } })`
- **Sending video**: `session.sendRealtimeInput({ video: { data, mimeType } })`
- **Audio format**: 16-bit PCM, 16kHz mono input → 24kHz output
