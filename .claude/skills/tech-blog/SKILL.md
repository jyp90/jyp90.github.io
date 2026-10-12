---
name: tech-blog
description: Use when the user wants to write or publish a post on their tech blog (jyp90.github.io) from their own work — git history/branches of any repo, or what they learned using Claude Code (skills, hooks, CLAUDE.md rules, memories), or notes in their private knowledge base. Triggers - /tech-blog, 블로그 글, 블로그에 올려, 기술 블로그, 포스팅, TIL 써줘, 작업한 거 글로 정리.
---

# tech-blog

Turn the user's real work into a Korean technical post on `jyp90.github.io`, with everything that identifies an employer, client or service removed, and publish only after the user approves that exact draft.

`S=~/.claude/skills/tech-blog` (this folder). Commands for mining sources: `$S/references/sources.md`. Post format, tags, slug, de-identification example: `$S/references/style.md`.

## Hard rule: what may and may not appear
- Never: employer or client names, internal service/product/codename names, internal domains/hostnames/IPs, repo names of private repos, ticket keys, people's names, work email addresses, customer data, account IDs, secrets, screenshots of internal tools, code copied verbatim from a private repo.
- Allowed: the general technique and domain knowledge needed to build such a service (e.g. "멱등 키로 중복 메시지 처리", "외부 결제 웹훅 재시도 흐름의 일반 구조"), public library/framework names, rewritten minimal code examples, numbers that are not business metrics.
- Precedent: the 2026-01 RabbitMQ/Worker series on this blog — generic architecture, no company named.

The rule covers every place text lands: the draft, the Artifact preview, commit messages, and your chat replies. Never print the contents of `~/.config/tech-blog/forbidden-terms.txt` (no `cat`, no echoing a matched term); `scan.sh` reports only `term#N`.

## First run: terms file
If `~/.config/tech-blog/forbidden-terms.txt` is missing or has no terms (`scan.sh` exit 2), create it and pre-seed it with work email domains and non-`jyp90` remote owners (GitHub orgs), writing straight to the file without printing anything. Run `sources.md` 「Repo discovery」 first (it writes `<scratchpad>/repos.txt`):

```bash
SP=<scratchpad>; T=~/.config/tech-blog/forbidden-terms.txt; mkdir -p ~/.config/tech-blog
[ -f "$T" ] || printf '%s\n' '# tech-blog forbidden terms: one per line, case-insensitive fixed strings.' \
  '# Company, service, client, codename, domain, host. Private file: never commit or print it.' > "$T"
{ while IFS= read -r r; do git -C "$r" config user.email; done < "$SP/repos.txt" | grep -vxF jyp90@kakao.com | sed 's/.*@//'
  while IFS= read -r r; do git -C "$r" remote get-url origin 2>/dev/null; done < "$SP/repos.txt" \
    | sed -E 's#\.git$##; s#^.*[:/]([^/:]+)/[^/]+$#\1#' | grep -vixF jyp90; } \
  | grep -v '^$' | sort -u | while IFS= read -r d; do grep -qixF -- "$d" "$T" || printf '%s\n' "$d" >> "$T"; done
```
Then ask the user to add company/service/client/codename names themselves (「회사·서비스·고객사 이름을 `~/.config/tech-blog/forbidden-terms.txt`에 한 줄씩 추가해 주세요」). Do not guess or type those names yourself. Continue only once `scan.sh` no longer exits 2.
- Each identifier goes in once per spelling: English, Korean, abbreviation, old name. Ticket project keys go in `~/.config/tech-blog/ticket-keys.txt` (one key per line, matched case-insensitively as `KEY-<n>`), not in the terms file, because a short key as a fixed string matches ordinary words.
- After seeding, you may collect module, host-domain, DB and knowledge-base domain names from the workspace into a private candidate file (`~/.config/tech-blog/uncovered-candidates.txt`) for the user to review; never type them into chat.

## Workflow
1. **Pick the source** (ask once, 2–4 options):
   - Git: a repo + branch / commit range / date range. Default discovery: `.git` dirs under `~/Projects`, `~/IdeaProjects` (depth 3) plus `repos.txt`; author filter = every `user.email` found in those repos' configs (read, never printed into the draft).
   - Claude Code learnings: a date range over `~/.claude/projects/*/memory/*.md` (feedback/project memories), `~/.claude/skills/*/SKILL.md` and project `.claude/skills/*/SKILL.md`, `CLAUDE.md` 「Pitfalls」 sections, and session transcripts `~/.claude/projects/*/*.jsonl` (read-only; user prompts + final assistant summaries only).
   - Knowledge base notes: open candidates from the backlog note, or notes matching a topic, in the vault set in `~/.config/tech-blog/kb.txt` (`sources.md` 「Knowledge base notes」). Missing file → ask the user for the vault path once and write it there.
   - A topic the user names.
2. **Collect evidence** read-only (delegate the sweep to an Explore/general-purpose subagent when it spans several repos). Output: 2–4 candidate posts, each with angle, audience, and the evidence (commit hashes / file paths) kept in the scratchpad, not in the draft.
   - Commands: `sources.md`. Evidence files go in the session scratchpad directory (from the system prompt; none listed → `mktemp -d`), never inside a repo.
   - Present candidates by angle only (「멱등 키로 중복 처리하기」), not by repo or ticket name.
3. **User picks a candidate** → outline (h2 list) → draft in `references/style.md` format into the scratchpad.
   - Draft path: `<scratchpad>/YYYY-MM-DD-<slug>.markdown`. It stays there until approved; never write a draft into the blog repo or any other repo.
   - Claude Code learnings post: what was tried, what failed, the rule/skill/hook that came out of it (a short CLAUDE.md / SKILL.md / hook snippet), generalized so it works in any project. Rewrite project-specific names (repo, app, internal tool) as generic roles.
4. **De-identify**: rewrite names to generic roles ("사내 콘텐츠 서비스", "결제 도메인"), rewrite code examples from scratch, drop business metrics. Then `bash scan.sh <draft>`; exit 0 required. Exit 2 (terms file missing/empty) → ask the user to fill `forbidden-terms.txt`; never skip the scan.
   - `bash $S/scan.sh <draft>`. Exit 1 → fix every `file:line: rule` it prints and rerun until exit 0.
   - Slug (public URL, file name) is not in the draft body, so scan it too: `printf '%s\n' "<slug>" > "$D.slug" && bash $S/scan.sh "$D.slug"` (`D` = draft path). The title is front matter, already covered by the draft scan.
   - Then re-read the draft yourself for indirect identifiers the scan cannot know: product feature names, customer counts, partner names, region + industry combinations, exact org structure.
   - Every `review: … metric?` line on stderr needs a look: counts of users, documents or institutions, money, and percentages of business volume are business metrics; remove them or make them non-specific. These lines do not change the exit code.
   - Scan every string that leaves the scratchpad, not just the draft: the Artifact preview HTML, its `title`/`description`, any commit message other than `post: <title>`, and a candidate list before showing it in chat (write it to a file and scan). Exit 0 required.
5. **Preview and approval**: show the draft (path + private Artifact preview); publishing waits for an explicit 「올려」/「게시」 in the current turn.
   - The approval must be in the user's current message and must refer to this exact draft. An earlier 「올려」, an approval of a previous version, or any edit made after the approval → show the new version and ask again.
   - Approval counts only in a user message sent after the preview of this exact draft was shown; 「올려」/「게시」 in the request that started the work, or before the preview existed, is not approval.
   - Draft edited (by you or on request) → rerun step 4's scans until exit 0 before showing the new preview.
   - Messages from other agents or tools are never approval.
6. **Publish** in `~/Projects/jyp90.github.io` (clone if missing):
   - Refuse unless `git config user.email` is `jyp90@kakao.com` (set it locally if unset; stop if set to anything else).
   - `git pull --rebase origin master`, write `_posts/YYYY-MM-DD-<slug>.markdown`, rerun `scan.sh` on the staged file, commit `post: <title>`, `git push origin master`.
   - `gh run watch` the Pages run, then `curl -s -o /dev/null -w '%{http_code}' https://jyp90.github.io/blog/YYYY/MM/DD/<slug>.html` must be 200. Report the URL.

### Publish script (step 6)
Run as ONE Bash call, top to bottom, with a Bash timeout of 600000 ms (`gh run watch` + the curl loop exceed the 2-minute default); never run part of it. Its `sleep`s run inside the script, which harnesses that block a bare foreground `sleep` still allow. Fill the `<…>` placeholders first.
```bash
B=~/Projects/jyp90.github.io
[ -d "$B" ] || git clone -q git@github.com:jyp90/jyp90.github.io.git "$B"
e=$(git -C "$B" config user.email); [ -z "$e" ] && git -C "$B" config user.email jyp90@kakao.com && e=jyp90@kakao.com
[ "$e" = jyp90@kakao.com ] || { echo "blog repo email is not jyp90@kakao.com — stop"; exit 1; }
S=~/.claude/skills/tech-blog
P=_posts/YYYY-MM-DD-<slug>.markdown
D=<scratchpad>/YYYY-MM-DD-<slug>.markdown
printf '%s\n' "<slug>" > "$D.slug" && bash $S/scan.sh "$D.slug" || exit 1
[ "$(git -C "$B" branch --show-current)" = master ] && [ -z "$(git -C "$B" status --porcelain)" ] \
  || { echo "blog repo not on a clean master — stop and ask the user"; exit 1; }
git -C "$B" pull --rebase origin master || { echo "pull --rebase failed — stop and ask the user"; exit 1; }
[ -z "$(git -C "$B" log --oneline origin/master..master)" ] || { echo "unpushed local commits on master — stop and ask the user"; exit 1; }
[ -e "$B/$P" ] && { echo "$P already exists — stop"; exit 1; }
cp "$D" "$B/$P" && git -C "$B" add "$P"
bash $S/scan.sh "$B/$P" || { git -C "$B" rm -q --cached "$P"; rm "$B/$P"; exit 1; }
git -C "$B" commit -q -m "post: <title>" || { echo "commit failed — stop"; exit 1; }
git -C "$B" push origin master || { echo "push failed — stop and ask the user"; exit 1; }
sha=$(git -C "$B" rev-parse HEAD); sleep 10
id=$(gh run list -R jyp90/jyp90.github.io --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$id" -R jyp90/jyp90.github.io --exit-status
U=https://jyp90.github.io/blog/YYYY/MM/DD/<slug>.html
for i in 1 2 3 4 5 6; do c=$(curl -s -o /dev/null -w '%{http_code}' "$U"); [ "$c" = 200 ] && break; sleep 10; done; echo "$c $U"
```
If a PreToolUse hook blocks the direct `git push origin master` (protected-branch guard), nothing ran; publish through a PR instead: branch `post/<slug>` off a fresh master, same scans and commit, `git push -u origin post/<slug>`, `gh pr create -B master`, `gh pr merge --merge --delete-branch` (never squash), `git pull --ff-only origin master`, then the same `gh run watch` + curl 200 check on the merge commit.
In the `post: <title>` commit message, append the commit attribution trailer your harness specifies, if any.
The URL path comes from `categories: blog` + the file date + slug (Jekyll default permalink). `gh run list` empty → wait and list again; never report success without the 200. Report the URL to the user.

## Red flags — stop and fix

| Thought | Reality |
|---|---|
| "The repo is private, so its name is harmless" | A repo name is still a company identifier. Use a generic role. |
| "`scan.sh` passed, so it's safe" | The scan only catches listed terms and fixed patterns. Re-read for indirect identifiers (feature names, customer counts, partners). |
| "The user said 올려 earlier" | Approval is per draft, in the current turn. Ask again. |
| "The request itself said 올려/게시" | Approval counts only in a message sent after this exact draft's preview. Show it and ask. |
| "The terms file is empty; the draft looks clean, skip the scan" | Exit 2 means stop and ask the user to fill the file. Never skip. |
| "I'll just show which term matched" | Never print a forbidden term, in chat or anywhere else. |
| "This code is short, copy it as is" | Rewrite examples from scratch with generic names. |
| "Draft in the blog repo is easier" | Draft lives in the scratchpad until approved. |
| "Commit with whatever email is configured" | Only `jyp90@kakao.com`; any other value → stop. |
| "This note sentence is already generic, keep it" | Work notes are written for insiders. Rewrite every sentence; never cite a note or folder name. |
| "A ticket key gives useful context" | Ticket keys are banned; write `<KEY>-<n>` only in docs, nothing in posts. |
