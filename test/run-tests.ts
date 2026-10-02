import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { TFile } from './obsidian-stub';
import { MarkdownItWikiLinkPluginInstance, splitWikiLinkTarget, WikiLinkResolution } from '../src/markdown-it-wikilink-plugin';
import { MarkdownItImagePluginInstance } from '../src/markdown-it-image-plugin';
import { MarkdownItCommentPluginInstance } from '../src/markdown-it-comment-plugin';
import { MarkdownItCalloutPluginInstance } from '../src/markdown-it-callout-plugin';
import { MarkdownItTaskListPluginInstance } from '../src/markdown-it-tasklist-plugin';
import { MarkdownItHighlightPluginInstance } from '../src/markdown-it-highlight-plugin';
import { MarkdownItMermaidPluginInstance } from '../src/markdown-it-mermaid-plugin';
import {
  createWikiLinkResolver,
  expandNoteEmbeds,
  extractSection,
  getMediaRefs,
  mimeTypeFor
} from '../src/publish-converters';
import { stripFrontmatter } from '../src/utils';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    })
    .catch(error => {
      failed++;
      console.error(`  FAIL - ${name}\n    ${error?.message ?? error}`);
    });
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message ?? 'assertEqual failed'}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function assertIncludes(haystack: string, needle: string, message?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${message ?? 'assertIncludes failed'}\n    expected to include: ${needle}\n    actual: ${haystack}`);
  }
}

function createParser(): MarkdownIt {
  const md = new MarkdownIt();
  md.use(MarkdownItCommentPluginInstance.plugin)
    .use(MarkdownItImagePluginInstance.plugin)
    .use(MarkdownItWikiLinkPluginInstance.plugin)
    .use(MarkdownItCalloutPluginInstance.plugin)
    .use(MarkdownItTaskListPluginInstance.plugin)
    .use(MarkdownItHighlightPluginInstance.plugin)
    .use(MarkdownItMermaidPluginInstance.plugin)
    .use(footnote);
  return md;
}

async function main(): Promise<void> {
  console.log('markdown rendering:');

  await test('wikilink to an unpublished note is rendered as plain text', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({ exists: true }));
    MarkdownItWikiLinkPluginInstance.onUnresolved(() => {});
    assertEqual(md.renderInline('See [[some note]] here.'), 'See some note here.');
  });

  await test('wikilink with alias renders the alias', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({ exists: true }));
    assertEqual(md.renderInline('See [[some note|the note]] here.'), 'See the note here.');
  });

  await test('wikilink to a published note becomes a permalink', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({
      exists: true,
      permalink: 'https://example.com/the-post/'
    }));
    MarkdownItWikiLinkPluginInstance.onUnresolved(() => {});
    assertEqual(
      md.renderInline('See [[some note]].'),
      'See <a href="https://example.com/the-post/">some note</a>.'
    );
  });

  await test('wikilink with heading subpath appends an anchor', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({
      exists: true,
      permalink: 'https://example.com/the-post/',
      subpath: '第二节',
    }));
    MarkdownItWikiLinkPluginInstance.onUnresolved(() => {});
    const html = md.renderInline('See [[some note#第二节]].');
    assertEqual(html, 'See <a href="https://example.com/the-post/#%E7%AC%AC%E4%BA%8C%E8%8A%82">some note &gt; 第二节</a>.');
  });

  await test('wikilink to a missing note is reported and rendered as text', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({ exists: false }));
    MarkdownItWikiLinkPluginInstance.resetUnresolved();
    MarkdownItWikiLinkPluginInstance.onUnresolved(() => {});
    assertEqual(md.renderInline('See [[ghost]].'), 'See ghost.');
    assertEqual(MarkdownItWikiLinkPluginInstance.takeUnresolved(), [ 'ghost' ]);
  });

  await test('wikilinks inside code blocks are not converted', () => {
    const md = createParser();
    MarkdownItWikiLinkPluginInstance.setResolver(() => ({
      exists: true,
      permalink: 'https://example.com/x/'
    }));
    const html = md.render('`[[not a link]]`');
    assertIncludes(html, '[[not a link]]');
  });

  await test('callout becomes a styled div', () => {
    const md = createParser();
    const html = md.render('> [!warning] Watch out\n> content line\n> more content\n');
    assertIncludes(html, '<div class="callout callout-warning" data-callout="warning">');
    assertIncludes(html, '<p class="callout-title">⚠️ Watch out</p>');
    assertIncludes(html, 'content line');
    assertIncludes(html, 'more content');
    if (html.includes('blockquote')) {
      throw new Error('callout still contains blockquote');
    }
  });

  await test('callout without title uses the type name', () => {
    const md = createParser();
    const html = md.render('> [!info]\n> something\n');
    assertIncludes(html, '<p class="callout-title">ℹ️ info</p>');
  });

  await test('foldable callout becomes details/summary', () => {
    const md = createParser();
    const html = md.render('> [!example]- Collapsed\n> hidden content\n');
    assertIncludes(html, '<details class="callout callout-example" data-callout="example">');
    assertIncludes(html, '<summary class="callout-title">📑 Collapsed</summary>');
    assertIncludes(html, '<div class="callout-content">');
    assertIncludes(html, 'hidden content');
    if (html.includes(' open')) {
      throw new Error('collapsed callout should not be open');
    }
  });

  await test('expanded-by-default callout has open attribute', () => {
    const md = createParser();
    const html = md.render('> [!example]+ Expanded\n> content\n');
    assertIncludes(html, '<details');
    assertIncludes(html, 'open=""');
    assertIncludes(html, 'class="callout callout-example"');
    assertIncludes(html, 'data-callout="example"');
  });

  await test('regular blockquotes are untouched', () => {
    const md = createParser();
    const html = md.render('> just a quote\n');
    assertIncludes(html, '<blockquote>');
  });

  await test('task list items become checkboxes', () => {
    const md = createParser();
    const html = md.render('- [ ] buy milk\n- [x] done thing\n- plain item\n');
    assertIncludes(html, '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> buy milk</li>');
    assertIncludes(html, '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> done thing</li>');
    assertIncludes(html, '<li>plain item</li>');
  });

  await test('highlights become mark elements', () => {
    const md = createParser();
    assertEqual(md.renderInline('a ==highlighted== word'), 'a <mark>highlighted</mark> word');
  });

  await test('equals signs that are not highlights are untouched', () => {
    const md = createParser();
    assertEqual(md.renderInline('x = y'), 'x = y');
    assertEqual(md.renderInline('x == y'), 'x == y');
  });

  await test('mermaid fences become pre.mermaid blocks', () => {
    const md = createParser();
    const html = md.render('```mermaid\ngraph TD\n  A --> B\n```\n');
    assertIncludes(html, '<pre class="mermaid">');
    assertIncludes(html, 'graph TD');
  });

  await test('other code fences are untouched', () => {
    const md = createParser();
    const html = md.render('```ts\nconst a = 1;\n```\n');
    assertIncludes(html, 'language-ts');
  });

  await test('inline comments are dropped by default', () => {
    const md = createParser();
    MarkdownItCommentPluginInstance.updateConvertMode('ignore' as never);
    assertEqual(md.renderInline('before %%a comment%% after'), 'before  after');
  });

  await test('inline comments become HTML comments in HTML mode', () => {
    const md = createParser();
    MarkdownItCommentPluginInstance.updateConvertMode('html' as never);
    assertEqual(md.renderInline('before %%a comment%% after'), 'before <!-- a comment --> after');
    MarkdownItCommentPluginInstance.updateConvertMode('ignore' as never);
  });

  await test('multi-line comment blocks are dropped', () => {
    const md = createParser();
    MarkdownItCommentPluginInstance.updateConvertMode('ignore' as never);
    const html = md.render('before\n%%\nhidden line 1\nhidden line 2\n%%\nafter\n');
    if (html.includes('hidden')) {
      throw new Error(`comment leaked: ${html}`);
    }
    assertIncludes(html, 'before');
    assertIncludes(html, 'after');
  });

  await test('multi-line comment blocks become HTML comments in HTML mode', () => {
    const md = createParser();
    MarkdownItCommentPluginInstance.updateConvertMode('html' as never);
    const html = md.render('before\n%%\nhidden line\n%%\nafter\n');
    assertIncludes(html, '<!-- hidden line -->');
    MarkdownItCommentPluginInstance.updateConvertMode('ignore' as never);
  });

  await test('footnotes are rendered', () => {
    const md = createParser();
    const html = md.render('Text with a note[^1].\n\n[^1]: The note.\n');
    assertIncludes(html, 'footnote-ref');
    assertIncludes(html, 'The note.');
  });

  await test('wiki image embed with alt text renders img alt', () => {
    const md = createParser();
    assertEqual(
      md.renderInline('![[https://example.com/a.png|some picture]]'),
      '<img src="https://example.com/a.png" alt="some picture">'
    );
  });

  await test('wiki image embed with size renders dimensions', () => {
    const md = createParser();
    assertEqual(
      md.renderInline('![[https://example.com/a.png|300x200]]'),
      '<img src="https://example.com/a.png" width="300" height="200">'
    );
  });

  console.log('media refs:');

  await test('parses markdown images with title and parentheses', () => {
    const refs = getMediaRefs('![](\<img (1).png\> "the title")');
    assertEqual(refs.length, 1);
    assertEqual(refs[0].src, 'img (1).png');
    assertEqual(refs[0].syntax, 'markdown');
  });

  await test('parses markdown images with size in alt', () => {
    const refs = getMediaRefs('![alt|100x200](a.png)');
    assertEqual(refs[0].width, '100');
    assertEqual(refs[0].height, '200');
    assertEqual(refs[0].altText, 'alt');
  });

  await test('parses wiki embeds with size or alt', () => {
    const refs = getMediaRefs('![[a.png|300]] ![[b.png|some alt]] ![[c.png]]');
    assertEqual(refs.length, 3);
    assertEqual(refs[0].width, '300');
    assertEqual(refs[1].altText, 'some alt');
    assertEqual(refs[2].altText, undefined);
  });

  await test('detects http(s) urls', () => {
    const refs = getMediaRefs('![[https://example.com/a.png]] ![](http://example.com/b.png)');
    assertEqual(refs[0].isUrl, true);
    assertEqual(refs[1].isUrl, true);
  });

  await test('plain text links are not parsed as images', () => {
    assertEqual(getMediaRefs('just text').length, 0);
    assertEqual(getMediaRefs('[a normal link](https://example.com)').length, 0);
  });

  console.log('frontmatter & sections:');

  await test('strips frontmatter', () => {
    assertEqual(stripFrontmatter('---\ntitle: x\n---\nbody'), 'body');
  });

  await test('strips frontmatter with CRLF', () => {
    assertEqual(stripFrontmatter('---\r\ntitle: x\r\n---\r\nbody'), 'body');
  });

  await test('does not strip content when frontmatter is unterminated', () => {
    assertEqual(stripFrontmatter('---\nnot frontmatter'), '---\nnot frontmatter');
  });

  await test('a horizontal rule not at the start is untouched', () => {
    const content = 'text\n\n---\n\nmore';
    assertEqual(stripFrontmatter(content), content);
  });

  await test('extracts a heading section', () => {
    const content = '# One\none text\n## Two\ntwo text\n## Three\nthree text';
    assertEqual(extractSection(content, 'Two'), '## Two\ntwo text');
  });

  await test('extracts a block reference', () => {
    const content = 'first\n\nquoted line ^abc123\n\nafter';
    assertEqual(extractSection(content, '^abc123'), 'quoted line');
  });

  console.log('note embeds:');

  await test('expands note embeds recursively', async () => {
    const files: Record<string, string> = {
      'main.md': '# Main\n\n![[child]]\n',
      'child.md': 'child content ![[grandchild.png]]',
      'grandchild.png': 'PNGDATA',
    };
    const app = createFakeApp(files);
    const mainFile = new TFile('main.md');
    const result = await expandNoteEmbeds(app as never, mainFile, files[ 'main.md' ]);
    assertEqual(result.content, '# Main\n\nchild content ![[grandchild.png]]\n');
    assertEqual(result.failed, []);
  });

  await test('expands embeds with heading subpath', async () => {
    const files: Record<string, string> = {
      'main.md': 'start\n\n![[child#Section]]\n\nend',
      'child.md': '# Intro\nskip\n# Section\nwanted\nmore\n# Other\nno',
    };
    const app = createFakeApp(files);
    const result = await expandNoteEmbeds(app as never, new TFile('main.md'), files[ 'main.md' ]);
    assertEqual(result.content, 'start\n\n# Section\nwanted\nmore\n\nend');
  });

  await test('detects embed cycles', async () => {
    const files: Record<string, string> = {
      'a.md': 'A ![[b]]',
      'b.md': 'B ![[a]]',
    };
    const app = createFakeApp(files);
    const result = await expandNoteEmbeds(app as never, new TFile('a.md'), files[ 'a.md' ]);
    assertEqual(result.failed.length, 1);
  });

  await test('leaves non-markdown embeds alone', async () => {
    const files: Record<string, string> = {
      'main.md': 'see ![[image.png]]',
      'image.png': 'PNG',
    };
    const app = createFakeApp(files);
    const result = await expandNoteEmbeds(app as never, new TFile('main.md'), files[ 'main.md' ]);
    assertEqual(result.content, 'see ![[image.png]]');
  });

  await test('does not expand embeds inside inline code', async () => {
    const files: Record<string, string> = {
      'main.md': 'syntax: `![[child]]` and ![[child]]',
      'child.md': 'child content',
    };
    const app = createFakeApp(files);
    const result = await expandNoteEmbeds(app as never, new TFile('main.md'), files[ 'main.md' ]);
    assertEqual(result.content, 'syntax: `![[child]]` and child content');
    assertEqual(result.failed, []);
  });

  await test('does not expand embeds inside code fences', async () => {
    const files: Record<string, string> = {
      'main.md': '```\n![[child]]\n```\n\n![[child]]',
      'child.md': 'child content',
    };
    const app = createFakeApp(files);
    const result = await expandNoteEmbeds(app as never, new TFile('main.md'), files[ 'main.md' ]);
    assertEqual(result.content, '```\n![[child]]\n```\n\nchild content');
    assertEqual(result.failed, []);
  });

  await test('does not treat embeds in code as media refs', () => {
    const refs = getMediaRefs('code: `![[a.png]]` fence:\n\n```\n![[b.png]]\n```\n\nreal: ![[c.png]]');
    assertEqual(refs.length, 1);
    assertEqual(refs[0].src, 'c.png');
  });

  console.log('wikilink resolver:');

  await test('resolves published targets to permalinks', () => {
    const files: Record<string, string> = {
      'target.md': 'content',
    };
    const app = createFakeApp(files, {
      'target.md': { profileName: 'Blog', postLink: 'https://example.com/target/' },
    });
    const resolver = createWikiLinkResolver(app as never, { name: 'Blog' } as never, new TFile('main.md'));
    const resolution: WikiLinkResolution | undefined = resolver('target');
    assertEqual(resolution?.permalink, 'https://example.com/target/');
  });

  await test('does not resolve targets published with another profile', () => {
    const files: Record<string, string> = {
      'target.md': 'content',
    };
    const app = createFakeApp(files, {
      'target.md': { profileName: 'Other', postLink: 'https://other.example.com/target/' },
    });
    const resolver = createWikiLinkResolver(app as never, { name: 'Blog' } as never, new TFile('main.md'));
    assertEqual(resolver('target')?.permalink, undefined);
  });

  await test('splits wikilink targets', () => {
    assertEqual(splitWikiLinkTarget('note#head'), [ 'note', 'head' ]);
    assertEqual(splitWikiLinkTarget('note'), [ 'note', undefined ]);
  });

  console.log('mime types:');

  await test('resolves mime types by extension', () => {
    assertEqual(mimeTypeFor(new TFile('a.png')), 'image/png');
    assertEqual(mimeTypeFor(new TFile('a.mp4')), 'video/mp4');
    assertEqual(mimeTypeFor(new TFile('a.pdf')), 'application/pdf');
    assertEqual(mimeTypeFor(new TFile('a.weird')), 'application/octet-stream');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

function createFakeApp(
  files: Record<string, string>,
  frontmatters: Record<string, Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    metadataCache: {
      getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
        // resolve relative to the source folder, then by suffix match (shortest path)
        const clean = linkpath.replace(/^\.\//, '');
        const folder = sourcePath.includes('/') ? sourcePath.replace(/\/[^/]+$/, '') + '/' : '';
        const candidates: string[] = [];
        for (const base of [ folder + clean, clean ]) {
          candidates.push(base);
          candidates.push(`${base}.md`);
        }
        for (const candidate of candidates) {
          if (candidate in files) {
            return new TFile(candidate);
          }
        }
        const suffixMatch = Object.keys(files).find(path => path.endsWith('/' + clean) || path === clean);
        return suffixMatch ? new TFile(suffixMatch) : null;
      },
      getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
        const fm = frontmatters[ file.path ];
        return fm ? { frontmatter: fm } : null;
      },
    },
    vault: {
      async read(file: TFile): Promise<string> {
        return files[ file.path ] ?? '';
      },
    },
  };
}

main();
