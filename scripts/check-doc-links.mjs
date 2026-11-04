#!/usr/bin/env node
// Asserts that every relative link and image in README.md and docs/evidence/**/*.md resolves to a file in the repository (and, for a
// link to a Markdown heading, that the heading exists). External URLs are not fetched. Code blocks are ignored.
//   npm run evidence:links
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
});

export const slug = (h) => h.trim().toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

function headings(text) {
  const out = new Set();
  const seen = {};
  for (const m of stripCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const s = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    out.add(seen[s] ? `${s}-${seen[s]}` : s);
    seen[s] = (seen[s] ?? 0) + 1;
  }
  return out;
}
const stripCode = (t) => t.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

/** Returns [{file, line, target, reason}] for every broken relative link. */
export function checkLinks(root, files) {
  const broken = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const clean = stripCode(text);
    const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img[^>]+src="([^"]+)"|<a[^>]+href="([^"]+)"/g;
    for (const m of clean.matchAll(re)) {
      const target = m[1] ?? m[2] ?? m[3];
      if (/^(https?:|mailto:|data:|\/\/)/.test(target)) continue;
      const line = clean.slice(0, m.index).split('\n').length;
      const [pathPart, anchor] = target.split('#');
      const dest = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : file;
      if (!existsSync(dest)) { broken.push({ file: relative(root, file), line, target, reason: 'file not found' }); continue; }
      if (anchor && dest.endsWith('.md') && !headings(readFileSync(dest, 'utf8')).has(anchor.toLowerCase())) broken.push({ file: relative(root, file), line, target, reason: 'heading not found' });
    }
  }
  return broken;
}

export function docFiles(root) {
  return [join(root, 'README.md'), ...walk(join(root, 'docs/evidence'))];
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = docFiles(root);
  const broken = checkLinks(root, files);
  for (const b of broken) console.error(`${b.file}:${b.line}  ${b.target}  (${b.reason})`);
  console.log(`${files.length} Markdown files checked, ${broken.length} broken relative link(s)`);
  process.exit(broken.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
