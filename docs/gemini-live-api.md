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

This post takes you behind the scenes to show exactly how we leveraged Google's cutting-edge GenAI technology to breathe life into the 3D avatar, transforming it from a static 3D model into an interactive, real-time companion.

***

## 1. The Need for Speed: The Multimodal WebSocket Connection

In traditional web applications, you typically use HTTP REST APIs. You send a request, you wait, and you receive a response. This "turn-taking" is far too slow for a natural conversation. If an avatar takes three seconds to respond to your greeting, the illusion of life shatters immediately.

Our first major hurdle was establishing a near-instantaneous bridge between your browser and the Google AI infrastructure. To solve this, we bypassed standard HTTP requests and implemented a **persistent WebSocket connection**.

Here is how it works in practice: When you grant microphone and camera access on our site, your browser securely requests a short-lived, ephemeral token from our secure backend layer deployed on Google Cloud Run. We use this token strategy to strictly protect our primary API credentials.

Once that token is secured, your browser opens a direct, two-way WebSocket session directly with the Gemini Live API. This open pipe allows us to stream data continuously in both directions without the constant overhead of establishing new connections.

## 2. Hearing and Seeing: Real-Time Audio and Vision Streaming

With the persistent pipe open, the system feeds the brain.

Standard voice assistants often require you to record your entire sentence, compress the audio file, and upload it before the AI even begins to think. We needed something faster.

Instead of waiting for you to finish speaking, the system captures raw audio from your microphone as **Pulse-Code Modulation (PCM) data**. These raw audio chunks are streamed directly over the WebSocket to Gemini, literally as the words are leaving your mouth.

Simultaneously, visual context is captured. If you are showing a document to your webcam, those video frames are sampled and streamed alongside the audio. Gemini 2.5 Flash is natively multimodal, meaning it can "see" and "hear" this data simultaneously, processing the visual and audio streams as a single, coherent input. This allows the avatar to understand not just what you are saying, but what you are holding up or pointing to.

## 3. The Puppeteer: Tool Calling Orchestration

This is perhaps the most magical part of the entire system. Understanding you is only half the battle; the avatar must also physically respond.

If the Gemini Brain only sent back audio and text, the 3D avatar would just stand there, staring blankly while a disembodied voice played. The brain needs to control the body.

To achieve this, we utilized a feature called **Tool Calling**. In the initial connection with Gemini, we provided it with a specific set of tools—essentially a manual on how to operate the Ready Player Me avatar. We defined functions like:

*   `set_expression(emotion, intensity)`
*   `trigger_animation(animation_name)`

When you speak to the Digital Persona, the Gemini model doesn't just generate a spoken reply. It simultaneously evaluates your emotional tone and its own response, deciding exactly how its physical body should react.

As the audio streams back to your browser, Gemini sends parallel tool call instructions. The React Three Fiber engine intercepts these commands. If you tell a sad story, Gemini instructs the avatar to adopt a sympathetic expression right as it verbally offers comfort. This synchronized dance between the generated audio and the physical animation is what makes the interaction feel deeply human.

## 4. Handling Interruptions: The Barge-In Feature

Have you ever tried to interrupt an automated phone menu? It is infuriating. Humans interrupt each other all the time; it is a natural part of active listening.

Because the system uses a continuous WebSocket stream, Digital Persona supports natural **barge-in**. If the avatar is mid-sentence and you suddenly interject with a new thought, your browser immediately streams your new audio to Gemini.

Gemini recognizes the interruption, sends a signal back to the client (`interrupted: true`), and the system instantly clears the avatar's audio playback and animation queues. The avatar stops speaking, acknowledges the new input, and seamlessly pivots the conversation.

## The Future of Human-Computer Interaction

Building the Digital Persona has proven that the era of text-only chatbots is coming to an end. By combining the blazing speed of WebSockets, the multimodal intelligence of Gemini 2.5 Flash, and precise tool-calling orchestration, we have created an interface that actually feels like talking to a friend.

Whether you are building an empathetic healthcare guide, a patient educational tutor, or an interactive concierge, this architecture represents the future. We are incredibly excited to see how you might use these tools to build experiences that prioritize human connection above all else.

***

*The complete source code and local spin-up instructions are available in our [public repository](/repository).*
