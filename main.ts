// main.ts is mend, the CLI SPEC.md specifies. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// It implements all of SPEC.md: the command line, the output and exit codes, safe paths, format detection,
// line matching at three tiers (section 5), unified diffs (section 6), SEARCH/REPLACE blocks (section 7),
// V4A patches (section 8), JSON edits (section 9) and the all-or-nothing write (section 10).
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly moves: Array<[string, string]> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/* ------------------------------------------------------------------ */
/* Files as lines (SPEC.md section 3)                                  */
/* ------------------------------------------------------------------ */

interface FileModel {
  br: string;
  lines: string[];
  final: boolean;
}

function splitFile(text: string): FileModel {
  if (text === '') return { br: '\n', lines: [], final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { br, lines: parts, final };
}

function joinFile(m: FileModel): string {
  if (m.lines.length === 0) return '';
  return m.lines.join(m.br) + (m.final ? m.br : '');
}

/* ------------------------------------------------------------------ */
/* Matching lines (SPEC.md section 5)                                  */
/* ------------------------------------------------------------------ */

function trimEndWS(s: string): string {
  return s.replace(/[ \t]+$/, '');
}
function trimWS(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}
function leadingWS(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : '';
}
function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return trimEndWS(a) === trimEndWS(b);
  return trimWS(a) === trimWS(b);
}

function occurrences(O: string[], lines: string[], tier: number, from = 0): number[] {
  const out: number[] = [];
  if (O.length === 0) return out;
  for (let i = from; i + O.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < O.length; j++) {
      if (!lineEq(O[j]!, lines[i + j]!, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier (0, or 0..2 unless strict) at which O occurs at least once, at or after `from`. */
function findTier(O: string[], lines: string[], strict: boolean, from = 0): { tier: number; occ: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const occ = occurrences(O, lines, t, from);
    if (occ.length > 0) return { tier: t, occ };
  }
  return null;
}

/** One body line of a hunk/chunk: context, removed, or added. `noNL` is set by a `\` line after it. */
interface BodyItem {
  kind: 'ctx' | 'del' | 'add';
  text: string;
  noNL: boolean;
}

/**
 * Build the replacement lines for a matched occurrence: context lines are the file's own matched lines;
 * added lines are the patch's, re-indented at tier 2 (section 5).
 */
function buildReplacement(items: BodyItem[], fileLines: string[], occPos: number, tier: number): string[] {
  const O = items.filter((i) => i.kind !== 'add').map((i) => i.text);
  const F = leadingWS(fileLines[occPos]!);
  const P = O.length > 0 ? leadingWS(O[0]!) : '';
  const rep: string[] = [];
  let oi = 0;
  for (const it of items) {
    if (it.kind === 'ctx') {
      rep.push(fileLines[occPos + oi]!);
      oi++;
    } else if (it.kind === 'del') {
      oi++;
    } else {
      let t = it.text;
      if (tier === 2 && t !== '' && t.trim() !== '' && t.startsWith(P)) t = F + t.slice(P.length);
      rep.push(t);
    }
  }
  return rep;
}

/** Whether a `\` line follows the hunk/chunk's last context or `+` line. */
function lastNoNL(items: BodyItem[]): boolean {
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]!;
    if (it.kind === 'ctx' || it.kind === 'add') return it.noNL;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* JSON edits (SPEC.md section 9) — as in the starter                  */
/* ------------------------------------------------------------------ */

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/* ------------------------------------------------------------------ */
/* Unified diffs (SPEC.md section 6)                                   */
/* ------------------------------------------------------------------ */

interface Hunk {
  A: number;
  items: BodyItem[];
}

interface Section {
  diffOld: string | undefined;
  diffNew: string | undefined;
  markOld: string | undefined;
  markNew: string | undefined;
  renOld: string | undefined;
  renNew: string | undefined;
  isCreate: boolean;
  isDelete: boolean;
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** The path after `--- ` / `+++ `: text after the four characters, up to the first tab, trimmed, a/ or b/ removed. */
function markerPath(line: string): string {
  let p = line.slice(4).split('\t')[0]!.trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function resolvePaths(sec: Section): { oldP: string | null; newP: string | null } {
  const conv = (s: string | undefined): string | null => (s === undefined ? null : s === '/dev/null' ? null : s);
  return { oldP: conv(sec.markOld ?? sec.renOld ?? sec.diffOld), newP: conv(sec.markNew ?? sec.renNew ?? sec.diffNew) };
}

/** Parse one hunk body starting at `start` (the line after the `@@` header). Returns the items and the next index. */
function parseHunkBody(lines: string[], start: number): { items: BodyItem[]; next: number } {
  const items: BodyItem[] = [];
  let j = start;
  while (j < lines.length) {
    const l = lines[j]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && j + 1 < lines.length && lines[j + 1]!.startsWith('+++ ')) break;
    if (l === '') {
      items.push({ kind: 'ctx', text: '', noNL: false });
      j++;
      continue;
    }
    const c = l[0]!;
    if (c === ' ') {
      items.push({ kind: 'ctx', text: l.slice(1), noNL: false });
      j++;
      continue;
    }
    if (c === '-') {
      items.push({ kind: 'del', text: l.slice(1), noNL: false });
      j++;
      continue;
    }
    if (c === '+') {
      items.push({ kind: 'add', text: l.slice(1), noNL: false });
      j++;
      continue;
    }
    if (c === '\\') {
      if (items.length > 0) items[items.length - 1]!.noNL = true;
      j++;
      continue;
    }
    break;
  }
  // Empty lines at the end of a body are not part of it.
  while (items.length > 0 && items[items.length - 1]!.kind === 'ctx' && items[items.length - 1]!.text === '') items.pop();
  return { items, next: j };
}

function parseUnified(lines: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inHeader = false;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      cur = { diffOld: m[1]!.trim(), diffNew: m[2]!.trim(), markOld: undefined, markNew: undefined, renOld: undefined, renNew: undefined, isCreate: false, isDelete: false, hunks: [] };
      sections.push(cur);
      inHeader = true;
      i++;
      continue;
    }
    if (cur === null) {
      if (line.startsWith('--- ') && i + 1 < n && lines[i + 1]!.startsWith('+++ ')) {
        cur = { diffOld: undefined, diffNew: undefined, markOld: undefined, markNew: undefined, renOld: undefined, renNew: undefined, isCreate: false, isDelete: false, hunks: [] };
        sections.push(cur);
        inHeader = true;
        continue; // re-process the --- line as a header line
      }
      if (line.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
      i++; // prose ignored
      continue;
    }
    if (inHeader) {
      if (line.startsWith('@@')) {
        const m = HUNK_RE.exec(line);
        if (!m) throw new Exit2(`error: parse ${i + 1}`);
        const body = parseHunkBody(lines, i + 1);
        cur.hunks.push({ A: Number(m[1]), items: body.items });
        i = body.next;
        inHeader = false;
        continue;
      }
      if (line.startsWith('--- ')) {
        if (i + 1 < n && lines[i + 1]!.startsWith('+++ ')) {
          cur.markOld = markerPath(line);
          cur.markNew = markerPath(lines[i + 1]!);
          i += 2;
          continue;
        }
        throw new Exit2(`error: parse ${i + 2}`);
      }
      if (line.startsWith('rename from ')) {
        cur.renOld = line.slice(12).trim();
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        cur.renNew = line.slice(10).trim();
        i++;
        continue;
      }
      if (line === 'new file mode' || line.startsWith('new file mode ')) {
        cur.isCreate = true;
        i++;
        continue;
      }
      if (line === 'deleted file mode' || line.startsWith('deleted file mode ')) {
        cur.isDelete = true;
        i++;
        continue;
      }
      i++; // index, modes, similarity, Index:, any other line: ignored
      continue;
    }
    // In a section, after its hunks started.
    if (line.startsWith('--- ') && i + 1 < n && lines[i + 1]!.startsWith('+++ ')) {
      cur = null;
      continue; // re-process as a new section start
    }
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      const body = parseHunkBody(lines, i + 1);
      cur.hunks.push({ A: Number(m[1]), items: body.items });
      i = body.next;
      continue;
    }
    i++; // prose ignored
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((sec) => unifiedEdit(sec, strict));
}

/** Apply one hunk to a file model; `d` is the drift of earlier hunks in this section. */
function applyHunk(h: Hunk, m: FileModel, d: number, strict: boolean, path: string): FileModel {
  const O = h.items.filter((i) => i.kind !== 'add').map((i) => i.text);
  const N = h.items.filter((i) => i.kind !== 'del').map((i) => i.text);
  const noNL = lastNoNL(h.items);
  const lines = m.lines.slice();
  let final = m.final;
  if (O.length === 0) {
    const pos = Math.max(0, Math.min(h.A + d, lines.length));
    lines.splice(pos, 0, ...N);
    if (pos === lines.length - N.length) final = !noNL;
    return { br: m.br, lines, final };
  }
  const found = findTier(O, lines, strict);
  if (!found) throw new Fail('no-match', path);
  const target = h.A - 1 + d;
  let best = found.occ[0]!;
  for (const p of found.occ) {
    if (Math.abs(p - target) < Math.abs(best - target)) best = p;
  }
  const runsToEnd = best + O.length === lines.length;
  const rep = buildReplacement(h.items, lines, best, found.tier);
  lines.splice(best, O.length, ...rep);
  if (runsToEnd) final = !noNL;
  return { br: m.br, lines, final };
}

function applyHunks(sec: Section, model: FileModel, path: string, strict: boolean): FileModel {
  let d = 0;
  let m = model;
  for (const h of sec.hunks) {
    const oLen = h.items.filter((i) => i.kind !== 'add').length;
    const nLen = h.items.filter((i) => i.kind !== 'del').length;
    m = applyHunk(h, m, d, strict, path);
    d += nLen - oLen;
  }
  return m;
}

function unifiedEdit(sec: Section, strict: boolean): Edit {
  return (tree) => {
    const { oldP, newP } = resolvePaths(sec);
    if (oldP !== null && !safe(oldP)) throw new Fail('unsafe', oldP);
    if (newP !== null && !safe(newP)) throw new Fail('unsafe', newP);
    const isCreate = sec.isCreate || oldP === null;
    const isDelete = sec.isDelete || newP === null;
    if (isCreate && newP !== null) {
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const plus: string[] = [];
      let lastNoNL = false;
      for (const h of sec.hunks) {
        for (const it of h.items) {
          if (it.kind === 'add') {
            plus.push(it.text);
            lastNoNL = it.noNL;
          }
        }
      }
      tree.now.set(newP, plus.length === 0 ? '' : plus.join('\n') + (lastNoNL ? '' : '\n'));
      return;
    }
    if (isDelete && oldP !== null) {
      if (tree.get(oldP) === null) throw new Fail('missing', oldP);
      tree.now.set(oldP, null);
      return;
    }
    if (oldP === null || newP === null) return; // both /dev/null: nothing to do
    if (oldP !== newP) {
      // Move: old exists, new does not; hunks apply to the old file's lines.
      const cur = tree.get(oldP);
      if (cur === null) throw new Fail('missing', oldP);
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const model = applyHunks(sec, splitFile(cur), oldP, strict);
      tree.now.set(oldP, null);
      tree.now.set(newP, joinFile(model));
      tree.moves.push([oldP, newP]);
      return;
    }
    // Change of the one path.
    const cur = tree.get(oldP);
    if (cur === null) throw new Fail('missing', oldP);
    const model = applyHunks(sec, splitFile(cur), oldP, strict);
    tree.now.set(oldP, joinFile(model));
  };
}

/* ------------------------------------------------------------------ */
/* SEARCH/REPLACE blocks (SPEC.md section 7)                           */
/* ------------------------------------------------------------------ */

function srEdit(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (oldLines.length === 0) {
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
      return;
    }
    const cur = tree.get(path);
    if (cur === null) throw new Fail('missing', path);
    const m = splitFile(cur);
    const found = findTier(oldLines, m.lines, strict);
    if (!found) throw new Fail('no-match', path);
    if (found.occ.length > 1) throw new Fail('ambiguous', path);
    const occPos = found.occ[0]!;
    const items: BodyItem[] = [
      ...oldLines.map((t): BodyItem => ({ kind: 'del' as const, text: t, noNL: false })),
      ...newLines.map((t): BodyItem => ({ kind: 'add' as const, text: t, noNL: false })),
    ];
    const rep = buildReplacement(items, m.lines, occPos, found.tier);
    const lines = m.lines.slice();
    lines.splice(occPos, oldLines.length, ...rep);
    tree.now.set(path, joinFile({ br: m.br, lines, final: m.final }));
  };
}

function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let searchFrom = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const searchLine = i;
    let path: string | null = null;
    for (let j = searchLine - 1; j >= searchFrom; j--) {
      const t = lines[j]!.trim();
      if (t === '') continue;
      if (t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) {
      if (prevPath === null) throw new Exit2(`error: parse ${searchLine + 1}`);
      path = prevPath;
    }
    let sep = -1;
    for (let j = searchLine + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '=======') {
        sep = j;
        break;
      }
    }
    if (sep < 0) throw new Exit2(`error: parse ${searchLine + 1}`);
    let end = -1;
    for (let j = sep + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
        end = j;
        break;
      }
    }
    if (end < 0) throw new Exit2(`error: parse ${searchLine + 1}`);
    const oldLines = lines.slice(searchLine + 1, sep);
    const newLines = lines.slice(sep + 1, end);
    edits.push(srEdit(path, oldLines, newLines, strict));
    prevPath = path;
    searchFrom = end + 1;
    i = end + 1;
  }
  if (edits.length === 0) throw new Exit2('error: parse 1');
  return edits;
}

/* ------------------------------------------------------------------ */
/* V4A patches (SPEC.md section 8)                                     */
/* ------------------------------------------------------------------ */

interface VChunk {
  anchor: string | null;
  items: BodyItem[];
  eof: boolean;
}

function v4aEdit(path: string, moveTo: string | null, chunks: VChunk[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const cur = tree.get(path);
    if (cur === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    const m = splitFile(cur);
    const lines = m.lines.slice();
    let cursor = 0;
    for (const ch of chunks) {
      if (ch.anchor !== null) {
        const a = findTier([ch.anchor], lines, strict, cursor);
        if (!a) throw new Fail('no-match', path);
        cursor = a.occ[0]! + 1;
      }
      const O = ch.items.filter((i) => i.kind !== 'add').map((i) => i.text);
      const N = ch.items.filter((i) => i.kind !== 'del').map((i) => i.text);
      if (O.length === 0) {
        const pos = ch.eof ? lines.length : cursor;
        lines.splice(pos, 0, ...N);
        cursor = pos + N.length;
        continue;
      }
      const found = findTier(O, lines, strict, cursor);
      if (!found) throw new Fail('no-match', path);
      let occPos: number | undefined;
      for (const p of found.occ) {
        if (ch.eof && p + O.length !== lines.length) continue;
        occPos = p;
        break;
      }
      if (occPos === undefined) throw new Fail('no-match', path);
      const rep = buildReplacement(ch.items, lines, occPos, found.tier);
      lines.splice(occPos, O.length, ...rep);
      cursor = occPos + rep.length;
    }
    const out = joinFile({ br: m.br, lines, final: m.final });
    if (moveTo !== null) {
      tree.now.set(path, null);
      tree.now.set(moveTo, out);
      tree.moves.push([path, moveTo]);
    } else {
      tree.now.set(path, out);
    }
  };
}

function parseV4a(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() !== '') {
      last = i;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    let kind: 'add' | 'del' | 'upd';
    let path: string;
    if (line.startsWith('*** Add File:')) {
      kind = 'add';
      path = line.slice(13).trim();
    } else if (line.startsWith('*** Delete File:')) {
      kind = 'del';
      path = line.slice(16).trim();
    } else if (line.startsWith('*** Update File:')) {
      kind = 'upd';
      path = line.slice(16).trim();
    } else {
      throw new Exit2(`error: parse ${i + 1}`);
    }
    const headerLine = i;
    i++;
    if (kind === 'add') {
      const fileLines: string[] = [];
      while (i < last) {
        const l = lines[i]!;
        if (l.trim() === '') {
          fileLines.push('');
          i++;
          continue;
        }
        if (l.startsWith('*** Add File:') || l.startsWith('*** Delete File:') || l.startsWith('*** Update File:') || l.trim() === '*** End Patch') break;
        if (!l.startsWith('+')) throw new Exit2(`error: parse ${i + 1}`);
        fileLines.push(l.slice(1));
        i++;
      }
      while (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') fileLines.pop();
      const fl = fileLines;
      const p = path;
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) !== null) throw new Fail('exists', p);
        tree.now.set(p, fl.length === 0 ? '' : fl.join('\n') + '\n');
      });
      continue;
    }
    if (kind === 'del') {
      while (i < last) {
        if (lines[i]!.trim() === '') {
          i++;
          continue;
        }
        break;
      }
      const p = path;
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) === null) throw new Fail('missing', p);
        tree.now.set(p, null);
      });
      continue;
    }
    // Update File
    let moveTo: string | null = null;
    const chunks: VChunk[] = [];
    let cur: VChunk | null = null;
    let seenBody = false;
    while (i < last) {
      const l = lines[i]!;
      if (l.trim() === '') {
        if (cur !== null) cur.items.push({ kind: 'ctx', text: '', noNL: false });
        i++;
        continue;
      }
      if (l.startsWith('*** Add File:') || l.startsWith('*** Delete File:') || l.startsWith('*** Update File:') || l.trim() === '*** End Patch') break;
      if (l.startsWith('*** Move to:')) {
        if (seenBody || cur !== null || moveTo !== null) throw new Exit2(`error: parse ${i + 1}`);
        moveTo = l.slice(12).trim();
        i++;
        continue;
      }
      if (l.trimEnd() === '*** End of File') {
        if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
        cur.eof = true;
        cur = null;
        i++;
        continue;
      }
      if (l.startsWith('@@')) {
        cur = { anchor: l.slice(2).trim() === '' ? null : l.slice(2).trim(), items: [], eof: false };
        chunks.push(cur);
        seenBody = true;
        i++;
        continue;
      }
      const c = l[0]!;
      if (c === ' ' || c === '-' || c === '+') {
        if (cur === null) {
          cur = { anchor: null, items: [], eof: false };
          chunks.push(cur);
        }
        seenBody = true;
        cur.items.push({ kind: c === ' ' ? 'ctx' : c === '-' ? 'del' : 'add', text: l.slice(1), noNL: false });
        i++;
        continue;
      }
      throw new Exit2(`error: parse ${i + 1}`);
    }
    if (chunks.length > 0) {
      const lc = chunks[chunks.length - 1]!;
      while (lc.items.length > 0 && lc.items[lc.items.length - 1]!.kind === 'ctx' && lc.items[lc.items.length - 1]!.text === '') lc.items.pop();
    }
    if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${headerLine + 1}`);
    edits.push(v4aEdit(path, moveTo, chunks, strict));
  }
  if (edits.length === 0) throw new Exit2('error: parse 1');
  return edits;
}

/* ------------------------------------------------------------------ */
/* Running (SPEC.md sections 1, 2 and 10)                              */
/* ------------------------------------------------------------------ */

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines, strict);
    else if (kind === 'search-replace') edits = parseSearchReplace(lines, strict);
    else edits = parseV4a(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const movesBefore = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = movesBefore;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // Rows: one per changed path, byte order; a successful move collapses its D and A into one R row sorted by the new path.
  const rMoves: Array<[string, string]> = [];
  for (const [o, n] of tree.moves) {
    if (tree.original(o) !== null && tree.original(n) === null && tree.now.get(o) === null && tree.now.get(n) !== null) rMoves.push([o, n]);
  }
  const rOlds = new Set(rMoves.map(([o]) => o));
  const rNews = new Set(rMoves.map(([, n]) => n));
  const rows: { key: string; line: string }[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    if (!check) {
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
    if (rOlds.has(p) || rNews.has(p)) continue; // covered by an R row, but the change is still written
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  for (const [o, n] of rMoves) rows.push({ key: n, line: `R ${o} -> ${n}` });
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
