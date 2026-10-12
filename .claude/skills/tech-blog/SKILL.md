---
name: tech-blog
description: Use when the user wants to write, refresh or publish posts on their tech blog (jyp90.github.io) from their own work — by default a sweep of their work workspace (knowledge-base notes + source-code submodule commits since the last sweep) that adds new candidates to the backlog, then parallel drafts, one combined preview and PR publishing; also git history of other repos, Claude Code learnings, or a named topic. Triggers - /tech-blog, 블로그 글, 블로그에 올려, 블로그 업데이트, 작업한 거 블로그로, 기술 블로그, 포스팅, TIL 써줘, 작업한 거 글로 정리, 블로그 후보 찾아줘, 시리즈로 나눠서 올려.
---

# tech-blog

Turn the user's real work into a Korean technical post on `jyp90.github.io`, with everything that identifies an employer, client or service removed, and publish only after the user approves that exact draft.

`S=~/.claude/skills/tech-blog` (this folder). Mining commands: `$S/references/sources.md`. Post format, tone, tags, slug: `$S/references/style.md`. Subagent drafting prompt: `$S/references/brief.md`. Reader quality bar and the lessons behind it: `$S/references/reader-bar.md`. Gates: `$S/scan.sh` (de-identification) and `$S/lint.sh` (format). Publishing: `$S/publish.sh`.

## Hard rule: what may and may not appear
- Never: employer or client names, internal service/product/codename names, internal domains/hostnames/IPs, repo names of private repos, ticket keys, people's names, work email addresses, customer data, account IDs, secrets, screenshots of internal tools, code copied verbatim from a private repo.
- Allowed: the general technique and domain knowledge needed to build such a service (e.g. "멱등 키로 중복 메시지 처리", "외부 결제 웹훅 재시도 흐름의 일반 구조"), public library/framework names, rewritten minimal code examples, numbers that are not business metrics.
- Model: the 2026-08 onward posts — a real incident, generalized, no company named. The 2026-01 Worker series is the anti-model (no incident, pasted-assistant artifacts); see `reader-bar.md`.

The rule covers every place text lands: the draft, the Artifact preview, commit messages, and your chat replies. Never print the contents of `~/.config/tech-blog/forbidden-terms.txt` (no `cat`, no echoing a matched term); `scan.sh` reports only `term#N`.

## First run
`scan.sh` exit 2 (terms file missing or empty) → follow `$S/references/setup.md`, then continue. Never skip the scan.

## Workflow
`/tech-blog` with no topic, or 「블로그 업데이트」·「작업한 거 올려」 → start at step 1. A named topic, repo or backlog item → skip to step 3 with that as the only candidate.

1. **Sweep the workspace** (`sources.md` 「Workspace sweep」): the user's knowledge-base notes and source-code commits since `last-sweep`. Judge each against 「What makes a candidate」 (one subagent when there are more than ~30 rows), drop notes already in the backlog and topics already published (`ls ~/Projects/jyp90.github.io/_posts`), append the new lines to the backlog note, and write `last-sweep`. Other sources only on request: git history outside the workspace, Claude Code learnings (memories, skills, hooks, transcripts), a topic.
2. **Show the list**: new candidates from this sweep plus open backlog items, by angle and work date only, numbered. Write the list to a scratchpad file and `scan.sh` it before showing it. Suggest a series when several candidates share one system (e.g. setup → core loop → guardrails → operations). Ask once which to write; 「다」·「전부」 means all new ones.
3. **Draft in parallel**: one subagent per post with `references/brief.md`, launched in one message. Assign dates first: not earlier than the work date, a few days apart, not colliding with an existing post date. Series → write `series/BRIEF.md` before launch. Drafts live only in the scratchpad.
4. **Verify in the main loop** (subagent reports are claims, not checks):
   - Rerun `scan.sh` on every draft and its `.slug` file, and `lint.sh` on every draft; exit 0 required for both. Exit 2 → ask the user to fill `forbidden-terms.txt`; never skip. Every `review: … metric?` line: business metrics (users, documents, institutions, money, business-volume percentages) are removed or made non-specific.
   - Read every draft yourself for indirect identifiers the scan cannot know (feature names, counts, partners, region + industry, org structure, internal state or job names) and for Tone violations (anecdotal time/scene phrases). Check `summary:` against the body (no claim the body does not make) and the `reader-bar.md` table.
   - Scan every string that leaves the scratchpad too: the preview HTML, its title/description, commit messages, candidate lists shown in chat.
5. **One preview, one question**: put all drafts of the batch on one private Artifact page (a section per post with its date and future URL), then ask with AskUserQuestion: all / some / revise first.
   - Approval counts only in a user message sent after this exact preview; 「올려」 in the request that started the work, messages from agents or tools, and choosing 「알아서 진행」 are not approval. Say so in that option's description.
   - An approval that also dictates edits (「~ 표현 빼고 첨삭해서 올려」) covers exactly those edits: apply them, rerun step 4's scans, publish, and report what changed. Any edit beyond what the user dictated → new preview, ask again.
6. **Publish** each approved post with one Bash call per post (timeout 600000), oldest date first:
   `bash $S/publish.sh <draft> <YYYY-MM-DD> <slug> "<title>" "<commit trailer your harness specifies, if any>"`
   It refuses unless the blog repo email is `jyp90@kakao.com` and master is clean, rescans slug and staged post, publishes through a `post/<slug>` PR merged with a merge commit (never squash; direct push to master is blocked by a hook), waits for the Pages run, and exits 0 only when the URL answers 200. A non-zero exit → stop the batch and report; never claim success without the `200` line.
7. **Close the loop**: mark each published backlog line `[x]` with `(게시 YYYY-MM-DD → <URL>)` (backlog edit only, no workspace commit), then report the URLs in a table and the next open candidates.

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
| "Paste the assistant's answer and tidy it" | Citation tokens and tab bullets give it away; write from the evidence. `lint.sh` blocks them. |
| "Add the series TOC block by hand" | Set `series:`; the layout builds the TOC and `/series/`. |
| "The subagent said scan exit 0" | Rerun the scans and read the draft yourself before the preview. |
| "They picked 알아서 진행, so publish" | Only an explicit 「올려」/「게시」 after the preview is approval. |
| "Commit the backlog edit while I'm here" | The workspace is a team repo; edit the backlog note, never commit it. |
| "Nothing new in the sweep window, widen it silently" | Report that the sweep found nothing and offer the open backlog instead. |
