# Digital Persona Animation Architecture

This document details how the Digital Persona maps ambiguous, conversational output from the Gemini Live LLM into precise, high-fidelity 3D skeletal animations using a localized Semantic Fuzzy Matching pipeline.

## The Challenge
When a user tells an AI, "Do a crazy happy dance!", the LLM doesn't know our exact internal file names (e.g., `M_Dances_002.glb`). If we force the LLM to memorize 250+ exact file names, it wastes context tokens and frequently hallucinates invalid file paths, breaking the 3D Avatar.

## The Solution: Semantic Intent Resolution
Instead of fighting the LLM, we let the LLM output whatever abstract string it wants (e.g. `gesture_name: "happy_dance"`). We then intercept that string on the frontend and run it through a mathematical **Multi-Factor Semantic Matcher** to find the closest logical animation in our registry.

### End-to-End Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant User as User Camera/Mic
    participant Gemini as Gemini Live API
    participant App as page.tsx (Tool Handler)
    participant Matcher as animationMatcher.ts
    participant Store as Zustand Store
    participant R3F as Avatar.tsx (3D Scene)

    User->>Gemini: "I'm so excited! Let's party!"
    Note over Gemini: LLM analyzes emotion & intent
    Gemini->>App: trigger_animation({ gesture_name: "excited party dance" })
    
    App->>Matcher: findBestAnimationMatch("excited party dance", registry)
    
    rect rgb(20, 30, 40)
        Note over Matcher: Local Semantic Engine
        Matcher->>Matcher: 1. Tokenize intent: ["excited", "party", "dance"]
        Matcher->>Matcher: 2. Filter via Salient Overlaps (instantly drop idles)
        Matcher->>Matcher: 3. Calculate Weighted Jaccard Similarity against PAD metrics
        Matcher->>Matcher: 4. Select highest scoring key
    end
    
    Matcher-->>App: Return: "masculine_dance_m_dances_002"
    App->>Store: setAnimation("masculine_dance_m_dances_002")
    
    Store-->>R3F: Reactive State Update
    Note over R3F: useDynamicAnimations() Hook
    R3F->>R3F: Lazy fetch & load .glb binary
    R3F->>R3F: Crossfade animation tracks
```

## How the Scoring Engine Works (`animationMatcher.ts`)

We process the registry matching using **Weighted Jaccard Similarity**, not standard string-distance algorithms (like Levenshtein).

### Why Jaccard over Levenshtein (Fuse.js)?
Standard fuzzy-matching libraries (like **Fuse.js**) are optimized to find **typographical errors in strings** (e.g., finding `"apple"` when the user types `"apppl"`). 
However, LLMs rarely make spelling mistakes. Instead, they use unpredictable combinations of *synonyms* (e.g., outputting `'joyful_jig'` when our tag is `'happy_dance'`). 

Jaccard Similarity treats the string as a **Bag of Words**. It doesn't care about the *order* of the letters, it cares about the *intersection of semantic concepts*.
If the LLM outputs `"dance happy"`, it collides perfectly with our array of tags `["happy", "energetic", "celebration", "dance"]`. A traditional string-distance algorithm would score this poorly because the characters are out of order, whereas our pipeline recognizes a 100% semantic hit.

### The Algorithm
1. **Normalization**: `"Do a Crazy-Dance!"` -> `["crazy", "dance"]`
2. **Salient Optimization**: If building scores for all 250 animations is too slow, we instantly drop any animation that shares *zero* tokens with the intent string.
3. **Weighting**:
    - Longer descriptive words (e.g., `celebratory`, `masculine`) are weighted **heavily** (2.0x multiplier) because they imply highly specific intent.
    - Common verbs (`say`, `do`) are weighted **lightly** (1.0x multiplier).
4. **PAD Metric Integration**: The matcher heavily prioritizes the `.semantic_tags` and `.primary_emotion` injected into our registry via the `emotion_map_full.json` over just the literal filename.
6. **Fallback Safety**: If the score is absolutely 0, but the LLM included the word `"dance"`, the system grabs *any* valid animation from the `dance` category to guarantee movement instead of visibly breaking on screen.

### The "Gold Standard" System Prompt
The Fuzzy Matcher is mathematically useless if the LLM only outputs 1 or 2 vague words (e.g., `"dance party"` or `"dance classy"`). To guarantee a high Jaccard success rate, the Gemini tool schema for `trigger_animation` explicitly demands:

> *"A rich, detailed string describing the desired 3D animation. Include the specific action, the primary emotion, and descriptive adjectives (e.g., 'energetic happy dance celebration', 'subtle professional head nod')."*

By forcing the LLM to output 4 to 6 keywords per request, we give the local matching engine a statistically massive surface area to intersect with our predefined PAD metrics and tags.

## Managing the Registry Data

Because writing complex JSON arrays of descriptors for 250 animations is tedious, we use a Node pipeline encompassing the following key files:

- **[prompt_for_gemini_web.md](prompt_for_gemini_web.md)**: The precise multimodal prompt used with Gemini Web to extract PAD metrics from raw animation videos.
- **[emotion_map_full.json](emotion_map_full.json)**: The manual dataset where we paste the structured Gemini analyses of the animations' physical movements.
- **[generate_registry.js](generate_registry.js)**: The automation script that crawls the hard drive to find every literal `.glb` binary, parses the emotion map, and dynamically merges the two together.
- **[index.json](index.json)**: The final, compiled registry containing both file paths and semantic tags. The web app only ever loads this single file on boot, keeping the runtime blazing fast.

### Workflow
1. Use `prompt_for_gemini_web.md` to analyze animations and generate semantic data.
2. Save the AI output into the appropriate location group in `emotion_map_full.json`.
3. Run `node public/animations/generate_registry.js` to crawl `.glb` files and merge the new semantics.
4. The script outputs the enriched registry to `index.json` for the frontend to consume.

## The Mixamo Conversion Pipeline (FBX to GLB)

When integrating new animations from Mixamo, you absolutely must use **FBX Binary (.fbx)** formats encoded **Without Skin** (this provides just the skeleton and keyframes). Once downloaded, our automated scripts handle the entire ingestion pipeline to prepare the files for the app.

### The Conversion Script (`mixamo-to-glb.mjs`)
Located inside `public/animations/`, this is the entry point for the automation.
1. **Recursion:** It climbs through `public/animations/` and all its subfolders hunting for raw `.fbx` files you've recently dropped in.
2. **GLB Engine:** It hands each raw FBX file off to Autodesk's `fbx2gltf` binary inside our node dependencies.
3. **Optimized Export:** A mathematically pure, tiny binary `.glb` is created right next to the source file. By relying on "Without Skin" FBX sources, these `.glb` files compile to as small as 100KB-500KB!
4. **Cleanup:** It immediately permanently deletes the original `.fbx` file so your repository size doesn't artificially bloat.
5. **Registry Hand-off:** At the very end of execution, it automatically launches `generate_registry.js` to ensure the app instantly acknowledges the new `.glb`.

### The Registry Script (`generate_registry.js`)
Triggered automatically by the conversion script (or ran manually), this file marries your raw binaries with the semantic LLM metadata.
1. **Dynamic Scanning:** It scans the directory tree recursively, finding every `.glb` file currently available.
2. **Path Mapping:** It maps exact relative browser URLs (e.g. `/animations/masculine/M_Dances_001.glb`).
3. **Data Merging:** It grabs the manually curated `emotion_map_full.json` file. Whenever it identically string-matches an animation path, it injects the rich tags (`primary_emotion`, `valence`, `semantic_tags`) into the object.
4. **Build Output:** It statically compiles all of this merged data directly into `index.json`, the only lightweight file the React app has to query.

### Complete Guide: How to add new animations
1. Navigate to Mixamo, select an animation, and click **Download**.
2. **Format:** FBX Binary (.fbx)
3. **Skin:** Without Skin
4. Dump the downloaded `.fbx` into any folder or subfolder inside `public/animations/`.
5. Run `npm run convert-animations` from the root directory.
6. The scripts will transparently convert the FBX, clean the folder, and enrich `index.json`!

## Next-Generation Upgrades (Active Pipeline)

To ensure the Avatar never falls out of sync or acts lifeless during long periods of conversation, the Semantic Matcher has been upgraded to a full "Gold Standard" architecture:

### 1. Hybrid Linguistic NLP 
We retired basic exact-word matching in favor of a Hybrid algorithm combining three major NLP pillars inside `animationMatcher.ts`:
- **Root Stemming:** The Matcher strips grammatical suffixes (e.g., intelligently reducing `"dancing"` and `"dances"` to the root linguistic index `"danc"`). 
- **Levenshtein Typo Correction:** The engine runs a Fast-Levenshtein matrix over all strings. If an unrecognized word from the LLM exceeds an 80% character similarity to a known registry tag, it gracefully accepts the match as a typo.
- **Trigram Semantics:** The `weightedHybridJaccardSimilarity` leverages these unified stems to flawlessly connect disjointed sentences into numeric weight scores. 

### 2. Multi-Action Sequencing (Animation Stacking)
The tool schema explicitly instructs the LLM to chain 3 to 5 continuous movements instead of firing a single action. 
- The Zustand `useAnimationStore` utilizes an internal `animationQueue` hook.
- The `page.tsx` application intercepts dynamic Array sequences from the LLM, scores all 5 actions instantly using the Hybrid NLP logic, and queues them into global state chronologically.
- **Dynamic Binary Timing**: Instead of relying on blind React timeouts, the `useDynamicAnimations.ts` hook actively reads the exact 3D binary `clip.duration` from the active `.glb` file to trigger perfect crossfades automatically.
- **Dynamic Speed Control (`timeScale`)**: The Gemini API schema explicitly exposes a `time_scale` float parameter to the LLM. The AI can dynamically speed up (e.g., `1.5x` for frantic reactions) or slow down (`0.5x` for depressed reactions) the animation. The entire chronological sequence queue automatically recalculates the physical wait time based on the active timescale to guarantee perfect sequencing.
- **Async Preloading**: A look-ahead `useEffect` actively runs `useGLTF.preload(url)` on upcoming queue items so they silently cache in the background while the avatar is busy performing the current task, completely eliminating UI network blocking or React Suspense halts.
- **Three.js Mathematical Blending (`crossFadeFrom`)**: The `Avatar.tsx` renderer actively caches the `previousAction` and utilizes underlying Three.js logic to physically interpolate the bone weights between the outgoing skeleton and the incoming skeleton for photorealistic fluidity without snapping.
- **Auto-Halting (`clampWhenFinished`)**: The Avatar naturally freezes and holds its final pose instead of awkwardly looping if an animation chunk finishes before the LLM speaks the next sentence.

### 3. Future "End-State" Vector Embeddings (Transformers.js)
The ultimate, final evolution of this pipeline abandons literal string intersections entirely in favor of **Client-Side Vector Embeddings**. 

The current industry "Gold Standard" for zero-latency, private, browser-based semantic search operates on the following stack:
1. **[Transformers.js](https://huggingface.co/docs/transformers.js)**: A Hugging Face port that runs ML models directly in the browser via WebAssembly (WASM) and WebGPU.
2. **`Xenova/all-MiniLM-L6-v2`**: A heavily quantized, ultra-lightweight (~30MB) embedding model that runs lightning-fast on client devices.
3. **Local Vector Database**: Tools like `EntityDB` or generic IndexedDB wrappers cache the calculated embeddings offline.

**How it would work:**
Instead of storing text tags in `index.json`, the build pipeline would pre-calculate an embedding vector (a 384-dimensional array of floats) for each animation's PAD metrics. At runtime, the browser would load `Transformers.js`, convert the LLM's requested string (e.g. `"joyful"`) into a vector, and calculate the **Cosine Similarity** against the animation registry. 

This approach flawlessly maps conceptual synonyms (instantly recognizing `"joyful"` matches `"happy"` despite sharing zero letters) with absolutely no cloud latency or server costs!
