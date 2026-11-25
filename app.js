(function () {
  "use strict";

  const storageKey = "ai-workshop-theme";
  const root = document.documentElement;

  function readTheme() {
    try {
      return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  // Apply a saved theme before the first paint; the controls are wired after parsing.
  root.dataset.theme = readTheme();

  function initializeTheme() {
    const toggle = document.querySelector("[data-theme-toggle]");
    const action = document.querySelector("[data-theme-action]");
    const icon = document.querySelector("[data-theme-icon]");

    function describeNextTheme() {
      const nextIsLight = root.dataset.theme === "dark";
      const label = nextIsLight ? "浅色" : "深色";
      action.textContent = label;
      toggle.setAttribute("aria-label", "切换到" + label + "主题");
      icon.setAttribute("href", nextIsLight ? "#icon-sun" : "#icon-moon");
    }

    toggle.addEventListener("click", function () {
      const theme = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = theme;
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // The current tab still switches themes if the browser blocks storage.
      }
      describeNextTheme();
    });

    describeNextTheme();
    toggle.hidden = false;
  }

  function initializeFilters() {
    const filters = document.querySelector("[data-filters]");
    const filterButtons = [...filters.querySelectorAll("[data-filter]")];
    const grid = document.querySelector("[data-project-grid]");
    const cards = [...grid.querySelectorAll("[data-category]")];
    const counter = document.querySelector("[data-project-count]");

    function applyFilter(category) {
      let visibleCount = 0;
      for (const card of cards) {
        const isVisible = category === "all" || card.dataset.category === category;
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      }

      for (const button of filterButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.filter === category));
      }

      counter.textContent = "显示 " + visibleCount + " / " + cards.length + " 个项目";
      grid.dataset.filtered = "true";
    }

    filters.addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");
      if (!button || button.getAttribute("aria-pressed") === "true") return;
      applyFilter(button.dataset.filter);
    });

    filters.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initializeTheme();
    initializeFilters();
  });
})();

// CI exercise: the "Static website checks" job validates this file's JavaScript syntax.
