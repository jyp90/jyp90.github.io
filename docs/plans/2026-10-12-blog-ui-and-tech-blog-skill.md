# Blog UI redesign + `tech-blog` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readable home list + post page for the Jekyll blog, and a global skill that turns git/Claude Code work into a de-identified post and publishes it after approval.

**Architecture:** Part A keeps Jekyll + minima overrides: Liquid layouts render everything server-side; one dependency-free `assets/js/blog.js` adds theme toggle, dropdown, tag filter, TOC, code copy, progress and back-to-top. Part B is a skill folder tracked in this repo and symlinked into `~/.claude/skills/`, with a bash scan gate tested by a bash fixture test.

**Tech Stack:** Jekyll via `github-pages` gem (kramdown, rouge, `jekyll-seo-tag`, `jekyll-feed`), plain CSS custom properties, vanilla JS, bash + BSD/GNU grep.

**Spec:** `docs/specs/2026-10-12-blog-ui-redesign.md` (Part A), `docs/specs/2026-10-12-tech-blog-skill.md` (Part B).

## Global Constraints
- Repo: `~/Projects/jyp90.github.io`, default branch `master`, public. Work on a feature branch in a worktree; PR → merge.
- Commit identity in this repo: `jyp90@kakao.com` only. Check `git config user.email` before every commit; never commit with any other address.
- Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- No company/employer/client/service names, work emails or internal hosts in any tracked file, commit message or PR text.
- Existing post URLs (`/blog/YYYY/MM/DD/<slug>.html`, `/article/...`, `/java/...`, `/spring/...`) and front matter must keep working unchanged.
- UI copy Korean; every icon-only button has `aria-label`.
- No new gems; only plugins shipped by `github-pages` (`jekyll-seo-tag`, `jekyll-feed`).
- `localStorage` access always inside try/catch.
- `prefers-reduced-motion: reduce` disables transitions/animations.

## Review Focus
1. Posts with no `tags` (all 2023–2024 posts) → home list and post header render; no empty chip row/`#` artefacts. (Task A3, A4 build greps.)
2. `?tag=` with a URL-encoded Korean tag (`%EB%A9%B1%EB%93%B1%EC%84%B1`) or an unknown tag → decoded match filters; unknown shows the full list with 「전체」 pressed. (Task A3 JS.)
3. `localStorage` throws (private mode / blocked) → theme follows `prefers-color-scheme`, toggle still flips for the session. (Task A2 JS.)
4. Dev-tool pages (`categories: article`, `layout: post`, their own include CSS/JS) → still render and work; TOC not injected (fewer than 3 h2/h3), copy button only on `pre`. (Task A4 check.)
5. Forbidden-terms file with blank lines / `#` comments → blank lines must not match every line (`grep -f` with an empty pattern matches everything). (Task B1 test.)

---

## Part A — Blog UI

### Task A1: Build pipeline, config, head

**Files:**
- Modify: `_config.yml`, `_includes/head.html`, `.github/workflows/jekyll.yml`, `.gitignore` (create if missing)

**Interfaces:**
- Produces: `<html data-theme>` set before paint by an inline script; `site.url = https://jyp90.github.io`; build passes locally (`bundle exec jekyll build`) or in the PR's Actions build job.

- [ ] **Step 1: Local Ruby toolchain (no system changes)**

```bash
cd <worktree>
export PATH=/opt/homebrew/opt/ruby/bin:$PATH
bundle config set --local path vendor/bundle
bundle install
bundle exec jekyll build 2>&1 | tail -5
```
If `bundle install` fails on Ruby 4.0 (old `github-pages` deps), do not install another Ruby; record the error and rely on the PR build job from Step 4 as the gate.

- [ ] **Step 2: `_config.yml`**

Set `url: "https://jyp90.github.io"`, `title: 뇽이의 TIL` (unchanged), add `jekyll-seo-tag` under `plugins:`, and add to `exclude:` the entries `docs/`, `preposts/`, `templates/`, `vendor/`, `.bundle/`, `.claude/`.
`.gitignore` gains `vendor/`, `.bundle/`, `_site/`, `.jekyll-cache/`.

- [ ] **Step 3: `_includes/head.html`** — replace the file's content with (no `<!DOCTYPE>`/`<html>` wrapper — `default.html` already has them):

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0d1117" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <script>
    (function () {
      var t = null;
      try { t = localStorage.getItem('theme'); } catch (e) {}
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    })();
  </script>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="{{ "/assets/main.css" | relative_url }}">
  <link rel="stylesheet" href="{{ "/assets/reset.css" | relative_url }}">
  <link rel="stylesheet" href="{{ "/assets/style.css" | relative_url }}">
  <link rel="alternate" type="application/rss+xml" title="{{ site.title | escape }}" href="{{ "/feed.xml" | relative_url }}">
  <link href="{{ site.asset_url }}/favicon.ico" rel="shortcut icon" type="image/vnd.microsoft.icon">
  {% seo %}
  <script defer src="{{ "/assets/js/blog.js" | relative_url }}"></script>
</head>
```
`{% seo %}` emits `<title>` as `page.title | site.title` and home as `site.title`; delete the old manual `<title>`, canonical and description. Create an empty `assets/js/blog.js` so the build has no 404 (filled in A2–A4).

- [ ] **Step 4: PR build job** — in `.github/workflows/jekyll.yml` add `pull_request: branches: ["master"]` under `on:`, and gate the `deploy` job (and the `Setup Pages`/`Upload artifact` steps) with `if: github.event_name != 'pull_request'` so PRs only build.

- [ ] **Step 5: Verify**

```bash
bundle exec jekyll build && grep -o '<title>[^<]*</title>' _site/index.html _site/blog/2026/10/11/sn-house-interior.html
```
Expected: `<title>뇽이의 TIL</title>` (home may include the description suffix from jekyll-seo-tag — acceptable) and `<title>이사 갈 집 인테리어, … | 뇽이의 TIL</title>`. `grep -c 'og:title' _site/index.html` ≥ 1.

- [ ] **Step 6: Commit** — `chore(blog): seo tag, site url, PR build job`

### Task A2: Tokens, light theme, base typography, header/footer, theme + dropdown JS

**Files:**
- Modify: `assets/style.css` (rewrite), `_includes/header.html`, `_includes/footer.html`, `assets/js/blog.js`

**Interfaces:**
- Consumes: `data-theme` from A1.
- Produces: CSS tokens used by A3/A4 (`--bg-primary --bg-secondary --bg-tertiary --border-primary --text-primary --text-secondary --text-muted --accent-primary --accent-secondary --radius-sm --radius-md --radius-lg --measure`), `blog.js` module scaffold `document.addEventListener('DOMContentLoaded', …)` with named functions `initTheme()`, `initDropdown()`; A3/A4 append `initTagFilter()`, `initPost()` calls to the same listener.

- [ ] **Step 1: Inventory selectors still used** — before deleting any rule:

```bash
for c in $(grep -oE '^\.[a-zA-Z][a-zA-Z0-9_-]*' assets/style.css | sort -u | tr -d .); do
  n=$(grep -rlw -- "$c" _includes _layouts _posts assets/js index.markdown about.markdown 404.html 2>/dev/null | wc -l)
  [ "$n" -eq 0 ] && echo "unused: $c"
done
```
Delete only classes reported unused; keep every selector the `_includes/2024-*.html` tool pages use.

- [ ] **Step 2: Tokens** — top of `style.css`:

```css
:root {
  --bg-primary: #0d1117; --bg-secondary: #161b22; --bg-tertiary: #21262d;
  --border-primary: #30363d; --border-secondary: #21262d;
  --text-primary: #e6edf3; --text-secondary: #8b949e; --text-muted: #6e7681;
  --accent-primary: #58a6ff; --accent-secondary: #a371f7;
  --accent-success: #3fb950; --accent-warning: #d29922; --accent-danger: #f85149;
  --code-bg: #161b22;
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
  --measure: 72ch; --header-height: 60px;
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: dark;
}
:root[data-theme="light"] { /* light values */ }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { /* same light values */ } }
```
Light values: `--bg-primary #ffffff; --bg-secondary #f6f8fa; --bg-tertiary #eaeef2; --border-primary #d0d7de; --border-secondary #eaeef2; --text-primary #1f2328; --text-secondary #59636e; --text-muted #6e7781; --accent-primary #0969da; --accent-secondary #8250df; --accent-success #1a7f37; --accent-warning #9a6700; --accent-danger #cf222e; --code-bg #f6f8fa; color-scheme: light;`. Every colour in the file references a token (no raw hex outside the token blocks, except rouge colours which get one dark and one light block).

- [ ] **Step 3: Base** — `body { background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-sans); font-size: 17px; line-height: 1.75; -webkit-font-smoothing: antialiased; }`, `.post-content` max-width `var(--measure)`, `:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }`, and

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 4: Header** — `_includes/header.html`: dropdown trigger becomes `<button type="button" class="dropdown-toggle" aria-expanded="false" aria-controls="tools-menu">개발 도구</button>` with `<ul id="tools-menu" class="dropdown-menu" hidden>`; remove the mail icon item; add before the GitHub link:

```html
<li><button type="button" class="theme-toggle" aria-label="테마 전환">
  <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
</button></li>
```
GitHub link gets `aria-label="GitHub"`. CSS shows `.icon-sun` in dark, `.icon-moon` in light. Mobile (<640px): header wraps without horizontal scroll.

- [ ] **Step 5: Footer** — replace every inline `style="…"` in `_includes/footer.html` with classes (`.footer-subheading`, `.footer-bottom`, `.footer-note`) defined in `style.css`.

- [ ] **Step 6: `assets/js/blog.js`**

```js
(function () {
  'use strict';

  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function initTheme() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  function initDropdown() {
    var btn = document.querySelector('.dropdown-toggle');
    var menu = document.getElementById('tools-menu');
    if (!btn || !menu) return;
    function set(open) { btn.setAttribute('aria-expanded', String(open)); menu.hidden = !open; }
    btn.addEventListener('click', function (e) { e.stopPropagation(); set(menu.hidden); });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initDropdown();
  });
})();
```
Desktop hover: CSS `.has-dropdown:hover .dropdown-menu { display: block; }` stays alongside `[hidden]`.

- [ ] **Step 7: Verify** — `bundle exec jekyll build` (or push branch and watch PR build). Then serve (`bundle exec jekyll serve --port 4010`) and check by hand or let the main session check in Aside: toggle flips theme and survives reload; dropdown opens by click, Esc closes and refocuses; 375px no horizontal scroll; the four tool pages render.

- [ ] **Step 8: Commit** — `feat(blog): light/dark tokens, header toggle, accessible dropdown`

### Task A3: Home list — reading time, year groups, tag filter

**Files:**
- Create: `_includes/reading-time.html`, `_includes/post-meta.html`
- Modify: `_layouts/home.html`, `assets/style.css`, `assets/js/blog.js`

**Interfaces:**
- Consumes: tokens, `blog.js` listener from A2.
- Produces: `{% include reading-time.html content=post.content %}` → e.g. `5분`; `{% include post-meta.html post=post %}` used by A4; list items `<li class="post-item" data-tags="tag1|tag2">`; chips `<button class="tag-chip" data-tag="…" aria-pressed>`; `initTagFilter()`.

- [ ] **Step 1: `_includes/reading-time.html`**

```liquid
{%- assign rt_words = include.content | strip_html | number_of_words -%}
{%- assign rt_min = rt_words | divided_by: 300 -%}
{%- assign rt_rest = rt_words | modulo: 300 -%}
{%- if rt_rest > 0 -%}{%- assign rt_min = rt_min | plus: 1 -%}{%- endif -%}
{%- if rt_min < 1 -%}{%- assign rt_min = 1 -%}{%- endif -%}
{{- rt_min -}}분
```

- [ ] **Step 2: `_includes/post-meta.html`** (Jekyll always exposes `tags` as an array, also when front matter gives a string)

```liquid
<p class="post-meta">
  <time datetime="{{ include.post.date | date_to_xmlschema }}">{{ include.post.date | date: "%Y.%m.%d" }}</time>
  <span aria-hidden="true">·</span>
  <span>{% include reading-time.html content=include.post.content %}</span>
  {%- for t in include.post.tags -%}{%- assign tt = t | strip -%}{%- if tt != "" %} <a class="post-tag" href="{{ '/' | relative_url }}?tag={{ tt | url_encode }}">#{{ tt }}</a>{%- endif -%}{%- endfor -%}
</p>
```

- [ ] **Step 3: `_layouts/home.html`**

```liquid
---
layout: default
---
<div class="home">
  <section class="home-intro">
    <h1 class="home-title">{{ site.title }}</h1>
    <p class="home-desc">{{ site.description }}</p>
  </section>

  {%- assign listed = "" | split: "" -%}
  {%- for p in site.posts -%}{%- unless p.categories contains 'article' -%}{%- assign listed = listed | push: p -%}{%- endunless -%}{%- endfor -%}
  {%- assign all_tags = "" | split: "" -%}
  {%- for p in listed -%}{%- for t in p.tags -%}{%- assign all_tags = all_tags | push: t -%}{%- endfor -%}{%- endfor -%}
  {%- assign uniq_tags = all_tags | uniq | sort_natural -%}

  {%- if uniq_tags.size > 0 -%}
  <div class="tag-filter" role="group" aria-label="태그 필터" hidden>
    <button type="button" class="tag-chip" data-tag="" aria-pressed="true">전체</button>
    {%- for t in uniq_tags -%}
    <button type="button" class="tag-chip" data-tag="{{ t | escape }}" aria-pressed="false">#{{ t }}</button>
    {%- endfor -%}
  </div>
  {%- endif -%}

  {%- assign by_year = listed | group_by_exp: "p", "p.date | date: '%Y'" -%}
  {%- for y in by_year -%}
  <section class="year-group">
    <h2 class="year-heading">{{ y.name }}</h2>
    <ul class="post-list">
      {%- for post in y.items -%}
      <li class="post-item" data-tags="{{ post.tags | join: '|' | escape }}">
        <h3 class="post-item-title"><a class="post-link" href="{{ post.url | relative_url }}">{{ post.title | escape }}</a></h3>
        <p class="post-excerpt">{{ post.excerpt | strip_html | strip_newlines | truncate: 140 }}</p>
        {% include post-meta.html post=post %}
      </li>
      {%- endfor -%}
    </ul>
  </section>
  {%- endfor -%}
  <p class="filter-empty" hidden>이 태그의 글이 없습니다.</p>
</div>
```
Chips are sorted naturally (not by count) — record this deviation in the PR body. The filter row is `hidden` until JS removes it (no-JS shows the full list, no dead buttons).

- [ ] **Step 4: `initTagFilter()`** — add to `blog.js` and call it in the listener:

```js
  function initTagFilter() {
    var bar = document.querySelector('.tag-filter');
    if (!bar) return;
    var chips = bar.querySelectorAll('.tag-chip');
    var items = document.querySelectorAll('.post-item');
    var groups = document.querySelectorAll('.year-group');
    var empty = document.querySelector('.filter-empty');
    var known = {};
    chips.forEach(function (c) { known[c.dataset.tag] = true; });

    function apply(tag) {
      if (!known[tag]) tag = '';
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.tag === tag)); });
      var shown = 0;
      items.forEach(function (li) {
        var on = tag === '' || li.dataset.tags.split('|').indexOf(tag) !== -1;
        li.hidden = !on;
        if (on) shown++;
      });
      groups.forEach(function (g) { g.hidden = !g.querySelector('.post-item:not([hidden])'); });
      if (empty) empty.hidden = shown > 0;
      var url = new URL(window.location.href);
      if (tag) url.searchParams.set('tag', tag); else url.searchParams.delete('tag');
      history.replaceState(null, '', url);
    }

    bar.hidden = false;
    bar.addEventListener('click', function (e) {
      var c = e.target.closest('.tag-chip');
      if (c) apply(c.dataset.tag);
    });
    apply(new URL(window.location.href).searchParams.get('tag') || '');
  }
```
`URLSearchParams.get` already decodes `%EB%A9%B1…` → `멱등성` (Review Focus 2).

- [ ] **Step 5: Styles** — `.home-intro`, `.tag-filter` (wrapping chip row, `overflow-x: auto` not used — wrap instead), `.tag-chip` + `[aria-pressed="true"]` state, `.year-heading`, `.post-item` (no card borders; separator line), `.post-meta` with `font-variant-numeric: tabular-nums`, `.post-tag`.

- [ ] **Step 6: Verify (build greps)**

```bash
bundle exec jekyll build
grep -c 'class="post-item"' _site/index.html        # = $(grep -L 'categories: *article' _posts/* | wc -l)
grep -c 'class="year-heading"' _site/index.html     # = number of distinct years among those posts
grep -c 'data-tag="멱등성"' _site/index.html          # 1
grep -o 'href="/?tag=[^"]*"' _site/index.html | head -3   # url-encoded tags
grep -c '#</a>' _site/index.html                      # 0 (no empty tag links)
```
In the browser: `/?tag=%EB%A9%B1%EB%93%B1%EC%84%B1` shows only 멱등성 posts with that chip pressed; `/?tag=없는태그` shows all with 「전체」 pressed.

- [ ] **Step 7: Commit** — `feat(blog): home list with year groups, reading time, tag filter`

### Task A4: Post page — header, TOC, anchors, code copy, progress, footer

**Files:**
- Modify: `_layouts/post.html`, `assets/style.css`, `assets/js/blog.js`

**Interfaces:**
- Consumes: `post-meta.html` (A3), tokens (A2), `blog.js` listener.
- Produces: `initPost()`.

- [ ] **Step 1: `_layouts/post.html`**

```liquid
---
layout: default
---
<div class="reading-progress" aria-hidden="true"></div>
<article class="post" itemscope itemtype="http://schema.org/BlogPosting">
  <header class="post-header">
    <h1 class="post-title" itemprop="name headline">{{ page.title | escape }}</h1>
    {% include post-meta.html post=page %}
  </header>
  <div class="post-layout">
    <div class="post-content" itemprop="articleBody">
      {{ content }}
    </div>
    <aside class="post-toc" aria-label="목차" hidden></aside>
  </div>
  <footer class="post-footer">
    <nav class="post-navigation" aria-label="이전·다음 글">
      {%- if page.previous.url -%}
      <a class="prev-post" href="{{ page.previous.url | relative_url }}"><span class="nav-label">이전 글</span><span class="nav-title">{{ page.previous.title | escape }}</span></a>
      {%- endif -%}
      {%- if page.next.url -%}
      <a class="next-post" href="{{ page.next.url | relative_url }}"><span class="nav-label">다음 글</span><span class="nav-title">{{ page.next.title | escape }}</span></a>
      {%- endif -%}
    </nav>
    <a class="btn-back" href="{{ '/' | relative_url }}">목록으로</a>
  </footer>
</article>
<button type="button" class="back-to-top" aria-label="맨 위로" hidden>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
</button>
```
The old inline `<script>` (scroll reveal) is removed.

- [ ] **Step 2: `initPost()`** — add to `blog.js`, call in the listener:

```js
  function slugId(h, used) {
    if (h.id) return h.id;
    var base = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
    var id = base, n = 2;
    while (used[id] || document.getElementById(id)) id = base + '-' + n++;
    h.id = id;
    return id;
  }

  function initToc(content) {
    var heads = content.querySelectorAll('h2, h3');
    var toc = document.querySelector('.post-toc');
    if (!toc || heads.length < 3) return;
    var used = {};
    var list = document.createElement('ol');
    var links = {};
    heads.forEach(function (h) {
      var id = slugId(h, used); used[id] = true;
      var a = document.createElement('a');
      a.href = '#' + id; a.textContent = h.textContent;
      var li = document.createElement('li');
      li.className = 'toc-' + h.tagName.toLowerCase();
      li.appendChild(a); list.appendChild(li);
      links[id] = a;
    });
    var details = document.createElement('details');
    details.className = 'toc-inline';
    var summary = document.createElement('summary');
    summary.textContent = '목차';
    details.appendChild(summary);
    details.appendChild(list.cloneNode(true));
    content.insertBefore(details, content.firstChild);
    toc.appendChild(list);
    toc.hidden = false;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].removeAttribute('aria-current'); });
        links[e.target.id].setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '0px 0px -70% 0px' });
    heads.forEach(function (h) { obs.observe(h); });
  }

  function initAnchors(content) {
    content.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'heading-anchor'; a.href = '#' + h.id; a.textContent = '#';
      a.setAttribute('aria-label', '이 섹션 링크');
      h.appendChild(a);
    });
  }

  function initCodeCopy(content) {
    content.querySelectorAll('pre').forEach(function (pre) {
      var wrap = pre.closest('.highlighter-rouge') || pre;
      var m = (wrap.className || '').match(/language-([\w+-]+)/);
      var bar = document.createElement('div');
      bar.className = 'code-bar';
      if (m) { var lang = document.createElement('span'); lang.className = 'code-lang'; lang.textContent = m[1]; bar.appendChild(lang); }
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'code-copy'; btn.textContent = '복사';
      btn.setAttribute('aria-label', '코드 복사');
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.innerText).then(function () {
          btn.textContent = '복사됨';
          setTimeout(function () { btn.textContent = '복사'; }, 1500);
        });
      });
      bar.appendChild(btn);
      wrap.parentNode.insertBefore(bar, wrap);
    });
  }

  function initScrollUi() {
    var bar = document.querySelector('.reading-progress');
    var top = document.querySelector('.back-to-top');
    function onScroll() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
      if (top) top.hidden = window.scrollY < window.innerHeight;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    if (top) top.addEventListener('click', function () { window.scrollTo({ top: 0 }); });
    onScroll();
  }

  function initPost() {
    var content = document.querySelector('.post-content');
    if (!content) return;
    initToc(content);
    initAnchors(content);
    initCodeCopy(content);
    initScrollUi();
  }
```
`initAnchors` runs after `initToc` so the TOC text has no `#`. Clipboard failure (insecure context) leaves the label unchanged — acceptable, no swallow-and-pretend.

- [ ] **Step 3: Styles** — `.post-layout` grid: single column; at `min-width: 1100px` `grid-template-columns: minmax(0, var(--measure)) 240px; gap: 48px`, `.post-toc` `position: sticky; top: calc(var(--header-height) + 24px); max-height: calc(100vh - 120px); overflow: auto`; `.toc-inline` hidden at ≥1100px; `.post-toc a[aria-current]` accent colour; `.toc-h3` indented. `.heading-anchor` visible on `h2:hover`/`:focus-visible`. `.code-bar` flush on top of the block. `.reading-progress` fixed 2px, `transform-origin: left`, `transform: scaleX(0)`. `.back-to-top` fixed bottom-right 44×44. Tables: `.post-content table { display: block; overflow-x: auto; }`. Images `max-width: 100%; height: auto`. Rouge colours for both themes.

- [ ] **Step 4: Verify**

```bash
bundle exec jekyll build
grep -c 'class="post-toc"' _site/blog/2026/10/11/sn-house-interior.html          # 1
grep -c 'scroll-reveal' _site/blog/2026/10/11/sn-house-interior.html            # 0
grep -c 'class="post-tag"' _site/java/2023/10/04/*.html 2>/dev/null || ls _site/java   # old post builds; 0 tags OK
ls _site/article/2024/02/22/jwt-debugger.html                                   # tool page still built
```
Browser (main session, Aside): sn-house-interior post at 1280px shows sticky TOC with highlight following scroll; 375px shows 「목차」 details; code copy shows 「복사됨」; JWT Debugger and JSON Prettier still work; no TOC on tool pages.

- [ ] **Step 5: Commit** — `feat(blog): post page TOC, anchors, code copy, progress, back-to-top`

### Task A5: Screen check, PR, deploy (main session)

- [ ] Serve the worktree (`bundle exec jekyll serve --port 4010` or the PR build artifact) and walk the checks from A2–A4 in the user's Aside browser at 375px and 1280px in both themes.
- [ ] Open PR `feat/blog-ui-redesign` → master; PR build green → merge → `gh run watch` the Pages deploy → `curl -s -o /dev/null -w '%{http_code}' https://jyp90.github.io/` and the sn-house-interior URL both 200.
- [ ] Update this repo's `CLAUDE.md`: add `blog.js` and the new includes to 「디렉토리 구조」, the PR build job, and the local Homebrew Ruby build recipe.

---

## Part B — `tech-blog` skill

### Task B1: `scan.sh` + `scan.test.sh` (TDD)

**Files:**
- Create: `.claude/skills/tech-blog/scan.sh`, `.claude/skills/tech-blog/scan.test.sh`

**Interfaces:**
- Produces: `bash scan.sh <file>...` → stdout lines `<file>:<line>: <rule>`; exit 0/1/2. Env `TECH_BLOG_TERMS` overrides the terms path (tests only). Rule names: `term#N`, `email`, `private-ip`, `internal-host`, `internal-link`, `ticket-key`, `account-id`, `secret`.

- [ ] **Step 1: Failing test** — `scan.test.sh`:

```bash
#!/usr/bin/env bash
# Fixture test for scan.sh. Run: bash .claude/skills/tech-blog/scan.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
check() { # name expected_exit expected_grep file
  out=$(TECH_BLOG_TERMS="$tmp/terms.txt" bash "$here/scan.sh" "$4" 2>&1); code=$?
  if [ "$code" = "$2" ] && { [ -z "$3" ] || printf '%s\n' "$out" | grep -qE -- "$3"; }; then pass=$((pass+1))
  else fail=$((fail+1)); echo "FAIL $1: exit=$code out=$out"; fi
}

printf '# header comment\n\nAcmeCorp\n  \nwidgetly\n' > "$tmp/terms.txt"

printf '일반적인 멱등성 설명입니다.\nUTF-8, SHA-256, ISO-8601, RFC-7231\ngit@github.com:jyp90/x.git\n연락: jyp90@kakao.com\n' > "$tmp/clean.md"
check clean 0 '' "$tmp/clean.md"

printf 'line one\nwe built it at acmecorp\n' > "$tmp/term.md"
check term-case-insensitive 1 ':2: term#1$' "$tmp/term.md"
out=$(TECH_BLOG_TERMS="$tmp/terms.txt" bash "$here/scan.sh" "$tmp/term.md")
printf '%s' "$out" | grep -qi acme && { fail=$((fail+1)); echo "FAIL term-not-echoed"; } || pass=$((pass+1))

printf 'mail me: kim@company.co.kr\n' > "$tmp/email.md";   check email 1 ':1: email$' "$tmp/email.md"
printf 'db at 10.0.3.7 and 192.168.1.20\n' > "$tmp/ip.md"; check private-ip 1 ':1: private-ip$' "$tmp/ip.md"
printf 'see api.billing.internal\n' > "$tmp/host.md";       check internal-host 1 ':1: internal-host$' "$tmp/host.md"
printf 'https://x.atlassian.net/browse/A\n' > "$tmp/link.md"; check internal-link 1 ':1: internal-link$' "$tmp/link.md"
printf 'fixed in PAY-1234\n' > "$tmp/ticket.md";            check ticket-key 1 ':1: ticket-key$' "$tmp/ticket.md"
printf 'account 123456789012 here\n' > "$tmp/acct.md";      check account-id 1 ':1: account-id$' "$tmp/acct.md"
printf 'key AKIAABCDEFGHIJKLMNOP\n' > "$tmp/secret.md";      check secret 1 ':1: secret$' "$tmp/secret.md"

printf '# only a comment\n\n' > "$tmp/terms.txt"
check empty-terms 2 'terms file' "$tmp/clean.md"
rm "$tmp/terms.txt"
check missing-terms 2 'terms file' "$tmp/clean.md"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
```

- [ ] **Step 2: Run, expect failure** — `bash .claude/skills/tech-blog/scan.test.sh` → `scan.sh` missing, `fail>0`, exit 1.

- [ ] **Step 3: Implement `scan.sh`**

```bash
#!/usr/bin/env bash
# De-identification gate for blog drafts.
# Usage: scan.sh <file>...   Exit 0 clean, 1 findings, 2 terms file missing/empty.
# Terms: ~/.config/tech-blog/forbidden-terms.txt (one per line, # comments). Matched terms are never printed.
set -u
terms_file="${TECH_BLOG_TERMS:-$HOME/.config/tech-blog/forbidden-terms.txt}"
own_email='jyp90@kakao.com'
public_prefixes='^(UTF|ISO|SHA|MD|AES|RSA|HS|RS|ES|PS|RFC|CVE|HTTP|TLS|JDK|JSR|PEP)-'

[ $# -gt 0 ] || { echo "usage: scan.sh <file>..." >&2; exit 2; }
terms=$(grep -v '^[[:space:]]*#' "$terms_file" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$')
[ -n "$terms" ] || { echo "terms file missing or empty: $terms_file" >&2; exit 2; }

findings=""
add() { findings="$findings$1"$'\n'; }

lines_matching() { # rule ERE file
  grep -nE -- "$2" "$3" | cut -d: -f1 | while read -r l; do echo "$3:$l: $1"; done
}

for f in "$@"; do
  n=0
  while IFS= read -r t; do
    n=$((n+1))
    hits=$(grep -niF -- "$t" "$f" | cut -d: -f1 | while read -r l; do echo "$f:$l: term#$n"; done)
    [ -n "$hits" ] && add "$hits"
  done <<< "$terms"

  hits=$(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" \
    | grep -vE ":(git@|${own_email//./\\.}$|[^:]*@example\.(com|org)$)" \
    | cut -d: -f1 | sort -un | while read -r l; do echo "$f:$l: email"; done)
  [ -n "$hits" ] && add "$hits"

  hits=$(grep -noE '(^|[^A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-[0-9]+' "$f" \
    | sed -E 's/^([0-9]+):[^A-Z]?/\1:/' | while IFS=: read -r l k; do
        echo "$k" | grep -qE "$public_prefixes" || echo "$f:$l: ticket-key"; done | sort -u)
  [ -n "$hits" ] && add "$hits"

  for rule in \
    'private-ip|(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})' \
    'internal-host|[A-Za-z0-9-]+\.(internal|local|corp|lan)([^A-Za-z0-9-]|$)' \
    'internal-link|atlassian\.net|slack\.com/archives|notion\.so' \
    'account-id|(^|[^0-9])[0-9]{12}([^0-9]|$)' \
    'secret|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|PRIVATE KEY'; do
    hits=$(lines_matching "${rule%%|*}" "${rule#*|}" "$f")
    [ -n "$hits" ] && add "$hits"
  done
done

[ -z "$findings" ] && exit 0
printf '%s' "$findings"
exit 1
```

- [ ] **Step 4: Run, expect pass** — `bash .claude/skills/tech-blog/scan.test.sh` → `pass=12 fail=0`, exit 0. Also run under `shellcheck` if installed (`which shellcheck`), fix warnings.

- [ ] **Step 5: Commit** — `feat(tech-blog): de-identification scan gate with fixture test`

### Task B2: `SKILL.md`, references, symlink, terms file, pressure check + dry run

**Files:**
- Create: `.claude/skills/tech-blog/SKILL.md`, `.claude/skills/tech-blog/references/style.md`, `.claude/skills/tech-blog/references/sources.md`
- Outside repo: symlink `~/.claude/skills/tech-blog`, file `~/.config/tech-blog/forbidden-terms.txt`

**Interfaces:**
- Consumes: `scan.sh` (B1).

- [ ] **Step 1: Baseline (RED) per `superpowers:writing-skills`** — dispatch a subagent *without* the skill: "Write a blog post for jyp90.github.io from the last 2 weeks of git history in <a work repo under ~/Projects>, then publish it." Record where it leaks (repo names, emails, ticket keys) or publishes without asking. Keep the transcript excerpt in the scratchpad.

- [ ] **Step 2: `SKILL.md`** — frontmatter:

```yaml
---
name: tech-blog
description: Use when the user wants to write or publish a post on their tech blog (jyp90.github.io) from their own work — git history/branches of any repo, or what they learned using Claude Code (skills, hooks, CLAUDE.md rules, memories). Triggers - /tech-blog, 블로그 글, 블로그에 올려, 기술 블로그, 포스팅, TIL 써줘, 작업한 거 글로 정리.
---
```
Body (English, ≤ ~150 lines): the spec's Hard rule section verbatim; Workflow steps 1–6 verbatim from the spec with exact commands; red-flag table (e.g. "the repo is private so the name is harmless" → it is still a company identifier; "scan passed so it's safe" → scan only catches listed terms, re-read for indirect identifiers like product feature names and customer counts; "user said 올려 earlier" → approval is per draft, in the current turn); first-run setup (create `~/.config/tech-blog/`, write the header comment, pre-seed domains: `git -C <repo> config user.email` for each discovered repo, keep the part after `@` for every address ≠ `jyp90@kakao.com`, append unique domains straight to the file without echoing); publish commands with the email guard:

```bash
B=~/Projects/jyp90.github.io
[ -d "$B" ] || git clone -q git@github.com:jyp90/jyp90.github.io.git "$B"
e=$(git -C "$B" config user.email); [ -z "$e" ] && git -C "$B" config user.email jyp90@kakao.com && e=jyp90@kakao.com
[ "$e" = jyp90@kakao.com ] || { echo "blog repo email is not jyp90@kakao.com — stop"; exit 1; }
```

- [ ] **Step 3: `references/style.md`** — front matter template (copy of the 2026-01-17 post's fields), section skeleton, tone rules, one short good/bad de-identification example pair using invented names (`AcmeCorp` style placeholders only), slug rules (`[a-z0-9-]`, English, ≤5 words).

- [ ] **Step 4: `references/sources.md`** — commands for: repo discovery (`find ~/Projects ~/IdeaProjects -maxdepth 3 -name .git -type d`), author filter (`git log --all --author=<email> --since=<date> --format='%h %ad %s' --date=short` per email), branch summary (`git log main..<branch> --stat`), memories (`ls -t ~/.claude/projects/*/memory/*.md`), skills (`ls ~/.claude/skills ~/Projects/*/.claude/skills`), transcripts (python one-liner extracting `type=user` text blocks and final assistant text from a jsonl, read-only); note that evidence stays in the scratchpad.

- [ ] **Step 5: Install** — `ln -s ~/Projects/jyp90.github.io/.claude/skills/tech-blog ~/.claude/skills/tech-blog` (after merge, so the symlink points at `master` content), create `~/.config/tech-blog/forbidden-terms.txt` with the header comment and pre-seeded domains; ask the user to add company/service/client names.

- [ ] **Step 6: GREEN pressure check** — same prompt as Step 1 with the skill loaded and a planted forbidden term in a source commit message; the subagent must stop at the scan (exit 1) or not publish without approval. Fix wording loopholes and rerun until it holds.

- [ ] **Step 7: Dry run** — source = Claude Code learnings over the last 14 days; produce one draft through workflow step 5 (no push); `bash scan.sh <draft>` exit 0; `grep -iF -f <(grep -v '^#' ~/.config/tech-blog/forbidden-terms.txt | grep -v '^$') <draft>` returns nothing. Show the user the preview link.

- [ ] **Step 8: Commit** — `feat(tech-blog): skill workflow, style and source references`; PR → merge; update this repo's `CLAUDE.md` with a 「블로그 글 작성 스킬」 pointer.
