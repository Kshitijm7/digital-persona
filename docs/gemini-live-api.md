---
layout: doc
title: "The Brain Behind the Avatar: How We Used the Gemini Live API"
description: "A deep dive into how we built a real-time, emotionally responsive AI agent using Google's Gemini 2.5 Flash Live API and WebSockets."
head:
  - - meta
    - name: keywords
      content: Gemini Live API, Google Cloud, AI Avatar, Multimodal AI, WebSockets, React Three Fiber, Real-time AI
---

# The Brain Behind the Avatar: How We Used the Gemini Live API

The experience of talking to a standard AI chatbot has long felt like sending a letter and waiting for a reply. You ask a question, endure a noticeable silence, and receive a robotic, text-based response. It lacks the immediacy, the warmth, and the visual cues that make human conversation feel natural.

When we set out to build the Digital Persona, we knew we had to fundamentally change that dynamic. The goal wasn't just an AI that could talk; we wanted an AI that could listen, see, and react with genuine emotional intelligence. To achieve this, we needed a "brain" that was incredibly fast, natively multimodal, and capable of orchestrating physical movements.

That brain is the **Gemini 2.5 Flash Live API**. 

This post takes you behind the scenes to show exactly how we leveraged Google's cutting-edge GenAI technology to breathe life into the 3D avatar, tapping into its suite of advanced human-like interaction features.

***

## 1. The Need for Speed: The Multimodal WebSocket Connection

In traditional web applications, you typically use HTTP REST APIs. You send a request, you wait, and you receive a response. This "turn-taking" is far too slow for a natural conversation. 

Our first major hurdle was establishing a near-instantaneous bridge between your browser and the Google AI infrastructure. To solve this, we bypassed standard HTTP requests and implemented a **persistent WebSocket connection**. Your browser effortlessly opens a direct, two-way WebSocket session directly with the Gemini Live API, streaming data continuously in both directions.

## 2. Hearing and Seeing: Real-Time Audio and Vision Streaming

Standard voice assistants often require you to record your entire sentence before the AI even begins to think. We needed something faster.

The system captures raw audio from your microphone as **Pulse-Code Modulation (PCM) data** and streams it directly over the WebSocket to Gemini, literally as the words are leaving your mouth.

Simultaneously, visual context is captured. If you are showing a document to your webcam, those video frames are sampled (~1 FPS) and streamed alongside the audio. Gemini 2.5 Flash is natively multimodal, meaning it can **"see" and "hear" this data simultaneously**, processing the visual and audio streams as a single, coherent input. If you hold up a broken product and ask, *"What's wrong with this?"*, the avatar will see it and respond verbally in real time.

## 3. Emotional Intelligence: Affective Dialog and Proactive VAD

Because the model processes native raw audio instead of converting speech to text first, it hears the acoustic nuances of your voice. 

By enabling **Affective Dialog**, the Live API detects frustration, joy, hesitation, or confusion in your tone. The model automatically adjusts its own spoken tone, pitch, and pace to match or de-escalate your emotional state, making the 3D avatar incredibly empathetic.

Furthermore, we utilize Gemini's advanced Voice Activity Detection (VAD) and **Proactive Audio**. Instead of responding to any background noise, it distinguishes between the primary speaker and ambient chatter. It can gracefully handle filler words (like "umm" or "uhh") by back-channeling (saying "mhmm") instead of treating them as interruptions, allowing it to "co-listen" to an environment and interject only when valuable.

## 4. The Puppeteer: Tool Calling Orchestration

Understanding you is only half the battle; the avatar must also physically respond. To achieve this, we utilized a feature called **Tool Calling**. In the initial connection with Gemini, we provided it with a specific set of tools—essentially a manual on how to operate the Ready Player Me avatar. 

When you speak, the Gemini model simultaneously evaluates your emotional tone and its own response, deciding exactly how its physical body should react via instructions like `update_persona_state` or `trigger_animation`. If you tell a sad story, Gemini instructs the avatar to adopt a sympathetic expression right as it verbally offers comfort. 

## 5. Fluent Conversations: Seamless Barge-In and Dual Transcriptions

Humans interrupt each other all the time; it is a natural part of active listening. Because the system uses a continuous WebSocket stream, Digital Persona supports natural **Seamless Barge-In**. 

If the avatar is in the middle of a long explanation and you suddenly speak over it, the API fires an `interrupted` event. We use this signal to instantly stop the avatar's 3D mouth animations and audio playback, allowing the agent to acknowledge the interruption and pivot the conversation instantly.

And while all this raw audio is flying back and forth, the Live API simultaneously emits **Dual Audio/Text Transcriptions**. We use these real-time transcripts of both what you said and what the model replied to display live closed-captions in our UI, ensuring seamless accessibility.

## 6. Unbreakable Memory: Session Resumption and Grounding

WebSockets can be unstable on mobile devices or poor internet connections. To combat this, the API supports **Session Resumption**. If the pipe drops, we reconnect using a session handle without losing the conversation history. Combined with its massive 128,000-token context window, your avatar remembers details from 15 minutes ago, even if you temporarily lose your connection.

Finally, we give the avatar access to the outside world via **Google Search Grounding**. Instead of hallucinating answers, the avatar automatically searches the live internet to answer questions with real-time, factual accuracy while it speaks to you.

***

## The Future of Human-Computer Interaction

Building the Digital Persona has proven that the era of text-only chatbots is coming to an end. By combining the blazing speed of WebSockets, the multimodal intelligence of Gemini 2.5 Flash, and precise tool-calling orchestration, we have created an interface that actually feels like talking to a friend.

*The complete source code and local spin-up instructions are available in our [public repository](/repository).*
