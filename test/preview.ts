/**
 * Renders the real test note from the vault with the exact same
 * pipeline the plugin uses (embed expansion + markdown-it plugins),
 * producing an "expected result" HTML file for visual comparison.
 *
 * Media uploads are simulated: local attachment paths are used as the
 * resulting URLs, so the preview shows the real images when opened
 * from the same folder.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TFile } from './obsidian-stub';
import { AppState } from '../src/app-state';
import { MarkdownItWikiLinkPluginInstance } from '../src/markdown-it-wikilink-plugin';
import { MarkdownItMathJax3PluginInstance } from '../src/markdown-it-mathjax3-plugin';
import { MathJaxOutputType } from '../src/plugin-settings';
import { expandNoteEmbeds, getMediaRefs, isImageFile, decodeMediaSrc, MediaRef } from '../src/publish-converters';
import { stripFrontmatter } from '../src/utils';

const folder = process.argv[2] ?? 'D:/mynotes/WordPress发布测试';
const notePath = process.argv[3] ?? path.join(folder, 'WordPress全语法发布测试.md');
const outPath = process.argv[4] ?? path.join(folder, '预期效果预览.html');

function listFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(full));
    } else if (!entry.name.endsWith('.html')) {
      result.push(full);
    }
  }
  return result;
}

const files = listFiles(folder).map(p => p.replace(/\\/g, '/'));

function resolveFile(linkpath: string): TFile | null {
  const clean = decodeMediaSrc(linkpath).replace(/^\.\//, '');
  const candidates = [
    `${folder}/${clean}`,
    `${folder}/${clean}.md`,
    `${folder}/attachments/${clean}`,
  ];
  for (const candidate of candidates) {
    if (files.includes(candidate.replace(/\\/g, '/'))) {
      return new TFile(candidate);
    }
  }
  const hit = files.find(f => f.endsWith('/' + clean) || f.endsWith('/' + clean + '.md'));
  return hit ? new TFile(hit) : null;
}

function fakeApp(): Record<string, unknown> {
  return {
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string): TFile | null => resolveFile(linkpath),
      getFileCache: (): null => null,
    },
    vault: {
      read: async (file: TFile): Promise<string> => fs.readFileSync(file.path.replace(/\\/g, '/'), 'utf8'),
    },
  };
}

function encodeMediaUrl(fileName: string): string {
  return 'attachments/' + encodeURI(fileName);
}

function replacementFor(ref: MediaRef, file: TFile): string {
  const url = encodeMediaUrl(file.name);
  if (!isImageFile(file)) {
    return `[${ref.altText ?? file.name}](${url})`;
  }
  if (ref.syntax === 'wiki') {
    const suffix = ref.width
      ? (ref.height ? `|${ref.width}x${ref.height}` : `|${ref.width}`)
      : (ref.altText ? `|${ref.altText}` : '');
    return `![[${url}${suffix}]]`;
  }
  if (ref.width) {
    return `![[${url}|${ref.height ? `${ref.width}x${ref.height}` : ref.width}]]`;
  }
  return `![${ref.altText ?? ''}](${url})`;
}

async function main(): Promise<void> {
  MarkdownItMathJax3PluginInstance.updateOutputType(MathJaxOutputType.SVG);
  MarkdownItWikiLinkPluginInstance.setResolver(() => ({ exists: true }));
  MarkdownItWikiLinkPluginInstance.resetUnresolved();

  const app = fakeApp();
  const sourceFile = new TFile(notePath.replace(/\\/g, '/'));
  const raw = fs.readFileSync(notePath, 'utf8');

  const expanded = await expandNoteEmbeds(app as never, sourceFile, stripFrontmatter(raw));
  const unresolved = MarkdownItWikiLinkPluginInstance.takeUnresolved();

  // simulate media uploads: rewrite local references to attachment URLs
  let content = expanded.content;
  for (const ref of getMediaRefs(content)) {
    if (ref.isUrl) {
      continue;
    }
    const file = resolveFile(ref.src.split('#')[0]);
    if (file) {
      content = content.replace(ref.original, replacementFor(ref, file));
    }
  }

  const html = AppState.markdownParser.render(content);
  const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>预期效果预览（WordPress 发布测试）</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         max-width: 760px; margin: 2em auto; padding: 0 1em; line-height: 1.7; color: #1a1a1a; }
  .banner { background: #fff8e1; border: 1px solid #f0d060; padding: 0.6em 1em;
            border-radius: 6px; font-size: 0.9em; margin-bottom: 2em; }
  pre { background: #f5f5f5; padding: 0.8em; border-radius: 6px; overflow-x: auto; }
  code { background: #f5f5f5; padding: 0.1em 0.35em; border-radius: 3px; }
  pre code { padding: 0; background: none; }
  blockquote { border-left: 4px solid #bbb; margin-left: 0; padding-left: 1em; color: #555; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 0.4em 0.8em; }
  img { max-width: 100%; }
  .callout { border: 1px solid #ddd; border-left-width: 4px; border-radius: 6px; padding: 0.5em 1em; margin: 1em 0; }
  .callout-note { border-left-color: #4a90d9; }
  .callout-warning { border-left-color: #e6a23c; }
  .callout-tip { border-left-color: #67c23a; }
  .callout-example { border-left-color: #9b59b6; }
  .callout-success { border-left-color: #67c23a; }
  .callout-title { font-weight: 600; margin: 0.2em 0 0.4em; }
  .callout-content { margin: 0; }
  details.callout { padding: 0.5em 1em; }
  details.callout summary { cursor: pointer; font-weight: 600; }
  mark { background: #fff3a3; }
  .footnotes { font-size: 0.9em; color: #555; border-top: 1px solid #ddd; margin-top: 2em; }
</style>
</head>
<body>
<div class="banner">
  这是用插件同一套转换代码在本地生成的<strong>预期效果</strong>（图片指向本地副本，WordPress 上会指向站点媒体库 URL；站点视觉样式由你的 WordPress 主题决定）。发布后请与本页对照。
</div>
${html}
<script>void 0</script>
</body>
</html>`;

  fs.writeFileSync(outPath, page, 'utf8');
  console.log('preview written:', outPath);
  if (unresolved.length > 0) {
    console.log('unresolved wikilinks (expected in preview, rendered as text):');
    for (const u of [ ...new Set(unresolved) ]) {
      console.log('  -', u);
    }
  }
  if (expanded.failed.length > 0) {
    console.log('embed failures:', expanded.failed);
  }
}

main();
