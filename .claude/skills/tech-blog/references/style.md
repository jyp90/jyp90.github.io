# Post style for jyp90.github.io

## Front matter
Same fields as the existing posts (model: `_posts/2026-01-17-retry-backoff-strategy-worker-monitoring.markdown`):

```yaml
---
layout: post
title: "멱등 키로 메시지 중복 처리 막기"
date: 2026-10-12 09:00:00 +0900
categories: blog
tags: [Python, Architecture, Troubleshooting]
excerpt: "메시지가 두 번 와도 결과가 한 번만 반영되도록 멱등 키를 설계하는 방법을 정리합니다."
summary:
  - "재시도 중 같은 메시지가 두 번 처리돼 결과가 중복 반영됐습니다."
  - "브로커는 최소 한 번 전달만 보장하므로 소비자가 중복을 걸러야 합니다."
  - "멱등 키에 유니크 제약을 걸어 두 번째 처리를 건너뛰게 했습니다."
series: "메시지 중복 처리 설계"   # only for a series; the title must start with this name
---
```
- `categories: blog` always: it makes the URL `/blog/YYYY/MM/DD/<slug>.html`.
- `date` matches the file name date; time `09:00:00 +0900` unless the user says otherwise, and never earlier than 09:00 KST (earlier is the previous UTC day, so the URL date no longer matches the file name and the publish curl check fails).
- `tags`: 3–7, only names from `references/tags.txt` (English, exact case; `lint.sh` rejects others). Order: language/framework first (Java, Python …), then storage and infra, then topic. A new tag needs at least two posts that use it; add it to `tags.txt` in the same PR.
- `excerpt`: one Korean sentence, ends with 「…합니다.」, ≤ 140 chars.
- `summary`: required, 3 items; rules in `reader-bar.md` 「Front-matter fields」.
- `series`: series parts only. Never write a TOC block into the body; the layout renders it from this field.
- `featured`: never set by a draft; propose it in the report.
- `title`: quoted; Korean, may contain public tech names.

## File name and slug
`_posts/YYYY-MM-DD-<slug>.markdown`. Slug: English, `[a-z0-9-]` only, ≤5 words, describes the technique (`idempotency-key-duplicate-messages`), never a repo, product or company name.

## Structure
h2/h3 only (no h1; the layout prints the title). Default skeleton:

```markdown
## 문제와 배경
## 접근
## 구현
### 핵심 코드
## 함정과 트레이드오프
## 정리
```
Claude Code learnings post:

```markdown
## 상황
## 시도한 것
## 실패한 지점
## 규칙으로 만든 것      <!-- CLAUDE.md 규칙 / skill / hook 스니펫 -->
## 다른 프로젝트에 적용하려면
## 정리
```

## Diagrams
A post about architecture or a multi-step flow gets one ` ```mermaid ` diagram near the top of its 「접근」/「구현」 section; `assets/js/blog.js` renders it (mermaid from cdnjs, loaded only on pages that have one) and leaves the source as a code block if the script fails.
- `flowchart TD` or `sequenceDiagram` only; top-down so it fits a 360 px phone. At most 3 nodes side by side, 12 nodes total, labels ≤ 14 characters.
- Quote labels that contain spaces or symbols: `A["업로드 API"]`. No `click`, no HTML in labels, no `%%{init}%%` (colors come from the theme tokens).
- Generic role names only (scan.sh applies). Write one sentence before the diagram saying what it shows.

## Tone
- Korean, 합니다체. No filler intro (「오늘은 ~에 대해 알아보겠습니다」 금지); open with the problem.
- State the situation as a fact, not as a story. No anecdotal time or scene phrases: 「어느 날 아침」, 「비슷한 시기에」, 「그날」, 「며칠째 ~라는 사실을 알게 됐습니다」. Write 「cron으로 도는 배치 하나가 실행 도중에 죽었습니다」, not 「어느 날 아침, 배치 하나가 죽었습니다」. (User correction, 2026-10-12.)
- Calm, explanatory register: problem → mechanism → how to check → remedies and their limits. No exclamation marks, no hype (「충격적인」, 「완벽하게」), no first-person drama; 「저는」 only when a judgement call needs an owner.
- Counts from work become qualitative (「거의 매번」, 「상당수」), and a claim that rests on observation rather than documentation says so (「공식 문서의 계약이 아니라 직접 관찰한 결과입니다」).
- Post dates: never earlier than the source's work date, and leave a few days between posts published in one batch instead of stacking them on one day.
- Code blocks always carry a language tag (` ```java `, ` ```yaml `, ` ```bash `).
- Code is written from scratch for the post: minimal, generic names (`OrderService`, `payment-events`), no copied lines from a private repo.
- Numbers only when they are not business metrics (timeouts, retry counts, batch sizes are fine; revenue, user counts, traffic volumes are not).
- Public libraries and frameworks by name; everything internal as a generic role.

## De-identification example
Bad (identifies the employer, a service, a ticket and a host):

```markdown
AcmeCorp의 PayHub 정산 배치에서 <KEY>-<n> 이슈로 settle-api.acmecorp.example 호출이 중복됐습니다.
일 거래 120만 건 중 0.3%가 두 번 정산됐습니다.
```
Good:

```markdown
사내 정산 배치에서 외부 결제 API 호출이 재시도 중 중복되는 문제가 있었습니다.
일부 건이 두 번 정산될 수 있었고, 이를 멱등 키로 막았습니다.
```
(`AcmeCorp`, `PayHub` are invented placeholders; `<KEY>-<n>` stands for any real ticket key. Real names never appear in this skill or in a post.)
