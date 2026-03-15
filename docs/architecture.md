# Architecture & Secure Cloud Infrastructure

Reviewing technical architecture can sometimes feel like stepping into a maze of jargon, but understanding how data flows and how these systems connect is crucial for building trust. When we designed Digital Persona, we prioritized a seamless, secure, and lightning-fast connection between the user and the AI.

![Digital Persona Architecture Banner](/assets/hero-alt.png)


## The High-Level Topology

Our system is divided into three main layers: the client (your browser), the secure backend API, and the Google AI Brain. Each layer has a clear responsibility, ensuring that voice and video never travel through unnecessary bottlenecks.

```mermaid
%%{init: { 'theme': 'base', 'look': 'default', 'themeVariables': { 'primaryColor': '#1e3a5f', 'primaryTextColor': '#f0f4ff', 'primaryBorderColor': '#38bdf8', 'lineColor': '#60a5fa', 'secondaryColor': '#0f2744', 'tertiaryColor': '#0c1a2e', 'background': '#0c1a2e', 'mainBkg': '#0f2744', 'nodeBorder': '#38bdf8', 'clusterBkg': '#0f1f38', 'clusterBorder': '#334155', 'titleColor': '#93c5fd', 'edgeLabelBackground': '#1e3a5f', 'fontFamily': 'Inter, system-ui, sans-serif' } } }%%
flowchart LR
    subgraph BROWSER["🖥️ Client — Browser"]
        direction TB
        MIC["🎤 Mic + Webcam"]
        HOOK["useGeminiLive Hook"]
        R3F["React Three Fiber Scene"]
        AVATAR["Ready Player Me Avatar"]
        MIC --> HOOK --> R3F --> AVATAR
    end

    subgraph BACKEND["🔐 Backend — Cloud Run"]
        TOKEN["POST /api/token\nephemeral key"]
    end

    subgraph AI["🧠 Google AI Brain"]
        direction TB
        GEMINI["Gemini 2.5 Flash Live"]
        VERTEX["Vertex AI Grounding"]
        GEMINI <--> VERTEX
    end

    MIC -- "1 · request token" --> TOKEN
    TOKEN -- "2 · ephemeral key" --> HOOK
    HOOK -- "3 · audio + video stream\n(WebSocket)" --> GEMINI
    GEMINI -- "4 · audio + tool calls\n(expressions, animations)" --> HOOK
```

## How Real-Time Interaction Actually Works

When you grant microphone and camera access, your client securely requests an ephemeral token. We use this token strategy specifically to protect your credentials—ensuring that your session is private and short-lived.

Once connected, audio and video are streamed directly to the Gemini Live API via WebSockets. It is this direct connection that minimizes delay while utilizing Affective Dialog to understand emotional subtleties. When the AI speaks, it sends back both the generated audio and precise tool calls. These tool calls are instructions for the React Three Fiber avatar, telling it exactly when to smile, when to gesture, and how to move its lips in perfect harmony with the spoken words using the unified `update_persona_state` and `trigger_animation` tools.

```mermaid
%%{init: { 'theme': 'base', 'look': 'default', 'themeVariables': { 'primaryColor': '#1e3a5f', 'primaryTextColor': '#f0f4ff', 'primaryBorderColor': '#38bdf8', 'lineColor': '#60a5fa', 'secondaryColor': '#0f2744', 'background': '#0c1a2e', 'fontFamily': 'Inter, system-ui, sans-serif', 'actorBkg': '#1e3a5f', 'actorBorder': '#38bdf8', 'actorTextColor': '#f0f4ff', 'actorLineColor': '#334155', 'signalColor': '#60a5fa', 'signalTextColor': '#f0f4ff', 'labelBoxBkgColor': '#0f2744',  'labelBoxBorderColor': '#334155', 'labelTextColor': '#93c5fd', 'loopTextColor': '#93c5fd', 'noteBorderColor': '#38bdf8', 'noteBkgColor': '#1e3a5f', 'noteTextColor': '#f0f4ff', 'activationBorderColor': '#38bdf8', 'activationBkgColor': '#0f2744' } } }%%
sequenceDiagram
    autonumber
    actor User
    participant Client as Browser Client
    participant API as /api/token
    participant Gemini as Gemini Live API
    participant Avatar as R3F Avatar

    User->>Client: Grant mic / camera, start session
    Client->>API: POST /api/token
    API-->>Client: Ephemeral token ✓

    Client->>Gemini: Open WebSocket session

    Note over Client,Gemini: Continuous multimodal stream
    Client->>Gemini: Audio chunks (PCM)
    Client->>Gemini: Video frames (webcam)

    Gemini-->>Client: Dual Audio & Text Transcriptions
    Gemini-->>Client: toolCall — update_persona_state / trigger_animation

    Client->>Avatar: Apply expressions + lip-sync visemes
    Client->>Gemini: toolResponse — result: ok

    Note over User,Client: Barge-in / interruption
    User->>Client: Speaks mid-response
    Client->>Gemini: New audio stream
    Gemini-->>Client: interrupted: true
    Client->>Avatar: Clear queues, reset playback
```

## Why We Chose This Approach

Users lose trust the moment an AI lags or stares blankly. By establishing a direct WebSocket stream, we eliminate the conversational delay that plagues older text-to-speech systems, making interactions feel genuinely human.

The primary service is hosted securely on Google Cloud Run, providing the scalable, reliable backbone required to support consistent, world-class interactions.

You can explore our live environment here: [digital-persona-798468384002.us-central1.run.app](https://digital-persona-798468384002.us-central1.run.app/)
