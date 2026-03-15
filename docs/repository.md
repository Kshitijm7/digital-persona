# Exploring Our Source Code

Transparency is the foundation of trust. When building Digital Persona to handle sensitive, real-time conversations, showing the work openly was critical. You can explore exactly how this empathetic AI companion operates.

You can browse the entire public repository directly at [github.com/Kshitijm7/digital-persona](https://github.com/Kshitijm7/digital-persona), where you will find the complete source code, including the main README that guides you through the technical ecosystem.

## How to Run the Project Locally

Developers and technical architects who want to test this on their own machine will find the setup process as straightforward as possible.

Before getting started, ensure you have Node.js version 20 or higher installed. You will also need to enable the Gemini API in your Google Cloud project and secure a valid `GEMINI_API_KEY`.

Once those prerequisites are met, open your terminal and clone the repository using `git clone https://github.com/Kshitijm7/digital-persona.git`. After navigating into the folder with `cd digital-persona`, run `npm install` to gather all necessary dependencies.

The next crucial step is securely passing your API key. Create a file named `.env.local` in the root of the project and add your key: `GEMINI_API_KEY=your_gemini_api_key_here`.

After that, validate the 3D avatar assets by running `npm run setup-avatar`. Finally, launch the development server with `npm run dev`. Opening `http://localhost:3000` in your browser will prompt you to allow microphone and camera access. Once granted, Digital Persona will come to life right on your screen.

## Reproducibility and Quality

The documentation site is built with VitePress and published securely through GitHub Pages. Meanwhile, the actual AI application is containerized and hosted independently on Google Cloud Run. This division ensures that educational materials remain accessible and static, while the real-time application benefits from Google's immense processing power.

[See our live cloud application in action →](https://digital-persona-798468384002.us-central1.run.app/)

[Review our secure architecture setup →](/architecture)
