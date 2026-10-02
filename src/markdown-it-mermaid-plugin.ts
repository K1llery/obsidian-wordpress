import MarkdownIt from 'markdown-it';

/**
 * Renders `mermaid` code fences as `<pre class="mermaid">` blocks, so that
 * they can be rendered by WordPress mermaid plugins (e.g. wp-mermaid).
 *
 * Without a site-side mermaid renderer the diagram source is displayed
 * as a plain code block, which is still readable.
 */
export const MarkdownItMermaidPluginInstance = {
  plugin: plugin,
}

function plugin(md: MarkdownIt): void {
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
      return `<pre class="mermaid">\n${md.utils.escapeHtml(token.content)}\n</pre>\n`;
    }
    return defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}
