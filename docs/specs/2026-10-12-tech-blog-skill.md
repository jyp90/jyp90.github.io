# `tech-blog` skill — work history → de-identified post → publish (2026-10-12)

Status: direction approved (user: 「알아서 진행」 after scope was set). Built after the UI redesign; independent of it.

## Goal
One global Claude Code skill that turns what the user actually did — git history and branches across their repos, and what they learned using Claude Code — into a Korean technical post on `jyp90.github.io`, with company-identifying information removed, and publishes it only after the user approves the draft.

## Hard rule: what may and may not appear
- Never: employer or client names, internal service/product/codename names, internal domains/hostnames/IPs, repo names of private repos, ticket keys, people's names, work email addresses, customer data, account IDs, secrets, screenshots of internal tools, code copied verbatim from a private repo.
- Allowed: the general technique and domain knowledge needed to build such a service (e.g. "멱등 키로 중복 메시지 처리", "DRM 라이선스 갱신 흐름의 일반 구조"), public library/framework names, rewritten minimal code examples, numbers that are not business metrics.
- Precedent: the 2026-01 RabbitMQ/Worker series on this blog — generic architecture, no company named.

## Location and files
Tracked in this (public) blog repo so it is versioned; symlinked as a global skill.
```
.claude/skills/tech-blog/
  SKILL.md               # workflow, triggers, rules (English, per user convention)
  scan.sh                # de-identification gate
  scan.test.sh           # fixture-based test for scan.sh
  references/style.md    # post structure, front matter, tone (Korean examples)
  references/sources.md  # how to mine git history and Claude Code learnings
~/.claude/skills/tech-blog -> ~/Projects/jyp90.github.io/.claude/skills/tech-blog
```
Private, untracked, outside every repo:
```
~/.config/tech-blog/forbidden-terms.txt   # one term per line: company/service/client/codename/domain/host
~/.config/tech-blog/repos.txt             # optional: extra repo roots to scan (one path per line)
```
The skill and its references contain no real company terms. Jekyll already ignores dot-directories.

## Workflow (SKILL.md)
1. **Pick the source** (ask once, 2–4 options):
   - Git: a repo + branch / commit range / date range. Default discovery: `.git` dirs under `~/Projects`, `~/IdeaProjects` (depth 3) plus `repos.txt`; author filter = every `user.email` found in those repos' configs (read, never printed into the draft).
   - Claude Code learnings: a date range over `~/.claude/projects/*/memory/*.md` (feedback/project memories), `~/.claude/skills/*/SKILL.md` and project `.claude/skills/*/SKILL.md`, `CLAUDE.md` 「Pitfalls」 sections, and session transcripts `~/.claude/projects/*/*.jsonl` (read-only; user prompts + final assistant summaries only).
   - A topic the user names.
2. **Collect evidence** read-only (delegate the sweep to an Explore/general-purpose subagent when it spans several repos). Output: 2–4 candidate posts, each with angle, audience, and the evidence (commit hashes / file paths) kept in the scratchpad, not in the draft.
3. **User picks a candidate** → outline (h2 list) → draft in `references/style.md` format into the scratchpad.
4. **De-identify**: rewrite names to generic roles ("사내 콘텐츠 서비스", "결제 도메인"), rewrite code examples from scratch, drop business metrics. Then `bash scan.sh <draft>`; exit 0 required. Exit 2 (terms file missing/empty) → ask the user to fill `forbidden-terms.txt`; never skip the scan.
5. **Preview and approval**: show the draft (path + private Artifact preview); publishing waits for an explicit 「올려」/「게시」 in the current turn.
6. **Publish** in `~/Projects/jyp90.github.io` (clone if missing):
   - Refuse unless `git config user.email` is `jyp90@kakao.com` (set it locally if unset; stop if set to anything else).
   - `git pull --rebase origin master`, write `_posts/YYYY-MM-DD-<slug>.markdown`, rerun `scan.sh` on the staged file, commit `post: <title>`, `git push origin master`.
   - `gh run watch` the Pages run, then `curl -s -o /dev/null -w '%{http_code}' https://jyp90.github.io/blog/YYYY/MM/DD/<slug>.html` must be 200. Report the URL.

## `scan.sh`
- Usage: `scan.sh <file>...`. Exit 0 clean, 1 findings, 2 terms file missing/empty.
- Checks: case-insensitive fixed-string match against `forbidden-terms.txt` (prints `term#N line L` only, never the term); emails other than `jyp90@kakao.com`; private IPs (`10.*`, `172.16–31.*`, `192.168.*`); hostnames ending `.internal`, `.local`, `.corp`, `.lan`; `atlassian.net`, `slack.com/archives`, `notion.so` links; ticket keys `\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b` except the built-in public prefixes `UTF ISO SHA MD AES RSA HS RS ES PS RFC CVE HTTP TLS JDK JSR PEP`; 12-digit numbers (AWS account IDs); secrets `sk-ant-`, `gh[pousr]_`, `AKIA[0-9A-Z]{16}`, `PRIVATE KEY`.
- Findings print as `file:line: <rule>`; no matched text for the terms rule.
- `scan.test.sh` builds a temp terms file and fixture drafts under `mktemp -d` and asserts exit codes and output per rule.

## `references/style.md`
- Front matter (matches existing posts): `layout: post`, `title`, `date: YYYY-MM-DD HH:MM:SS +0900`, `categories: blog`, `tags: [...]` (3–7, existing tag names preferred), `excerpt` (one sentence).
- Structure: 문제/배경 → 접근 → 구현(핵심 코드) → 함정·트레이드오프 → 정리. Korean, 합니다체, no filler intro, code blocks with language tags, h2/h3 only.
- Claude Code learning posts: what was tried, what failed, the rule that came out of it (CLAUDE.md/skill/hook snippet), generalized for any project.

## Verification
- `bash scan.test.sh` passes.
- Skill dry run (no push): from the Claude Code learnings source, produce one draft end-to-end through step 5; scan exit 0; confirm by grep that no `forbidden-terms.txt` entry and no work email appears.
- `writing-skills` pressure check: a subagent given the skill and a draft containing a planted company term must stop at step 4.

## Open items
- `forbidden-terms.txt`: on first run Claude creates it with a header comment and pre-seeds the email domains of every non-`jyp90@kakao.com` `user.email` found in the scanned repos (written straight to the file, never echoed), then asks the user to add company/service/client names. The user owns its contents.
- Existing public commit metadata with employer emails (see UI spec) — separate decision.
