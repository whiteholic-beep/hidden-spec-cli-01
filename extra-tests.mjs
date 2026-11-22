// Extra edge-case tests for mend, beyond the kit's 100 practice checks.
// Each case is hand-derived from SPEC.md sentences the practice set does not obviously cover.
// Run: node extra-tests.mjs
import { runCheck } from './runner.ts';

const T = [];
function t(name, argv, stdin, files, exit, stdout, outFiles) {
  T.push({ name, argv, stdin, files, exit, stdout, outFiles });
}

// --- Unified: parse errors ---
t('U1 hunk before section (--format=unified)', ['--format=unified', '-'], '@@ -1 +1 @@\n+hi\n', {}, 2, 'error: parse 1\n', {});
t('U2 --- without +++ in header', ['--format=unified', 'p.diff'], null, { 'p.diff': 'diff --git a/f b/f\n--- a/f\nindex 123\n@@ -1 +1 @@\n-a\n+b\n' }, 2, 'error: parse 3\n', { 'p.diff': 'diff --git a/f b/f\n--- a/f\nindex 123\n@@ -1 +1 @@\n-a\n+b\n' });
t('U3 malformed diff --git', ['--format=unified', '-'], 'diff --git x y\n@@ -1 +1 @@\n-a\n+b\n', {}, 2, 'error: parse 1\n', {});
t('U4 malformed @@', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -x +1 @@\n-a\n+b\n', {}, 2, 'error: parse 4\n', {});
t('U5 rename from/to move', ['--format=unified', '-'], 'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\n', { 'old.txt': 'hello\n' }, 0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'hello\n' });
t('U6 pure move no hunks', ['--format=unified', '-'], '--- a/old.txt\n+++ b/new.txt\n', { 'old.txt': 'hello\n' }, 0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'hello\n' });
t('U7 create with no-newline', ['--format=unified', '-'], 'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+line1\n+line2\n\\ No newline at end of file\n', {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'line1\nline2' });
t('U8 delete ignores hunks', ['--format=unified', '-'], 'diff --git a/f b/f\ndeleted file mode 100644\n--- a/f\n+++ /dev/null\n@@ -1,2 +1,0 @@\n-garbage\n-more garbage\n', { f: 'real\ncontent\n' }, 0, 'D f\nok: 1 file\n', { f: null });
t('U9 empty-O insert at top', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -0,0 +1 @@\n+top\n', { f: 'a\nb\n' }, 0, 'M f\nok: 1 file\n', { f: 'top\na\nb\n' });
t('U10 noeol after last add at EOF', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n', { f: 'a\nb' }, 0, 'M f\nok: 1 file\n', { f: 'a\nB' });
t('U11 noeol after del only', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n', { f: 'a\nb' }, 0, 'M f\nok: 1 file\n', { f: 'a\n' });
t('U12 diff --git paths fallback', ['--format=unified', '-'], 'diff --git a/f.txt b/f.txt\n@@ -1 +1 @@\n-a\n+b\n', { 'f.txt': 'a\n' }, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'b\n' });
t('U13 blank context line', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n', { f: 'a\n\nb\n' }, 0, 'M f\nok: 1 file\n', { f: 'a\n\nB\n' });
t('U14 --- line in body is a del line', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n x\n--- y\n+-- y!\n z\n', { f: 'x\n-- y\nz\n' }, 0, 'M f\nok: 1 file\n', { f: 'x\n-- y!\nz\n' });
t('U15 empty-O insert at end with noeol', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,0 +2 @@\n+b\n\\ No newline at end of file\n', { f: 'a\n' }, 0, 'M f\nok: 1 file\n', { f: 'a\nb' });
t('U16 noeol mid-file keeps final break', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n\\ No newline at end of file\n', { f: 'a\nb\nc\n' }, 0, 'M f\nok: 1 file\n', { f: 'A\nb\nc\n' });
t('U17 trailing blank lines end body', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n\n@@ -3 +3 @@\n-c\n+d\n', { f: 'a\nq\nc\n' }, 0, 'M f\nok: 1 file\n', { f: 'b\nq\nd\n' });

// --- SEARCH/REPLACE ---
t('S1 path from previous block', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n', { 'f.txt': 'a\nb\n' }, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\nB\n' });
t('S2 first block no path', ['--format=search-replace', '-'], '<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n', {}, 2, 'error: parse 1\n', {});
t('S3 SEARCH no =======', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\na\n>>>>>>> REPLACE\n', { 'f.txt': 'a\n' }, 2, 'error: parse 2\n', {});
t('S4 SEARCH no REPLACE', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\na\n=======\nA\n', { 'f.txt': 'a\n' }, 2, 'error: parse 2\n', {});
t('S5 fence line skipped as path', ['--format=search-replace', '-'], '```text\nf.txt\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n', { 'f.txt': 'a\n' }, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n' });
t('S6 empty old + exists', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\n=======\nnew\n>>>>>>> REPLACE\n', { 'f.txt': 'old\n' }, 1, 'error: exists f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'old\n' });
t('S7 ambiguous', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', { 'f.txt': 'x\nx\n' }, 1, 'error: ambiguous f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'x\nx\n' });
t('S8 marker trailing ws', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH   \na\n=======  \nA\n>>>>>>> REPLACE\t\n', { 'f.txt': 'a\n' }, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n' });
t('S9 CRLF preserved', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n', { 'f.txt': 'a\r\nb\r\n' }, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\r\nb\r\n' });

// --- V4A ---
t('V1 first line not Begin Patch', ['--format=v4a', '-'], 'hello\n*** End Patch\n', {}, 2, 'error: parse 1\n', {});
t('V2 last line not End Patch', ['--format=v4a', '-'], '*** Begin Patch\n*** Add File: x\n+y\n*** End Patch\ntrailing\n', {}, 2, 'error: parse 6\n', {});
t('V3 Begin+End only', ['--format=v4a', '-'], '*** Begin Patch\n*** End Patch\n', {}, 2, 'error: parse 1\n', {});
t('V4 add middle blank, trailing stripped', ['--format=v4a', '-'], '*** Begin Patch\n*** Add File: x\n+one\n\n+two\n\n\n*** End Patch\n', {}, 0, 'A x\nok: 1 file\n', { x: 'one\n\ntwo\n' });
t('V5 update move-to only', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** End Patch\n', { 'old.txt': 'hi\n' }, 0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'hi\n' });
t('V6 update no chunk no move', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: x\n*** End Patch\n', { x: 'hi\n' }, 2, 'error: parse 2\n', {});
t('V7 anchor moves cursor', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: f\n@@ anchor\n b\n-c\n+C\n*** End Patch\n', { f: 'a\nanchor\nb\nc\n' }, 0, 'M f\nok: 1 file\n', { f: 'a\nanchor\nb\nC\n' });
t('V8 EOF chunk takes end occurrence', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: f\n@@\n-a\n+A\n*** End of File\n*** End Patch\n', { f: 'a\nb\na\n' }, 0, 'M f\nok: 1 file\n', { f: 'a\nb\nA\n' });
t('V9 EOF chunk no end occurrence', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: f\n@@\n-a\n+A\n*** End of File\n*** End Patch\n', { f: 'a\nb\n' }, 1, 'error: no-match f\nfailed: 1 of 1 edits\n', { f: 'a\nb\n' });
t('V10 move-to after chunks', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: x\n@@\n-a\n+b\n*** Move to: y\n*** End Patch\n', { x: 'a\n' }, 2, 'error: parse 6\n', {});
t('V11 end-of-file with no chunk', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: x\n*** End of File\n*** End Patch\n', { x: 'a\n' }, 2, 'error: parse 3\n', {});
t('V12 empty anchor chunk', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: f\n@@\n-a\n+A\n*** End Patch\n', { f: 'a\nb\n' }, 0, 'M f\nok: 1 file\n', { f: 'A\nb\n' });
t('V13 two chunks cursor', ['--format=v4a', '-'], '*** Begin Patch\n*** Update File: f\n@@\n-a\n+A\n@@ b\n-c\n+C\n*** End Patch\n', { f: 'a\nb\nc\nd\n' }, 0, 'M f\nok: 1 file\n', { f: 'A\nb\nC\nd\n' });

// --- CLI / order / atomicity / detection ---
t('C1 -- ends options', ['--', '--check'], null, {}, 2, 'error: no-patch\n', {});
t('C2 failed edit, later runs, nothing written', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\nzzz\n=======\nZ\n>>>>>>> REPLACE\nf.txt\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n', { 'f.txt': 'a\n' }, 1, 'error: no-match f.txt\nfailed: 1 of 2 edits\n', { 'f.txt': 'a\n' });
t('C3 unsafe before missing', ['--format=unified', '-'], 'diff --git a/../evil b/../evil\n--- a/../evil\n+++ b/../evil\n@@ -1 +1 @@\n-a\n+b\n', {}, 1, 'error: unsafe ../evil\nfailed: 1 of 1 edits\n', {});
t('C4 create then modify in one patch', ['--format=search-replace', '-'], 'f.txt\n<<<<<<< SEARCH\n=======\na\n>>>>>>> REPLACE\nf.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n', {}, 0, 'A f.txt\nok: 1 file\n', { 'f.txt': 'b\n' });
t('C5 empty stdin --format=json', ['--format=json', '-'], '', {}, 2, 'error: parse 1\n', {});
t('C6 detection: Begin Patch wins', ['-'], '*** Begin Patch\ngarbage line\n*** End Patch\n', {}, 2, 'error: parse 2\n', {});
t('C7 --format=search-replace on unified', ['--format=search-replace', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n', { f: 'a\n' }, 2, 'error: parse 1\n', { f: 'a\n' });

// --- Tier 2 re-indent ---
t('T1 tier2 re-indent add lines', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n   x\n-  y\n+  z\n', { f: '\tx\n\ty\n' }, 0, 'M f\nok: 1 file\n', { f: '\tx\n\tz\n' });
t('T2 tier2 add line not starting with P', ['--format=unified', '-'], 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n   x\n-  y\n+q\n', { f: '\tx\n\ty\n' }, 0, 'M f\nok: 1 file\n', { f: '\tx\nq\n' });

let passed = 0;
for (const c of T) {
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin, files: c.files });
  const why = [];
  if (got.exit !== c.exit) why.push(`exit ${got.exit}, expected ${c.exit}`);
  if (got.stdout !== c.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.stdout)}`);
  const wantFiles = { ...c.files };
  for (const [p, v] of Object.entries(c.outFiles)) {
    if (v === null) delete wantFiles[p];
    else wantFiles[p] = v;
  }
  // files the check starts with that the expectation does not mention keep their start value
  for (const p of new Set([...Object.keys(wantFiles), ...Object.keys(got.files)])) {
    if (wantFiles[p] === undefined && got.files[p] === undefined) continue;
    if (wantFiles[p] === undefined) {
      // a file the CLI should not have created: only flag if it was not in the start files
      if (!(p in c.files)) why.push(`${p} should not exist, got ${JSON.stringify(got.files[p])}`);
      continue;
    }
    if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== wantFiles[p]) why.push(`${p} differs: expected ${JSON.stringify(wantFiles[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  if (why.length === 0) passed++;
  else process.stdout.write(`FAIL ${c.name}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`${passed} of ${T.length} extra tests passed\n`);
process.exit(passed === T.length ? 0 : 1);
