import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(defineConfig({
  title: "Digital Persona",
  description: "AI-Powered Multimodal Agent with Gemini Live API",
  appearance: 'dark',
  mermaid: {
    theme: 'dark',
    look: 'handDrawn'
  },
  vite: {
    ssr: {
      noExternal: ['mermaid', 'vitepress-plugin-mermaid']
    }
  },
  themeConfig: {
    logo: '/logo.jpg',

    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Overview', link: '/description' },
      { text: 'Use Cases', link: '/use-cases' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Gemini Live API', link: '/gemini-live-api' },
      { text: 'Submission', link: '/challenge-submission' },
      { text: 'Repository', link: '/repository' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Project Overview', link: '/description' },
          { text: 'Use Cases', link: '/use-cases' }
        ]
      },
      {
        text: 'Technical Deep Dive',
        items: [
          { text: 'Architecture & Cloud', link: '/architecture' },
          { text: 'Gemini Live API', link: '/gemini-live-api' },
          { text: 'Technical Implementation', link: '/technical-implementation' }
        ]
      },
      {
        text: 'Challenge Readiness',
        items: [
          { text: 'Submission Checklist', link: '/challenge-submission' },
          { text: 'GitHub Pages Deployment', link: '/github-pages-deployment' },
          { text: 'Code & Reproducibility', link: '/repository' }
        ]
      }
    ],

    outline: {
      level: [2, 3],
      label: 'On this page'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Kshitijm7/digital-persona' },
      { 
        icon: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Live Preview</title><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5c0-2.64-2.05-4.78-4.65-4.96zM10 17l5-3.5L10 10v7z"/></svg>' }, 
        link: 'https://digital-persona-798468384002.us-central1.run.app/', 
        ariaLabel: 'Live Preview' 
      }
    ],
    
    footer: {
      message: 'Built with Next.js, Vertex AI, and Google Cloud.',
      copyright: 'Copyright © 2026 Digital Persona Team'
    }
  }
}))
