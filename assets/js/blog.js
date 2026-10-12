(function () {
  'use strict';

  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function syncThemeColor() {
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', bg); });
  }

  function initTheme() {
    syncThemeColor();
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      syncThemeColor();
    });
  }

  function initDropdown() {
    var btn = document.querySelector('.dropdown-toggle');
    var menu = document.getElementById('tools-menu');
    if (!btn || !menu) return;
    function set(open) { btn.setAttribute('aria-expanded', String(open)); menu.hidden = !open; }
    var canHover = window.matchMedia('(hover: hover)').matches;
    // With hover, a mouse click lands on an already open menu; keep it open instead of toggling it shut.
    btn.addEventListener('click', function (e) { e.stopPropagation(); set(canHover && e.detail > 0 ? true : menu.hidden); });
    if (canHover) {
      var item = btn.closest('.has-dropdown');
      item.addEventListener('mouseenter', function () { set(true); });
      item.addEventListener('mouseleave', function () { set(false); });
    }
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  }

  var PAGE_SIZE = 20;
  var BREAK_EVERY = 6;
  var MAX_BREAKS = 3;

  function initHomeList() {
    var home = document.querySelector('.home');
    var items = Array.prototype.slice.call(document.querySelectorAll('.home .post-item'));
    if (!home || !items.length) return;
    var root = document.documentElement;
    var toolbar = home.querySelector('.list-toolbar');
    var status = home.querySelector('.list-status');
    var pager = home.querySelector('.pager');
    var empty = home.querySelector('.filter-empty');
    var groups = home.querySelectorAll('.year-group');
    var viewBtns = home.querySelectorAll('.view-btn');

    var counts = {};
    items.forEach(function (li) {
      li._tags = li.dataset.tags ? li.dataset.tags.split('|') : [];
      li._tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, 'ko'); });
    var state = readState();

    function readState() {
      var q = new URL(window.location.href).searchParams;
      var tag = q.get('tag') || '';
      return { tag: counts[tag] ? tag : '', page: Math.max(1, parseInt(q.get('page'), 10) || 1) };
    }

    function href(tag, page) {
      var url = new URL(window.location.href);
      url.hash = '';
      if (tag) url.searchParams.set('tag', tag); else url.searchParams.delete('tag');
      if (page > 1) url.searchParams.set('page', page); else url.searchParams.delete('page');
      return url.pathname + url.search;
    }

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function chip(tag, label) {
      var a = el('a', 'tag-chip', label);
      a.href = href(tag, 1);
      a.dataset.tag = tag;
      if (tag === state.tag) a.setAttribute('aria-current', 'true');
      return a;
    }

    // Tag chips sit between posts (after every 6th, which fills 2- and 3-column grid rows) instead of in one bar above the list.
    function tagBreak(chunk, first) {
      var li = el('li', 'tag-break');
      li.appendChild(el('p', 'tag-break-title', '태그로 둘러보기'));
      var box = el('div', 'tag-break-chips');
      if (first && state.tag) box.appendChild(chip('', '전체'));
      chunk.forEach(function (t) {
        var c = chip(t, '#' + t);
        c.appendChild(el('span', 'tag-count', String(counts[t])));
        box.appendChild(c);
      });
      li.appendChild(box);
      return li;
    }

    function pageLink(page, label, current, disabled) {
      if (disabled) return el('span', 'pager-link is-disabled', label);
      var a = el('a', 'pager-link', label);
      a.href = href(state.tag, page);
      a.dataset.page = page;
      if (current) a.setAttribute('aria-current', 'page');
      return a;
    }

    function render() {
      var filtered = items.filter(function (li) { return !state.tag || li._tags.indexOf(state.tag) !== -1; });
      var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (state.page > pages) state.page = pages;
      var visible = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      items.forEach(function (li) { li.hidden = visible.indexOf(li) === -1; });
      groups.forEach(function (g) { g.hidden = !g.querySelector('.post-item:not([hidden])'); });
      if (empty) empty.hidden = filtered.length > 0;

      home.querySelectorAll('.tag-break').forEach(function (b) { b.remove(); });
      var at = [];
      for (var k = 1; k <= MAX_BREAKS && k * BREAK_EVERY <= visible.length; k++) at.push(k * BREAK_EVERY);
      if (!at.length && visible.length) at.push(visible.length);
      var size = Math.ceil(tags.length / (at.length || 1));
      at.forEach(function (pos, i) {
        var chunk = tags.slice(i * size, (i + 1) * size);
        if (!chunk.length && !(i === 0 && state.tag)) return;
        var after = visible[pos - 1];
        after.parentNode.insertBefore(tagBreak(chunk, i === 0), after.nextSibling);
      });

      status.textContent = '';
      if (state.tag) {
        status.appendChild(el('strong', null, '#' + state.tag));
        status.appendChild(document.createTextNode(' 글 ' + filtered.length + '편 · '));
        var all = chip('', '전체 보기');
        all.className = 'list-status-reset';
        status.appendChild(all);
      } else {
        status.textContent = '글 ' + filtered.length + '편';
      }
      if (pages > 1) status.appendChild(document.createTextNode(' · ' + state.page + '/' + pages + '쪽'));

      pager.textContent = '';
      pager.hidden = pages < 2;
      if (pages > 1) {
        pager.appendChild(pageLink(state.page - 1, '이전', false, state.page === 1));
        for (var p = 1; p <= pages; p++) pager.appendChild(pageLink(p, String(p), p === state.page, false));
        pager.appendChild(pageLink(state.page + 1, '다음', false, state.page === pages));
      }
    }

    function go(tag, page) {
      state = { tag: tag, page: page };
      history.pushState(null, '', href(tag, page));
      render();
      toolbar.scrollIntoView({ block: 'start' });
    }

    function setView(view) {
      if (view === 'grid') root.setAttribute('data-home-view', 'grid'); else root.removeAttribute('data-home-view');
      viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
      try { localStorage.setItem('home-view', view); } catch (e) {}
    }

    home.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-tag], a[data-page]');
      if (a && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) {
        e.preventDefault();
        if (a.dataset.page) go(state.tag, +a.dataset.page); else go(a.dataset.tag, 1);
        return;
      }
      var v = e.target.closest('.view-btn');
      if (v) setView(v.dataset.view);
    });
    window.addEventListener('popstate', function () { state = readState(); render(); });

    viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === (root.getAttribute('data-home-view') || 'list'))); });
    toolbar.hidden = false;
    render();
  }

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
    toc.parentNode.classList.add('has-toc');
    toc.closest('.post').classList.add('has-toc');

    var line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) + 24;
    var current = null, ticking = false;
    function highlight() {
      ticking = false;
      var next = heads[0];
      heads.forEach(function (h) { if (h.getBoundingClientRect().top <= line) next = h; });
      if (next === current) return;
      if (current) links[current.id].removeAttribute('aria-current');
      links[next.id].setAttribute('aria-current', 'true');
      current = next;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(highlight); }
    }, { passive: true });
    highlight();
  }

  function initAnchors(content) {
    content.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'heading-anchor'; a.href = '#' + h.id; a.textContent = '#';
      a.setAttribute('aria-label', h.textContent.trim() + ' 섹션 링크');
      h.appendChild(a);
    });
  }

  function initCodeCopy(content) {
    content.querySelectorAll('pre').forEach(function (pre) {
      // ``` fences: div.language-x.highlighter-rouge; {% highlight %}: figure.highlight > pre > code.language-x
      var wrap = pre.closest('.highlighter-rouge, figure.highlight') || pre;
      var code = pre.querySelector('code[class*="language-"]');
      var m = (wrap.className + ' ' + (code ? code.className : '')).match(/language-([\w+-]+)/);
      var bar = document.createElement('div');
      bar.className = 'code-bar';
      if (m) { var lang = document.createElement('span'); lang.className = 'code-lang'; lang.textContent = m[1]; bar.appendChild(lang); }
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'code-copy'; btn.textContent = '복사';
      btn.setAttribute('aria-label', '코드 복사');
      function flash(label) {
        btn.textContent = label;
        btn.setAttribute('aria-label', label);
        setTimeout(function () { btn.textContent = '복사'; btn.setAttribute('aria-label', '코드 복사'); }, 1500);
      }
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.innerText).then(function () { flash('복사됨'); }, function () { flash('복사 실패'); });
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

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initDropdown();
    initHomeList();
    initPost();
  });
})();
