# Mining sources (read-only)

Everything here only reads. Evidence (commit lists, excerpts, file paths) goes to files in the session scratchpad directory, never into a repo and never into the draft. Do not print work emails or forbidden terms in chat: write them to scratchpad files. Shell variables do not survive between Bash tool calls, so every block below sets `SP=<scratchpad>` and reads the lists from files.

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
A private notes vault (Obsidian-style markdown) as a source. Its paths live only in `~/.config/tech-blog/kb.txt` (private, never commit or print the paths into a draft):
```
root=<absolute path of the vault>
candidates=<absolute path of a backlog note>   # optional
```
The backlog note lists one candidate per line: `- [ ] [[note name]] — <angle>`; `- [x]` marks a published one.
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
