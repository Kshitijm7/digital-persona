import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppBootstrap } from "@/components/AppBootstrap";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Digital Persona",
  description: "A real-time 3D Digital Persona powered by Gemini Live API",
  icons: {
    icon: "/logo.svg",
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
        <Providers>
          {/*
           * AppBootstrap is a Client Component that runs one-time side effects
           * that must execute in the browser:
           *   - OrbitControls passive listener patch (needs window/DOM)
           *   - useEmotionStore.startAutoDecay (needs setInterval)
           * Both were previously at module level in layout.tsx (server context)
           * or unwired entirely. Moving them here gives them a stable mount
           * point that survives page navigations within the app shell.
           */}
          <AppBootstrap />
          {children}
        </Providers>
      </body>
    </html>
  );
}