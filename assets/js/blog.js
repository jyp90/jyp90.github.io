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

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initDropdown();
  });
})();
