# Digital Persona

## Inspiration
For years, our relationship with artificial intelligence has been largely confined to a static typing box. We send a prompt into the ether and wait for a paragraph to appear. While powerful, this asynchronous format lacks the nuance of face-to-face human connection. 

We asked ourselves: *What if we could take the intelligence of an LLM and give it a face, a voice, and a physical presence?* Our goal was to build an AI companion that feels natural to interact with—one that can look you in the eye, listen to the hesitation in your voice, and smile when you tell a joke.

## What it does
Digital Persona is a next-generation, fully embodied AI agent. It listens to you in real-time, interprets tone and context, and responds with ultra-low latency. 

It does not just talk; it actively perceives your environment. If you hold a document or a complex math problem up to the camera, the system can see it and guide you through it step-by-step. Furthermore, it supports a natural **barge-in** capability: if you interject while the avatar is speaking, it instinctively stops, acknowledges the interruption, and seamlessly pivots the conversation, just like a human would.

## How we built it
To create a real-time, emotionally responsive agent, we needed a robust architecture:
*   **The Brain:** We utilized the natively multimodal **Gemini 2.5 Flash Live API** to process synchronized audio and visual streams.
*   **The Body:** The frontend relies on **React** and **Next.js**, while the 3D avatar is brought to life using the **React Three Fiber (R3F)** engine and expressive Ready Player Me models.
*   **The Infrastructure:** To ensure security and scalability, our backend API is hosted on **Google Cloud Run**.
*   **The Workflow:** I also used **Antigravity IDE**, an AI agentic coding assistant, to help prototype, debug, and orchestrate the codebase.

## Challenges we ran into
Our primary hurdle was latency. Traditional HTTP REST APIs rely on a turn-taking system that introduces noticeable conversational delays, breaking immersion. We had to bypass standard HTTP requests entirely, engineering a persistent **WebSocket connection** to stream raw real-time audio (PCM) and video frames directly to Gemini as you speak.

Another major challenge was linking the AI's "brain" to its "body." If the system only returned audio, the 3D avatar would just stare blankly while a disembodied voice played. Bringing the physical body to act natively required immense synchronization and client-side orchestration.

## Accomplishments that we're proud of
I am incredibly proud of delivering a production-ready system that fundamentally answers the prompt of the Gemini Live Agent Challenge. 

Specifically, I am proud of our **Tool Calling Orchestration**. As audio streams back to the browser, Gemini sends parallel tool call instructions to the React Three Fiber engine. We defined functions like:

```javascript
set_expression(emotion, intensity);
trigger_animation(animation_name);
```

Thanks to this precise orchestration using ARKit blendshapes, the avatar can adopt a sympathetic expression or gesture in perfect harmony with its spoken words.

## What we learned
Building Digital Persona proved that the era of text-only chatbots is evolving. Through our testing, we learned that ultra-low latency and visual connection are the most crucial elements for establishing trust in virtual agents. We also learned that building these systems requires complex open-source integration, reinforcing the belief that open collaboration drives innovation.

## What's next for Digital Persona
Digital Persona is completely open-source, and we are eager to welcome contributions from developers, 3D artists, and AI enthusiasts! 

Moving forward, we plan to:
1.  **Enhance the Avatar:** Add procedural ambient movements like breathing and eye-darting, along with new expressive gestures.
2.  **Expand the Brain:** Implement new tool calls for the Gemini API, such as retrieving real-time web context, checking the weather, or integrating with external services.
3.  **Deploy to the Real World:** We are excited to explore practical use cases for this technology, such as an empathetic healthcare guide for anxious patients, a conversational tutor for students, or a multi-lingual concierge for hospitality.

## Built With
React, Next.js, TypeScript, Tailwind, Three.js, Gemini, GoogleCloud, CloudRun, WebSockets, Node.js
