# Mining sources (read-only)

Everything here only reads. Evidence (commit lists, excerpts, file paths) goes to files in the session scratchpad directory, never into a repo and never into the draft. Do not print work emails or forbidden terms in chat: write them to scratchpad files. Shell variables do not survive between Bash tool calls, so every block below sets `SP=<scratchpad>` and reads the lists from files.

## Workspace sweep (default source)
The work workspace is one git repo holding the knowledge base and the source code as submodules. Its paths live only in `~/.config/tech-blog/kb.txt` (private; never commit or print them into a draft or chat):
```
workspace=<absolute path of the work workspace repo>
root=<absolute path of the knowledge base inside it>
candidates=<absolute path of the backlog note>
```
Every submodule except the knowledge base counts as source code (application repos, DB projects).
The last sweep date lives in `~/.config/tech-blog/state` (`last-sweep=YYYY-MM-DD`); missing → 30 days ago. A user-named range (「이번 달」, 「9월부터」) overrides it.

Collect what the user changed since then. Every list goes to a scratchpad file; the author email is read from the workspace config and never printed:
```bash
SP=<scratchpad>; K=~/.config/tech-blog/kb.txt
W=$(sed -n 's/^workspace=//p' $K); R=$(sed -n 's/^root=//p' $K); C=$(sed -n 's/^candidates=//p' $K)
SINCE=$(sed -n 's/^last-sweep=//p' ~/.config/tech-blog/state 2>/dev/null); SINCE=${SINCE:-$(date -v-30d +%F)}
# 1. Knowledge-base notes I committed, plus my uncommitted ones (the KB is its own submodule repo; paths are relative to $R)
{ git -C "$R" log --since="$SINCE" --author="$(git -C "$R" config user.email)" --name-only --format=
  git -C "$R" status --porcelain | sed 's/^...//'; } | grep '\.md$' | sort -u > "$SP/kb-changed.txt"
# 2. My commits in every code submodule (all branches, so worktree branches count too)
git -C "$W" submodule foreach --quiet \
  "git log --all --no-merges --author=\"\$(git config user.email)\" --since=$SINCE --format=\"\$name|%h|%ad|%s\" --date=short" \
  2>/dev/null | grep "|" | grep -v "^${R#$W/}|" > "$SP/code-log.txt"   # KB commits are covered by step 1
# 3. Notes already in the backlog (open or done), to drop duplicates
grep -oE '\[\[[^]]+\]\]' "$C" | tr -d '[]' | sort -u > "$SP/backlog-notes.txt"
wc -l "$SP"/kb-changed.txt "$SP"/code-log.txt
```
`code-log.txt` rows carry submodule names and ticket keys: they are evidence only. Read a commit's technique with `git -C <submodule> show --stat <hash>` and `git -C <submodule> show <hash> -- <path>`, then rewrite.

**What makes a candidate.** A change is blog material when it carries a technique that transfers to other codebases: a root cause that took real digging, a mechanism that surprised (JVM, DB engine, browser, protocol), a measured trade-off, a pattern that came out of repeated failures, or a Claude Code workflow lesson. Skip pure business features, config bumps, renames, and notes that only record what was done without why. One candidate may join a note with the commits that implemented it, or several notes on one mechanism.

**Where it goes.** Append new candidates to the backlog note under `## 새 후보 (YYYY-MM-DD 스윕)` in its existing line format (`- [ ] [[note name]] — <angle> (<work date>)`). A candidate with commits but no note gets `[[code: <neutral alias>]]` plus the evidence path in the scratchpad. The backlog note is a private work file: edit it, never commit it in the workspace (team repo). After appending, write `last-sweep=<today>` to the state file.

## Repo discovery
```bash
SP=<scratchpad>
{ find ~/Projects ~/IdeaProjects -maxdepth 3 -name .git -type d 2>/dev/null | sed 's|/\.git$||'
  grep -v '^#' ~/.config/tech-blog/repos.txt 2>/dev/null | sed "s|^~|$HOME|"; } | grep -v '^$' | sort -u > "$SP/repos.txt"
```
`~/.config/tech-blog/repos.txt` (optional): extra repo paths, one per line. The result `<scratchpad>/repos.txt` is the discovered list.

## Git history
Author emails (written to a file, never echoed):
```bash
SP=<scratchpad>
while IFS= read -r r; do git -C "$r" config user.email; done < "$SP/repos.txt" | grep -v '^$' | sort -u > "$SP/emails.txt"
```
Commits per repo since a date, for every author email:
```bash
SP=<scratchpad>
while IFS= read -r e; do git -C <repo> log --all --author="$e" --since=<YYYY-MM-DD> --format='%h %ad %s' --date=short; done \
  < "$SP/emails.txt" | sort -u > "$SP/<repo-alias>-log.txt"
```
Branch summary (what a feature branch changed):
```bash
git -C <repo> log main..<branch> --stat        # or master..<branch>
git -C <repo> diff main...<branch> -- <path>   # read the technique, then rewrite code from scratch
```
Use a neutral alias (`repo-a`) for scratchpad file names and in chat when the repo is private.

## Claude Code learnings
```bash
ls -t ~/.claude/projects/*/memory/*.md                               # feedback/project memories, newest first
ls ~/.claude/skills ~/Projects/*/.claude/skills                      # global + project skills
grep -l -i 'pitfall' ~/Projects/*/CLAUDE.md ~/Projects/*/*/CLAUDE.md 2>/dev/null   # 「Pitfalls」 sections
find ~/.claude/projects -name '*.jsonl' -newermt <YYYY-MM-DD>        # transcripts in the date range
```
Transcript digest (user prompts + the last assistant text before each next prompt; `~/.claude/projects` jsonl files are read-only, never edit them):
```bash
python3 - <file.jsonl> > <scratchpad>/<alias>-digest.txt <<'EOF'
import json, sys
last = None
for line in open(sys.argv[1], encoding='utf-8'):
    try: e = json.loads(line)
    except ValueError: continue
    c = (e.get('message') or {}).get('content')
    parts = [c] if isinstance(c, str) else [b.get('text', '') for b in c or [] if isinstance(b, dict) and b.get('type') == 'text']
    t = '\n'.join(p for p in parts if p).strip()
    if not t: continue
    if e.get('type') == 'user':
        if last: print('A:', last[:1500]); last = None
        print('U:', t[:1500])
    elif e.get('type') == 'assistant': last = t
if last: print('A:', last[:1500])
EOF
```
Good learnings-post evidence: a memory or CLAUDE.md rule with its "why", the commit that added a skill or hook, and the transcript turn where the failure happened.

## Knowledge base notes
A private notes vault (Obsidian-style markdown) as a source, keyed by `root=` and `candidates=` in `kb.txt` (see 「Workspace sweep」). The backlog note lists one candidate per line: `- [ ] [[note name]] — <angle>`; `- [x]` marks a published one.
```bash
SP=<scratchpad>; K=~/.config/tech-blog/kb.txt
R=$(sed -n 's/^root=//p' "$K"); C=$(sed -n 's/^candidates=//p' "$K")
[ -n "$C" ] && grep -E '^- \[ \]' "$C" > "$SP/kb-candidates.txt"                # open candidates
grep -rl --include='*.md' -i '<topic term>' "$R" | head -50 > "$SP/kb-hits.txt" # no backlog: search by topic
```
Note names in the backlog resolve with `find "$R" -name '<note name>.md'`.

Work notes carry far more identifiers than commits: service and feature names, partner and customer names, internal hosts, DB/table names, ticket keys, people, business numbers. Take only the technique and the reasoning behind a decision, then write every sentence fresh; never paste or lightly paraphrase a note sentence, table, or diagram label. Note names and folder names are identifiers too: the draft never cites them, and candidates in chat are named by angle only.

## Sweeping several repos
Delegate to an Explore or general-purpose subagent with: the date range, the scratchpad path, the 「Repo discovery」 / author-email commands above (they write `repos.txt` / `emails.txt` there), "read-only", "write evidence to <scratchpad path>", "return 2–4 candidate angles with commit hashes or file paths; no repo, company or ticket names in the summary".

For the workspace sweep, when `kb-changed.txt` + `code-log.txt` exceed about 30 rows, hand the judging to one general-purpose subagent: give it the three scratchpad files, the 「What makes a candidate」 paragraph, the backlog line format, and "read-only; write candidate lines to `<scratchpad>/new-candidates.md`; summary by angle only". You append the lines to the backlog yourself after scanning that file.
