# Architecture & Secure Cloud Infrastructure

I know that reviewing technical architecture can sometimes feel like stepping into a maze of jargon. But understanding how your data flows and how these systems connect is crucial for building trust. When we designed Digital Persona, we prioritized a seamless, secure, and lightning-fast connection between you and the AI.

## The High-Level Topology

Our system is divided into three main areas: the client (your browser), the secure backend API, and the Google AI Brain. We designed it this way to ensure that your voice and video never have to travel through unnecessary bottlenecks.

```mermaid
flowchart TD
    classDef client fill:#111827,stroke:#38bdf8,stroke-width:1.5px,color:#f8fafc
    classDef backend fill:#172554,stroke:#60a5fa,stroke-width:1.5px,color:#f8fafc
    classDef model fill:#0c4a6e,stroke:#22d3ee,stroke-width:1.5px,color:#f8fafc
    classDef component fill:#1f2937,stroke:#64748b,stroke-width:1px,color:#f8fafc

    subgraph "Client (Browser)"
        MIC["Mic + Webcam"]:::component
        HOOK["useGeminiLive Hook"]:::component
        R3F["React Three Fiber Scene"]:::component
        AVATAR["Ready Player Me Avatar"]:::component
        MIC --> HOOK
        HOOK --> R3F
        R3F --> AVATAR
    end

    subgraph "Backend / API Layer"
        TOKEN["/api/token (ephemeral)"]:::backend
    end

    subgraph "Google AI Brain"
        GEMINI["Gemini 2.5 Flash Live"]:::model
        VERTEX["Vertex AI Grounding"]:::model
    end

    MIC --> TOKEN
    TOKEN --> MIC
    MIC --- GEMINI
    GEMINI --- MIC
    GEMINI --> VERTEX
    VERTEX --> GEMINI
```

## How Real-Time Interaction Actually Works

When you grant microphone and camera access, your client securely requests an ephemeral token. We use this token strategy specifically to protect your credentials—ensuring that your session is private and short-lived. 

Once connected, your audio and video are streamed directly to the Gemini Live API via WebSockets. It is this direct connection that minimizes delay. When the AI speaks, it sends back both the audio and precise tool calls. These tool calls are instructions for the React Three Fiber avatar, telling it exactly when to smile, when to gesture, and how to move its lips in perfect harmony with the spoken words.

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Client as Frontend Client
    participant API as /api/token
    participant Gemini as Gemini Live API
    participant Avatar as R3F Avatar

    User->>Client: Grant mic/camera + start session
    Client->>API: POST /api/token
    API-->>Client: ephemeral token
    Client->>Gemini: open WebSocket session

    par Multimodal Input
      User->>Client: Speech input
      Client->>Gemini: realtimeInput(audio PCM)
    and
      Client->>Gemini: realtimeInput(video frames)
    and
      Client->>Gemini: clientContent(text fallback)
    end

    Gemini-->>Client: serverContent(audio + transcript)
    Gemini-->>Client: toolCall(trigger_animation / set_expression)

    par Render + Tool Execution
      Client->>Avatar: stream visemes + expressions
      Client->>Avatar: trigger animation
    and
      Client->>Gemini: toolResponse(result: ok)
    end

    User->>Client: Interrupt (barge-in)
    Client->>Gemini: new audio stream
    Gemini-->>Client: serverContent(interrupted=true)
    Client->>Avatar: clear playback queue
```

## Why We Chose This Approach

In our experience, users lose trust the moment an AI lags or stares blankly. By establishing a direct stream, we eliminate the conversational delay that plagues older text-to-speech systems. Your interactions feel human. 

Furthermore, we host the primary service securely on Google Cloud Run. We rely on Google Cloud's proven infrastructure because it provides the scalable, reliable backbone required to support consistent, world-class interactions. 

You can explore our live environment here: [digital-persona-798468384002.us-central1.run.app](https://digital-persona-798468384002.us-central1.run.app/)
