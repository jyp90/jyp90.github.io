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

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initDropdown();
    initTagFilter();
  });
})();
