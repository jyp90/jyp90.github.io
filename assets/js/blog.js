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

  function initTagFilter() {
    var bar = document.querySelector('.tag-filter');
    if (!bar) return;
    var chips = bar.querySelectorAll('.tag-chip');
    var items = document.querySelectorAll('.post-item');
    var groups = document.querySelectorAll('.year-group');
    var empty = document.querySelector('.filter-empty');
    var known = {};
    chips.forEach(function (c) { known[c.dataset.tag] = true; });

    function apply(tag, scrollToPressed) {
      if (!known[tag]) tag = '';
      var pressed = null;
      chips.forEach(function (c) {
        var isPressed = c.dataset.tag === tag;
        c.setAttribute('aria-pressed', String(isPressed));
        if (isPressed) pressed = c;
      });
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
      if (scrollToPressed && pressed) pressed.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    bar.hidden = false;
    bar.addEventListener('click', function (e) {
      var c = e.target.closest('.tag-chip');
      if (c) apply(c.dataset.tag, false);
    });
    apply(new URL(window.location.href).searchParams.get('tag') || '', true);
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
          btn.setAttribute('aria-label', '복사됨');
          setTimeout(function () { btn.textContent = '복사'; btn.setAttribute('aria-label', '코드 복사'); }, 1500);
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

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initDropdown();
    initTagFilter();
    initPost();
  });
})();
