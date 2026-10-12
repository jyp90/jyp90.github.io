# Mining sources (read-only)

Everything here only reads. Evidence (commit lists, excerpts, file paths) goes to files in the session scratchpad directory, never into a repo and never into the draft. Do not print work emails or forbidden terms in chat: pipe them into variables or scratchpad files.

## Repo discovery
```bash
REPOS=$( { find ~/Projects ~/IdeaProjects -maxdepth 3 -name .git -type d 2>/dev/null | sed 's|/\.git$||'
  grep -v '^#' ~/.config/tech-blog/repos.txt 2>/dev/null | sed "s|^~|$HOME|"; } | grep -v '^$' | sort -u)
```
`repos.txt` (optional): extra repo paths, one per line.

## Git history
Author emails (kept in a variable, never echoed):
```bash
EMAILS=$(for r in $REPOS; do git -C "$r" config user.email; done | sort -u)
```
Commits per repo since a date, for every author email:
```bash
for e in $EMAILS; do git -C <repo> log --all --author="$e" --since=<YYYY-MM-DD> --format='%h %ad %s' --date=short; done \
  | sort -u > <scratchpad>/<repo-alias>-log.txt
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

## Sweeping several repos
Delegate to an Explore or general-purpose subagent with: the date range, the `REPOS` / `EMAILS` commands above, "read-only", "write evidence to <scratchpad path>", "return 2–4 candidate angles with commit hashes or file paths; no repo, company or ticket names in the summary".
