import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Digital Persona",
  description:
    "A real-time 3D Digital Persona powered by Gemini Live API",
  icons: {
    icon: "/logo.jpg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.className} bg-background text-foreground antialiased overflow-hidden`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
        
        {/* Global Challenge Footer */}
        <footer className="absolute bottom-0 w-full p-4 text-center text-[10px] sm:text-xs text-white/40 bg-black/40 backdrop-blur-md z-50 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-6 border-t border-white/5 transition-all hover:bg-black/60 hover:text-white/70">
          <div className="flex items-center gap-1.5 opacity-80">
            <span>Built with <a href="https://nextjs.org" className="text-white hover:underline transition-all">Next.js</a></span>
            <span className="opacity-30">•</span>
            <span><a href="https://cloud.google.com/vertex-ai" className="text-white hover:underline transition-all">Vertex AI</a></span>
            <span className="opacity-30">•</span>
            <span><a href="https://gemini.google.com/" className="text-white hover:underline transition-all" target="_blank">Antigravity IDE</a></span>
          </div>
          
          <div className="hidden sm:block w-px h-3 bg-white/10" />
          
          <div className="flex items-center gap-4 font-medium tracking-wide">
            <a href="https://kshitijm7.github.io/digital-persona/challenge-submission" className="hover:text-blue-400 transition-colors" target="_blank">SUBMISSION</a>
            <a href="https://kshitijm7.github.io/digital-persona/credits" className="hover:text-blue-400 transition-colors" target="_blank">CREDITS</a>
            <a href="https://kshitijm7.github.io/digital-persona/about-me" className="hover:text-blue-400 transition-colors" target="_blank">ABOUT</a>
            <a href="https://kshitijm7.github.io/digital-persona/contribute" className="hover:text-blue-400 transition-colors" target="_blank">CONTRIBUTE</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
