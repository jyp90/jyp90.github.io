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
