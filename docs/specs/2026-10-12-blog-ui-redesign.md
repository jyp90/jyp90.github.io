# Blog UI redesign — home list + post page (2026-10-12)

Status: approved direction ("다크 유지 + 구조 개선 + 라이트 모드", user picked 「알아서 진행」).

## Goal
Make 뇽이의 TIL read like a technical blog: a scannable home list and a post page built for long technical articles (1,500+ words, many h2/h3, code). Keep every existing post URL, front matter and the dev-tool pages working.

## Non-goals
- No theme swap, no new Ruby plugins beyond what the `github-pages` gem already ships.
- No search index, comments, analytics or thumbnails.
- Dev-tool pages (`categories: article`) keep their current markup; they only inherit the new tokens.

## Current problems (as of `53e1143`)
- `_includes/head.html`: `<title>` says "DevTools by jypark", meta description is the dev-tool blurb on every page, no OG tags. `_config.yml` `url` is `https://abbo.tistory.com`.
- Home (`_layouts/home.html`): flat list, no tags, no reading time, no way to narrow by topic.
- Post (`_layouts/post.html`): no table of contents, no reading time, no heading anchors, no code copy; every paragraph fades in on scroll (motion noise on a 17-heading article).
- `assets/style.css` (1,377 lines): dark-only, inline styles in `footer.html`, many unused utility classes.

## Design

### Tokens and theme
- Keep the existing dark palette as `:root` tokens. Add a light palette with the same token names.
- Theme selection: `prefers-color-scheme` by default; a header toggle sets `data-theme="light|dark"` on `<html>` and stores it in `localStorage` (`theme`), wrapped in try/catch. An inline script in `<head>` applies the stored value before first paint (no flash).
- Body font: Pretendard (jsDelivr CDN `pretendard` dynamic-subset CSS), fallback system stack. Code: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Reading measure: post body max width ~72ch; base 17px / line-height 1.75 for Korean text.
- Rouge syntax colours defined for both themes.
- `prefers-reduced-motion: reduce` disables all transitions/animations.

### Head / SEO
- `<title>`: `{page.title} | 뇽이의 TIL`, home: `뇽이의 TIL`.
- Use `{% seo %}` (`jekyll-seo-tag`, already in `github-pages`) for description/OG/canonical; add it to `plugins:`. Remove the hard-coded description and manual canonical.
- `_config.yml`: `url: "https://jyp90.github.io"`; exclude `docs/`, `preposts/`, `templates/`.
- `<meta name="theme-color">` per scheme (two tags with `media`).

### Header
- Logo, 「홈」, 「개발 도구」 dropdown (unchanged links), theme toggle button (`aria-label="테마 전환"`), GitHub icon. Email icon removed from header (stays in footer).
- Dropdown opens on click and keyboard (button + `aria-expanded`), closes on Esc / outside click; hover still works on desktop.

### Home (`_layouts/home.html`)
- Intro block: site title + one-line description from `site.description`.
- Tag filter: chip row built from all tags of listed posts (`site.posts` minus `categories: article`), sorted by count; 「전체」 first. Click filters client-side via `data-tags` on each item; selected chip has `aria-pressed="true"`; state mirrored to `?tag=` so it is linkable. No JS → full list visible.
- List grouped by year (`<h2>` per year). Each item: title (link), excerpt (front matter `excerpt` if set, else first paragraph, ~140 chars), meta line `YYYY.MM.DD · N분 · #tag #tag`.
- Reading time: `number_of_words` / 300 rounded up, minimum 1 (Liquid include `reading-time.html`, reused on post page). Korean `number_of_words` counts space-separated tokens; 300 tokens/min is the agreed approximation.

### Post page (`_layouts/post.html`)
- Header: title, meta line (date · reading time), tag chips linking to `/?tag=<tag>`.
- Table of contents generated client-side from `.post-content h2, h3` (only when ≥3 headings):
  - ≥1100px: sticky right sidebar, current section highlighted via IntersectionObserver.
  - <1100px: collapsible `<details>` 「목차」 above the body.
- Heading anchors: each h2/h3 gets an id (kramdown already emits one) and a hover `#` link (`aria-label="이 섹션 링크"`).
- Code blocks: language label (from `language-*` class) and 「복사」 button (`aria-label="코드 복사"`, shows 「복사됨」 for 1.5s, uses `navigator.clipboard`).
- Reading progress bar (2px, top, `aria-hidden`).
- Footer: prev/next as two cards, 「목록으로」 link, 「맨 위로」 button that appears after 1 viewport of scroll.
- Remove the per-paragraph scroll reveal; a single fade on load at most.
- Tables scroll horizontally inside their own wrapper; images max-width 100%.

### Files
- Edit: `_config.yml`, `_includes/head.html`, `_includes/header.html`, `_includes/footer.html` (inline styles → classes), `_layouts/home.html`, `_layouts/post.html`, `assets/style.css` (rewrite, keeping dev-tool selectors used by `_includes/2024-*.html`).
- New: `_includes/reading-time.html`, `assets/js/blog.js` (theme toggle, dropdown, tag filter, TOC, code copy, progress, back-to-top; one file, no build step).
- Before deleting any CSS selector, grep `_includes/`, `_layouts/`, `assets/js/` for it.

## Verification
- `bundle exec jekyll build` must pass locally if a working Ruby is available (Homebrew Ruby at `/opt/homebrew/opt/ruby/bin`, `bundle config set --local path vendor/bundle`, `vendor/` gitignored); otherwise the PR's own Actions build is the gate (add `pull_request` trigger for the build job only — deploy job stays `master`-only).
- Screen check at 375px and 1280px, both themes: home filter by tag, `?tag=` deep link, post TOC highlight, code copy, the four dev-tool pages still render and work.
- Lighthouse-free checks: no horizontal scroll at 375px, all icon buttons have `aria-label`, focus ring visible.

## Open items (not in this change)
- Public commit metadata of this repo contains former/current employer emails (36 commits). Rewriting history is a separate, user-approved step.
