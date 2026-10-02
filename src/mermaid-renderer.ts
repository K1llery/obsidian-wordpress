import { MarkdownItMermaidPluginInstance } from './markdown-it-mermaid-plugin';

export type MermaidSvgRenderer = (code: string) => Promise<string>;

let counter = 0;

let defaultRenderer: MermaidSvgRenderer | null = null;

/**
 * Lazily loads the bundled mermaid library on first use. Obsidian runs
 * in a full DOM environment, so diagrams are rendered to standalone SVG
 * at publish time and embedded into the post — no WordPress-side
 * mermaid plugin is needed.
 */
async function getDefaultRenderer(): Promise<MermaidSvgRenderer> {
  if (defaultRenderer === null) {
    defaultRenderer = async (code: string): Promise<string> => {
      if (typeof document === 'undefined') {
        throw new Error('Mermaid rendering requires a DOM environment.');
      }
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });
      const { svg } = await mermaid.render(`ob-mermaid-svg-${++counter}`, code);
      return svg;
    };
  }
  return defaultRenderer;
}

interface MermaidFenceBlock {
  startLine: number;
  endLine: number;
  code: string;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s].*)?$/;

/**
 * Finds fenced mermaid blocks in the raw note content.
 *
 * The scan is line-based (instead of regex based) so that nested or
 * adjacent fences are handled correctly.
 */
export function findMermaidFences(content: string): MermaidFenceBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: MermaidFenceBlock[] = [];
  let open: { mark: string, start: number, isMermaid: boolean } | null = null;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FENCE_RE);
    if (!match) {
      if (open !== null && open.isMermaid) {
        codeLines.push(lines[i]);
      }
      continue;
    }
    const mark = match[1];
    if (open === null) {
      const info = (match[2] ?? '').trim();
      open = { mark, start: i, isMermaid: info === 'mermaid' };
      codeLines = [];
    } else if (mark[0] === open.mark[0] && mark.length >= open.mark.length) {
      // closing fence of the same kind
      if (open.isMermaid) {
        blocks.push({
          startLine: open.start,
          endLine: i,
          code: codeLines.join('\n'),
        });
      }
      open = null;
      codeLines = [];
    } else if (open.isMermaid) {
      codeLines.push(lines[i]);
    }
  }
  // an unterminated fence is left to the markdown parser as-is
  return blocks;
}

export interface MermaidRenderResult {
  content: string;

  /**
   * First lines of the diagrams which failed to render. Their original
   * code fences are kept in the content.
   */
  failed: string[];
}

/**
 * Renders all fenced mermaid diagrams into standalone SVG at publish
 * time, replacing each fence with a placeholder fence which the
 * markdown-it mermaid plugin turns into the inline SVG.
 *
 * @param renderSvg injectable for tests; defaults to the bundled mermaid
 */
export async function renderMermaidDiagrams(
  content: string,
  renderSvg?: MermaidSvgRenderer
): Promise<MermaidRenderResult> {
  const blocks = findMermaidFences(content);
  if (blocks.length === 0) {
    return { content, failed: [] };
  }

  const render = renderSvg ?? await getDefaultRenderer();
  MarkdownItMermaidPluginInstance.clearSvgs();

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const failed: string[] = [];

  // replace from the last block to keep the earlier line indices valid
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    try {
      const svg = await render(block.code);
      const placeholder = `ob-mermaid-${++counter}`;
      MarkdownItMermaidPluginInstance.setSvg(placeholder, svg);
      lines.splice(block.startLine, block.endLine - block.startLine + 1, '```ob-mermaid', placeholder, '```');
    } catch {
      failed.push(block.code.trim().split('\n')[0] ?? 'diagram');
    }
  }

  return { content: lines.join(eol), failed };
}
