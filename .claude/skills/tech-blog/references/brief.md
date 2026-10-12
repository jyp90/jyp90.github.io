# Drafting brief for subagents

One general-purpose subagent per post, all launched in one message (`run_in_background: true`). A series also gets a shared `<scratchpad>/series/BRIEF.md` written before launch. Fill every `<…>`; the prompt itself must pass `scan.sh` (write it to a scratchpad file and scan it before sending), so name evidence by path only.

```text
Draft ONE Korean tech blog post for jyp90.github.io. Do it yourself; never spawn sub-agents. DRAFT ONLY: never write into ~/Projects/jyp90.github.io
or any repo, never commit, never publish, never edit the evidence files.

Read first:
- ~/.claude/skills/tech-blog/SKILL.md 「Hard rule」, ~/.claude/skills/tech-blog/references/style.md (format, Tone)
  and ~/.claude/skills/tech-blog/references/reader-bar.md (summary, series, what hurt)
- Voice model: ~/Projects/jyp90.github.io/_posts/<a recent post>.markdown
- <series only> <scratchpad>/series/BRIEF.md (series name, shared tags, naming)

Evidence (private, read-only; take the technique and the reasoning, rewrite every sentence and every code line):
- <absolute note paths>
- <submodule path> commits <hash list>: read with `git -C <path> show <hash>`

Post:
- Angle: <one sentence>   Reader: <who>
- Date <YYYY-MM-DD> (not earlier than the work date), slug `<slug>`, working title 「<title>」
- Already published, link instead of repeating: </blog/YYYY/MM/DD/slug.html …>

Output:
- Draft at <scratchpad>/<YYYY-MM-DD>-<slug>.markdown, slug in the same path + `.slug`
- `bash ~/.claude/skills/tech-blog/scan.sh <draft>` and `… <draft>.slug` until both exit 0; check every `review:` line
- `bash ~/.claude/skills/tech-blog/lint.sh <draft>` until exit 0
- Re-read for indirect identifiers (feature names, counts, partners, org structure, internal states/job names)
- Report: path, title, tags, scan exits, what you generalized, what you could not verify (unrun code,
  observed-not-documented behaviour). No company, service, repo, ticket or person names in the report.
```

Series brief (`BRIEF.md`) holds: readers, evidence root, the exact series name (every title starts with it, then `(n) 부제`), date and slug per part, shared tags, a naming table (internal name → generic role), overlap with published posts, and the Tone pointer. Every part sets `series:`; no part writes a TOC block.
