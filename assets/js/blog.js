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

  var ICONS = {
    chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
    chevronRight: '<path d="M9 18l6-6-6-6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };

  function icon(name, size) {
    var s = size || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
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
    // Tag blocks start folded on phones so they do not push posts off screen.
    var narrow = window.matchMedia('(max-width: 640px)');

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
      var details = el('details');
      details.open = !narrow.matches;
      var summary = el('summary', 'tag-break-title');
      summary.innerHTML = icon('tag', 16) + '<span>태그로 둘러보기</span>';
      summary.appendChild(el('span', 'tag-count', String(chunk.length)));
      summary.insertAdjacentHTML('beforeend', '<span class="fold-chevron">' + icon('chevronDown', 16) + '</span>');
      details.appendChild(summary);
      var box = el('div', 'tag-break-chips');
      if (first && state.tag) box.appendChild(chip('', '전체'));
      chunk.forEach(function (t) {
        var c = chip(t, '#' + t);
        c.appendChild(el('span', 'tag-count', String(counts[t])));
        box.appendChild(c);
      });
      details.appendChild(box);
      li.appendChild(details);
      return li;
    }

    function pageLink(page, label, current, disabled, iconName) {
      var a = el(disabled ? 'span' : 'a', 'pager-link' + (disabled ? ' is-disabled' : ''), iconName ? null : label);
      if (iconName) { a.innerHTML = icon(iconName); a.setAttribute('aria-label', label); a.title = label; }
      if (disabled) { a.setAttribute('aria-disabled', 'true'); return a; }
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
        var reset = chip('', '#' + state.tag);
        reset.className = 'filter-pill';
        reset.setAttribute('aria-label', '#' + state.tag + ' 필터 해제');
        reset.title = '필터 해제';
        reset.insertAdjacentHTML('beforeend', icon('x', 14));
        status.appendChild(reset);
        status.appendChild(document.createTextNode(' ' + filtered.length + '편'));
      } else {
        status.textContent = '글 ' + filtered.length + '편';
      }
      if (pages > 1) status.appendChild(document.createTextNode(' · ' + state.page + '/' + pages + '쪽'));

      pager.textContent = '';
      pager.hidden = pages < 2;
      if (pages > 1) {
        pager.appendChild(pageLink(state.page - 1, '이전 쪽', false, state.page === 1, 'chevronLeft'));
        for (var p = 1; p <= pages; p++) pager.appendChild(pageLink(p, String(p), p === state.page, false));
        pager.appendChild(pageLink(state.page + 1, '다음 쪽', false, state.page === pages, 'chevronRight'));
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
    narrow.addEventListener('change', function () {
      home.querySelectorAll('.tag-break details').forEach(function (d) { d.open = !narrow.matches; });
    });

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
    summary.innerHTML = icon('list', 16) + '<span>목차</span><span class="fold-chevron">' + icon('chevronDown', 16) + '</span>';
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
      btn.type = 'button'; btn.className = 'code-copy';
      function show(name, label) { btn.innerHTML = icon(name, 16); btn.setAttribute('aria-label', label); btn.title = label; }
      show('copy', '코드 복사');
      function flash(name, label) {
        show(name, label);
        btn.classList.toggle('is-done', name === 'check');
        setTimeout(function () { show('copy', '코드 복사'); btn.classList.remove('is-done'); }, 1500);
      }
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.innerText).then(function () { flash('check', '복사됨'); }, function () { flash('x', '복사 실패'); });
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

  // Came from the list: go back in history so the page turns backward and the list keeps its page, tag and scroll.
  function initBackLink() {
    var back = document.querySelector('.btn-back');
    if (!back || !document.referrer) return;
    var from;
    try { from = new URL(document.referrer); } catch (e) { return; }
    if (from.origin !== location.origin || from.pathname !== back.pathname) return;
    back.addEventListener('click', function (e) {
      if (history.length < 2) return;
      e.preventDefault();
      history.back();
    });
  }

  function initPost() {
    var content = document.querySelector('.post-content');
    if (!content) return;
    initToc(content);
    initAnchors(content);
    initCodeCopy(content);
    initScrollUi();
    initBackLink();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initHomeList();
    initPost();
  });
})();
