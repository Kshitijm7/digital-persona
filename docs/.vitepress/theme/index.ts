import DefaultTheme from 'vitepress/theme'
import { withMermaid } from 'vitepress-plugin-mermaid'
import './custom.css'

export default withMermaid({
  extends: DefaultTheme,
  enhanceApp() {
    // Custom app enhancement
  }
})
