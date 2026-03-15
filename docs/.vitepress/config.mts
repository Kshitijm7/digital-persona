import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(defineConfig({
  base: '/digital-persona/',
  title: "Digital Persona",
  description: "AI-Powered Multimodal Agent with Gemini Live API",
  mermaid: {
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
      { text: 'Architecture', link: '/architecture' },
      { text: 'Gemini Live API', link: '/gemini-live-api' },
      { text: 'Live Preview', link: 'https://digital-persona-798468384002.us-central1.run.app/', target: '_blank' }
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
      message: 'Built with next.js, Vertex AI, Google Cloud, and <a href="https://gemini.google.com/">Antigravity IDE</a>.<br><br><div class="footer-links"><a href="/digital-persona/challenge-submission">Submission</a> • <a href="/digital-persona/repository">Repository</a> • <a href="/digital-persona/credits">Credits</a> • <a href="/digital-persona/about-me">About Me</a> • <a href="/digital-persona/contribute">Contribute</a></div>',
      copyright: 'Made with ❤️ by Kshitij Mittal (kshitijm7@github | kshitijm7@linkedin) © 2026'
    }
  }
}))
