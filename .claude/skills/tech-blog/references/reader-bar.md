# Reader bar: what a developer or recruiter needs from a post

Learned from the 2026-10-13 review of the whole blog, read as a hiring manager and as a developer would. Check every draft against it in step 4; `lint.sh` enforces the mechanical half.

## What made posts strong (keep doing)
- Opens on a concrete symptom from real work, then mechanism → how to check → fix and its limits. The 2026-08 onward posts (`java-wrapper-equality-127`, `http-client-no-timeout-thread-exhaustion`, `jdbc-silent-cjk-character-loss`) are the model.
- A symptom ↔ cause table, a minimal reproduction, a spec or doc pointer for the mechanism.
- One system followed across a series (setup → core loop → guardrails → operations).

## What hurt (never again)
| Seen on the blog | Why it hurts | Rule |
|---|---|---|
| 2026-01 Worker series: generic "고려 포인트 정리" with no incident, excerpt claiming experience the body lacks | Reads as a summarized answer, not experience; contrasts badly with real posts | Every post starts from something that actually happened. No incident in the evidence → not a candidate. |
| `[oai_citation:…](…utm_source=chatgpt.com)`, `￼`, `⸻`, tab bullets `\t•\t`, headings as plain lines | Instant "pasted from a chat assistant" signal | Never paste assistant output; `lint.sh` blocks these. |
| Hand-written series TOC blocks, two labels (「시리즈:」/「연재 목차」) | Drift and inconsistency; breaks when a part is added | `series:` front matter only; the layout renders the TOC and `/series/` page. |
| 2023 link dumps and copied library code with wrong explanations | A developer reader spots the error and discounts the rest | Unfinished or wrong posts get `published: false`, not left up. |
| 30–40 KB posts whose first screen is only background | Skimmers leave before the point | `summary:` 3 lines (problem, cause, fix/result), outcome first. |
| About page left as the theme default | First place a recruiter clicks; empty = unknown author | Keep `about.markdown` current when focus areas change. |

## Front-matter fields the layout reads
- `summary:` exactly 3 items, 합니다체, ≤ 75 chars each: (1) 어떤 문제·상황, (2) 원인·핵심 원리, (3) 해결·확인 방법 또는 결론. Adapt for build/procedure posts (what was built, key idea, result). Facts from the body only.
- `series: "<name>"`: the title must start with the exact name; the TOC strips it to show 「(n) 부제」.
- `featured: true`: home 「먼저 읽어 볼 글」 and the About page. Keep 4–6, mostly Java/DB/장애 posts (the user's core); propose a swap in the report instead of silently adding.
- `excerpt`: ≤ 140 chars (the home list truncates there).

## Before calling a batch done
- `bash $S/lint.sh <draft>` and `bash $S/scan.sh <draft>` both exit 0.
- Another session may have merged posts meanwhile: `git -C ~/Projects/jyp90.github.io pull --ff-only` before branching, and check the series TOC still lists every part.
