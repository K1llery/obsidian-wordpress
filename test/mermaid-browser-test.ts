import mermaid from 'mermaid';

declare global {
  interface Window {
    __mermaidTestDone?: boolean;
  }
}

async function run(): Promise<void> {
  const out = document.getElementById('out') as HTMLElement;
  const render = document.getElementById('render') as HTMLElement;
  const results: string[] = [];
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    });

    // the exact diagram from the vault test note, tabs included
    const diagram = 'graph TD\n\tA[Obsidian 笔记] --> B[WordPress 插件]\n\tB --> C{语法转换}\n\tC -->|标准语法| D[直接转 HTML]\n\tC -->|Obsidian 语法| E[转换后 HTML]';

    const t0 = Date.now();
    const { svg } = await mermaid.render('ob-mermaid-svg-test', diagram);
    const ms = Date.now() - t0;
    results.push(`render: OK in ${ms}ms, svg length=${svg.length}`);
    results.push(`foreignObject used: ${svg.includes('foreignObject')}`);
    results.push(`explicit size: width attr=${/width="([^"]*)"/.exec(svg)?.[1] ?? 'none'}, has viewBox=${svg.includes('viewBox')}`);
    render.innerHTML = svg;

    // second render with the same id replaced (id collision check)
    const { svg: svg2 } = await mermaid.render('ob-mermaid-svg-test-2', diagram);
    results.push(`re-render with new id: OK, length=${svg2.length}`);
  } catch (e) {
    const err = e as { message?: string; str?: string };
    results.push(`render: FAILED: ${err.message ?? String(e)} ${err.str ?? ''}`);
  }
  out.textContent = results.join(' | ');
  window.__mermaidTestDone = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void run());
} else {
  void run();
}
