# Exploring Our Source Code

I believe that transparency is the foundation of trust. When we built Digital Persona to handle sensitive, real-time conversations, we knew that showing our work was critical. We want you to see exactly how this empathetic AI companion operates.

You can explore our entire public repository directly. By visiting [github.com/Kshitijm7/digital-persona](https://github.com/Kshitijm7/digital-persona), you will find the complete source code, including the main README that guides you through the technical ecosystem.

## How to Run the Project Locally

If you are a developer or a technical architect, you might want to test this out on your own machine. We have made the setup process as straightforward as possible.

Before you begin, ensure you have Node.js version 20 or higher installed. You will also need to enable the Gemini API in your Google Cloud project and secure a valid `GEMINI_API_KEY`. 

Once those prerequisites are met, you can open your terminal and clone the repository using `git clone https://github.com/Kshitijm7/digital-persona.git`. After navigating into the folder with `cd digital-persona`, run `npm install` to gather all necessary dependencies.

The next crucial step is securely passing your API key. Create a file named `.env.local` in the root of the project and add your key: `GEMINI_API_KEY=your_gemini_api_key_here`. 

After that, you must validate the 3D avatar assets by running `npm run setup-avatar`. Finally, you can launch the development server with `npm run dev`. When you open `http://localhost:3000` in your browser, you will be prompted to allow microphone and camera access. Once granted, our Digital Persona will come to life right on your screen.

## Reproducibility and Quality

In our efforts to maintain a perfectly reliable system, we chose to build our documentation site with VitePress, published securely through GitHub Pages. Meanwhile, the actual AI application is containerized and hosted independently on Google Cloud Run. This division ensures that while our educational materials remain accessible and static, our real-time application benefits from Google's immense processing power.

[See our live cloud application in action →](https://digital-persona-798468384002.us-central1.run.app/)
[Review our secure architecture setup →](/architecture)
