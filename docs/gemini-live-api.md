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

I remember the first time I tried talking to a standard AI chatbot. The experience felt like sending a letter and waiting for a reply. I would ask a question, endure a noticeable silence, and finally receive a robotic, text-based response. It lacked the immediacy, the warmth, and the visual cues that make human conversation feel natural.

When we set out to build the Digital Persona, we knew we had to fundamentally change that dynamic. We didn't just want an AI that could talk; we wanted an AI that could listen, see, and react with genuine emotional intelligence. To achieve this, we needed a "brain" that was incredibly fast, natively multimodal, and capable of orchestrating physical movements.

That brain is the **Gemini 2.5 Flash Live API**. 

In this post, I want to take you behind the scenes. I will show you exactly how we leveraged Google's cutting-edge GenAI technology to breathe life into our 3D avatar, transforming it from a static 3D model into an interactive, real-time companion.

***

## 1. The Need for Speed: The Multimodal WebSocket Connection

In traditional web applications, you typically use HTTP REST APIs. You send a request, you wait, and you receive a response. This "turn-taking" is far too slow for a natural conversation. If an avatar takes three seconds to respond to your greeting, the illusion of life shatters immediately.

Our first major hurdle was establishing a near-instantaneous bridge between your browser and the Google AI infrastructure. To solve this, we bypassed standard HTTP requests and implemented a **persistent WebSocket connection**.

Here is how it works in practice: When you grant microphone and camera access on our site, your browser securely requests a short-lived, ephemeral token from our secure backend layer deployed on Google Cloud Run. We use this token strategy to strictly protect our primary API credentials.

Once that token is secured, your browser opens a direct, two-way WebSocket session directly with the Gemini Live API. This open pipe allows us to stream data continuously in both directions without the constant overhead of establishing new connections.

## 2. Hearing and Seeing: Real-Time Audio and Vision Streaming

With the persistent pipe open, we had to feed the brain. 

Standard voice assistants often require you to record your entire sentence, compress the audio file, and upload it before the AI even begins to think. We needed something faster.

Instead of waiting for you to finish speaking, we capture the raw audio from your microphone as **Pulse-Code Modulation (PCM) data**. We stream these raw audio chunks directly over the WebSocket to Gemini, literally as the words are leaving your mouth.

Simultaneously, we capture visual context. If you are showing a document to your webcam, we sample those video frames and stream them alongside the audio. Gemini 2.5 Flash is natively multimodal, meaning it can "see" and "hear" this data simultaneously, processing the visual and audio streams as a single, coherent input. This allows the avatar to understand not just what you are saying, but what you are holding up or pointing to.

## 3. The Puppeteer: Tool Calling Orchestration

This is perhaps the most magical part of the entire system. Understanding you is only half the battle; the avatar must also physically respond.

If the Gemini Brain only sent back audio and text, our 3D avatar would just stand there, staring blankly while a disembodied voice played. We needed the brain to control the body.

To achieve this, we utilized a feature called **Tool Calling**. In our initial connection with Gemini, we provided it with a specific set of tools—essentially a manual on how to operate the Ready Player Me avatar. We defined functions like:

*   `set_expression(emotion, intensity)`
*   `trigger_animation(animation_name)`

When you speak to the Digital Persona, the Gemini model doesn't just generate a spoken reply. It simultaneously evaluates your emotional tone and its own response, deciding exactly how its physical body should react.

As the audio streams back to your browser, Gemini sends parallel tool call instructions. Our React Three Fiber engine intercepts these commands. If you tell a sad story, Gemini instructs the avatar to adopt a sympathetic expression right as it verbally offers comfort. This synchronized dance between the generated audio and the physical animation is what makes the interaction feel deeply human.

## 4. Handling Interruptions: The Barge-In Feature

Have you ever tried to interrupt an automated phone menu? It is infuriating. Humans interrupt each other all the time; it is a natural part of active listening.

Because we are using a continuous WebSocket stream, our Digital Persona supports natural **barge-in**. If the avatar is mid-sentence and you suddenly interject with a new thought, your browser immediately streams your new audio to Gemini. 

Gemini recognizes the interruption, sends a signal back to the client (`interrupted: true`), and we instantly clear the avatar's audio playback and animation queues. The avatar stops speaking, looks at you to acknowledge the new input, and seamlessly pivots the conversation.

## The Future of Human-Computer Interaction

Building the Digital Persona proved to us that the era of text-only chatbots is coming to an end. By combining the blazing speed of WebSockets, the multimodal intelligence of Gemini 2.5 Flash, and precise tool-calling orchestration, we have created an interface that actually feels like talking to a friend.

Whether you are building an empathetic healthcare guide, a patient educational tutor, or an interactive concierge, this architecture represents the future. We are incredibly excited to see how you might use these tools to build experiences that prioritize human connection above all else.

***

*If you want to explore the complete source code and try spinning this up locally yourself, I encourage you to check out our [public repository](/repository).*
