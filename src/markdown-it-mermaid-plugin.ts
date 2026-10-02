import MarkdownIt from 'markdown-it';

/**
 * Mermaid diagram rendering for published posts.
 *
 * Diagrams are rendered to standalone SVG at publish time by
 * `mermaid-renderer.ts`, which replaces each ```mermaid fence with an
 * ```ob-mermaid placeholder fence and stores the SVG in this module.
 * The renderer below then embeds the SVG into the post, so the
 * published page needs no WordPress-side mermaid plugin at all.
 *
 * Fences which were not pre-rendered (e.g. rendering failed) fall back
 * to `<pre class="mermaid">` for site-side renderers such as WP
 * Mermaid, and display as a plain code block otherwise.
 */
const svgStore = new Map<string, string>();

export const MarkdownItMermaidPluginInstance = {
  plugin: plugin,
  setSvg: (id: string, svg: string): void => {
    svgStore.set(id, svg);
  },
  consumeSvg: (id: string): string | undefined => {
    const svg = svgStore.get(id);
    svgStore.delete(id);
    return svg;
  },
  clearSvgs: (): void => {
    svgStore.clear();
  },
}

function plugin(md: MarkdownIt): void {
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim();
    if (info === 'ob-mermaid') {
      const svg = MarkdownItMermaidPluginInstance.consumeSvg(token.content.trim());
      if (svg !== undefined) {
        return `${svg}\n`;
      }
      // no pre-rendered SVG: fall through to the plain code block
    }
    if (info === 'mermaid') {
      return `<pre class="mermaid">\n${md.utils.escapeHtml(token.content)}\n</pre>\n`;
    }
    return defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}
