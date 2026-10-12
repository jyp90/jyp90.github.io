#!/usr/bin/env bash
# Reader-facing format gate for blog drafts (scan.sh is the de-identification gate; run both).
# Usage: lint.sh <draft.markdown>...   Exit 0 clean, 1 findings, 2 unreadable file.
# Rules come from references/style.md 「Front matter」 and references/reader-bar.md.
set -u
export LC_ALL=en_US.UTF-8
[ $# -gt 0 ] || { echo "usage: lint.sh <draft.markdown>..." >&2; exit 2; }
rc=0
for f in "$@"; do
  [ -f "$f" ] && [ -r "$f" ] || { echo "cannot read: $f" >&2; exit 2; }
  python3 - "$f" <<'EOF' || rc=1
import re, sys
f = sys.argv[1]
s = open(f, encoding='utf-8').read()
out = []
def bad(line, msg): out.append(f"{f}:{line}: {msg}")
m = re.match(r'---\n(.*?)\n---\n', s, re.S)
if not m:
    bad(1, 'front matter missing'); print('\n'.join(out)); sys.exit(1)
fm, body_start = m.group(1), m.group(0).count('\n') + 1
def field(k):
    r = re.search(rf'^{k}:\s*(.*)$', fm, re.M)
    return r.group(1).strip() if r else None
for k in ('layout', 'title', 'date', 'categories', 'tags', 'excerpt', 'summary'):
    if field(k) is None: bad(1, f'front matter: {k} missing')
if field('categories') not in (None, 'blog'): bad(1, 'categories must be blog')
ex = (field('excerpt') or '').strip('"')
if len(ex) > 140: bad(1, f'excerpt {len(ex)} chars > 140 (home list truncates at 140)')
summ = re.search(r'^summary:\s*\n((?:\s+-\s.*\n?)+)', fm + '\n', re.M)
if field('summary') is not None:
    items = re.findall(r'^\s+-\s+"?(.*?)"?\s*$', summ.group(1), re.M) if summ else []
    if len(items) != 3: bad(1, f'summary must have exactly 3 items (found {len(items)})')
    for it in items:
        if len(it) > 75: bad(1, f'summary item {len(it)} chars > 75: {it[:30]}…')
        if not re.search(r'(니다|습니다)\.?$', it): bad(1, f'summary item not 합니다체: {it[:30]}…')
title = (field('title') or '').strip('"')
series = (field('series') or '').strip('"')
if series and not title.startswith(series):
    bad(1, 'title must start with the series name (series nav strips it)')
fence = False
for i, l in enumerate(s[m.end():].split('\n'), body_start):
    if l.startswith('```'):
        if not fence and l.strip() == '```': bad(i, 'code fence without language tag')
        fence = not fence; continue
    if fence: continue
    if re.match(r'^# ', l): bad(i, 'h1 in body (layout prints the title)')
    if re.match(r'^> \*\*(시리즈|연재)', l): bad(i, 'hand-written series TOC (set series: in front matter)')
    if re.search(r'oai_citation|utm_source=chatgpt|￼|⸻', l): bad(i, 'chat-assistant paste artifact')
    if re.match(r'^\t+(•|\d+\.)\t', l): bad(i, 'tab bullet (pasted list; use "- " or "1. ")')
if out: print('\n'.join(out)); sys.exit(1)
EOF
done
exit $rc
