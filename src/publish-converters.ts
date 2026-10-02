import { App, TFile } from 'obsidian';
import fileTypeChecker from 'file-type-checker';
import { SafeAny, stripFrontmatter } from './utils';
import { WpProfile } from './wp-profile';
import { WikiLinkResolution } from './markdown-it-wikilink-plugin';

/**
 * The maximum depth of nested note embeds (`![[note]]`).
 */
const MAX_EMBED_DEPTH = 5;

/**
 * Media file extensions which should be rendered as images.
 */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'apng', 'ico',
]);

/**
 * Fallback mime types by file extension, used when the file type
 * cannot be detected from the binary content.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  apng: 'image/apng',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * A media reference found in note content, either Obsidian wiki
 * embed syntax `![[path|100|alt]]` or markdown image syntax
 * `![alt|100x200](<path> "title")`.
 */
export interface MediaRef {
  /**
   * The original text of the whole reference.
   */
  original: string;

  /**
   * The media linkpath, or URL for remote media.
   */
  src: string;

  altText?: string;

  width?: string;
  height?: string;

  isUrl: boolean;

  syntax: 'markdown' | 'wiki';
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(?:<([^<>]*)>|((?:[^()\s\\]|\([^()\s]*\))+))(?:\s+"([^"]*)")?\s*\)/g;
const WIKI_EMBED_RE = /!\[\[([^|\]\n]+)(?:\|([^\]\n]+))?\]\]/g;

/**
 * Returns the `[start, end)` ranges of fenced code blocks and inline
 * code spans in the content. Embed/media syntax inside code must be
 * left untouched, it is part of the code, not of the note structure.
 */
export function findCodeRanges(content: string): Array<[ number, number ]> {
  const ranges: Array<[ number, number ]> = [];

  // fenced code blocks (``` or ~~~)
  const fenceRe = /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*/g;
  let open: { start: number, mark: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(content)) !== null) {
    const lineStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const mark = match[1];
    if (open === null) {
      open = { start: lineStart, mark };
    } else if (mark[0] === open.mark[0] && mark.length >= open.mark.length) {
      ranges.push([ open.start, match.index + match[0].length ]);
      open = null;
    }
  }
  if (open !== null) {
    ranges.push([ open.start, content.length ]);
  }

  // inline code spans, only outside of fenced blocks
  const inlineRe = /`+[^`\n]*`+/g;
  while ((match = inlineRe.exec(content)) !== null) {
    if (ranges.some(([ start, end ]) => match!.index >= start && match!.index < end)) {
      continue;
    }
    ranges.push([ match.index, match.index + match[0].length ]);
  }
  return ranges;
}

function inRanges(index: number, ranges: Array<[ number, number ]>): boolean {
  return ranges.some(([ start, end ]) => index >= start && index < end);
}

/**
 * Extracts all media references from the content. References inside
 * code fences and inline code spans are ignored.
 */
export function getMediaRefs(content: string): MediaRef[] {
  const refs: MediaRef[] = [];
  const codeRanges = findCodeRanges(content);

  let match: RegExpExecArray | null;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  while ((match = MARKDOWN_IMAGE_RE.exec(content)) !== null) {
    if (inRanges(match.index, codeRanges)) {
      continue;
    }
    // match groups: 1 = alt, 2 = braced path, 3 = bare path, 4 = title
    const src = (match[2] ?? match[3] ?? '').trim();
    if (src.length === 0) {
      continue;
    }
    let altText: string | undefined = match[1];
    let width: string | undefined;
    let height: string | undefined;
    // Obsidian allows size in the alt text: ![alt|100x200](path)
    const sizeSep = altText.lastIndexOf('|');
    if (sizeSep >= 0) {
      const size = altText.substring(sizeSep + 1).trim();
      if (/^\d+(x\d+)?$/.test(size)) {
        altText = altText.substring(0, sizeSep).trim();
        const sizeParts = size.split('x');
        width = sizeParts[0];
        height = sizeParts[1];
      }
    }
    refs.push({
      original: match[0],
      src,
      altText: altText?.length ? altText : undefined,
      width,
      height,
      isUrl: isValidHttpUrl(src),
      syntax: 'markdown',
    });
  }

  WIKI_EMBED_RE.lastIndex = 0;
  while ((match = WIKI_EMBED_RE.exec(content)) !== null) {
    if (inRanges(match.index, codeRanges)) {
      continue;
    }
    const src = match[1].trim();
    // match[2] could be a size (`100` or `100x200`) or an alt text
    let altText: string | undefined;
    let width: string | undefined;
    let height: string | undefined;
    const suffix = match[2]?.trim();
    if (suffix) {
      if (/^\d+(x\d+)?$/.test(suffix)) {
        const sizeParts = suffix.split('x');
        width = sizeParts[0];
        height = sizeParts[1];
      } else {
        altText = suffix;
      }
    }
    refs.push({
      original: match[0],
      src,
      altText,
      width,
      height,
      isUrl: isValidHttpUrl(src),
      syntax: 'wiki',
    });
  }

  return refs;
}

/**
 * Decodes a media src. Returns the original string if it is not
 * a valid encoded URI (e.g. it contains a bare `%`).
 */
export function decodeMediaSrc(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

export function mimeTypeFor(file: TFile, content?: ArrayBuffer): string {
  const byExt = MIME_BY_EXTENSION[file.extension.toLowerCase()];
  if (byExt) {
    return byExt;
  }
  if (content) {
    const detected = fileTypeChecker.detectFile(content);
    if (detected?.mimeType) {
      return detected.mimeType;
    }
  }
  return 'application/octet-stream';
}

export function isImageFile(file: TFile): boolean {
  return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extracts the section under a heading (or a block reference) from
 * the note content. Returns `undefined` if the heading is not found.
 */
export function extractSection(content: string, subpath: string): string | undefined {
  if (subpath.startsWith('^')) {
    // block reference
    const blockId = subpath.substring(1);
    return extractBlockReference(content, blockId);
  }

  const lines = content.split(/\r?\n/);
  const headingRe = /^(#{1,6})\s+(.*)$/;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === subpath.trim().toLowerCase()) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) {
    return undefined;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function extractBlockReference(content: string, blockId: string): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].endsWith(`^${blockId}`)) {
      let line = lines[i].replace(/\s\^[\w-]+$/, '');
      // merge list items of the following lines which belong to this block
      const isList = /^(\s*[-*+]|\s*\d+\.)\s/.test(line);
      if (isList) {
        let end = i + 1;
        while (end < lines.length && /^(\s+([-*+]|\d+\.)\s|\s{2,}\S)/.test(lines[end])) {
          end++;
        }
        line = lines.slice(i, end).map(it => it.replace(/\s\^[\w-]+$/, '')).join('\n');
      }
      return line.trim();
    }
  }
  return undefined;
}

export interface EmbedExpandResult {
  content: string;

  /**
   * Paths of notes which could not be embedded (not found or cyclic).
   */
  failed: string[];
}

/**
 * Recursively expands Obsidian note embeds `![[note]]` and
 * `![[note#heading]]` into the note content.
 *
 * Markdown note embeds are not media files and must not be uploaded
 * to the WordPress media library. Embeds of non-markdown files are
 * left untouched, they are handled by the media upload pipeline.
 */
export async function expandNoteEmbeds(
  app: App,
  sourceFile: TFile,
  content: string,
  options: {
    depth?: number;
    visited?: Set<string>;
  } = {}
): Promise<EmbedExpandResult> {
  const depth = options.depth ?? 0;
  const visited = options.visited ?? new Set<string>([ sourceFile.path ]);
  const failed: string[] = [];

  if (depth > MAX_EMBED_DEPTH) {
    return { content, failed: [] };
  }

  const embedRe = /!\[\[([^\][|\n]+?)(#[^\][|\n]*)?(?:\|[^\][\n]*)?\]\]/g;
  // collect matches first, then replace from the last one to keep indices valid
  const matches = [ ...content.matchAll(embedRe) ].reverse();
  const codeRanges = findCodeRanges(content);

  let result = content;
  for (const match of matches) {
    const original = match[0];
    const target = match[1];
    const subpath = match[2];
    const matchIndex = match.index ?? 0;
    if (inRanges(matchIndex, codeRanges)) {
      // embeds inside code fences or inline code are part of the code
      continue;
    }
    const dest = app.metadataCache.getFirstLinkpathDest(target.trim(), sourceFile.path);
    if (!(dest instanceof TFile) || dest.extension !== 'md') {
      continue;
    }
    if (visited.has(dest.path)) {
      failed.push(target.trim());
      continue;
    }
    visited.add(dest.path);
    try {
      let embedded = stripFrontmatter(await app.vault.read(dest));
      if (subpath) {
        const section = extractSection(embedded, subpath.substring(1));
        if (section !== undefined) {
          embedded = section;
        }
      }
      const nested = await expandNoteEmbeds(app, dest, embedded, {
        depth: depth + 1,
        visited,
      });
      failed.push(...nested.failed);
      result = result.substring(0, matchIndex) + nested.content + result.substring(matchIndex + original.length);
    } finally {
      visited.delete(dest.path);
    }
  }

  return { content: result, failed };
}

/**
 * Creates a wikilink resolver used by the wikilink markdown-it plugin.
 *
 * A wikilink is converted to a permalink when its target note has been
 * published with the same profile. Unpublished targets are rendered
 * as plain text.
 */
export function createWikiLinkResolver(
  app: App,
  profile: WpProfile,
  sourceFile: TFile
): (linkpath: string) => WikiLinkResolution | undefined {
  return (linkpath: string): WikiLinkResolution | undefined => {
    const hashIndex = linkpath.indexOf('#');
    const path = hashIndex >= 0 ? linkpath.substring(0, hashIndex) : linkpath;
    const subpath = hashIndex >= 0 ? linkpath.substring(hashIndex + 1) : undefined;

    const dest = app.metadataCache.getFirstLinkpathDest(path, sourceFile.path);
    if (!dest) {
      return { exists: false, subpath };
    }
    const frontmatter: SafeAny = app.metadataCache.getFileCache(dest)?.frontmatter;
    const permalink = typeof frontmatter?.postLink === 'string' ? frontmatter.postLink : undefined;
    const publishedWithSameProfile = !frontmatter?.profileName || frontmatter.profileName === profile.name;
    return {
      exists: true,
      permalink: publishedWithSameProfile ? permalink : undefined,
      subpath,
    };
  };
}
