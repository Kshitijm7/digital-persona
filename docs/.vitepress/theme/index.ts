import { h } from 'vue'
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { withMermaid } from 'vitepress-plugin-mermaid'
import './custom.css'

export default withMermaid({
  extends: DefaultTheme,
  Layout: () => {
    const { theme, frontmatter } = useData()
    
    return h(DefaultTheme.Layout, null, {
      // The built-in Footer only appears on 'home' layout.
      // We inject a custom version into 'doc-after' to show it on all docs.
      'doc-after': () => {
        if (frontmatter.value.layout !== 'home' && theme.value.footer) {
          return h('footer', { class: 'VPFooter custom-doc-footer' }, [
            h('div', { class: 'container' }, [
              theme.value.footer.message ? h('p', { class: 'message', innerHTML: theme.value.footer.message }) : null,
              theme.value.footer.copyright ? h('p', { class: 'copyright', innerHTML: theme.value.footer.copyright }) : null
            ])
          ])
        }
      }
    })
  }
})
