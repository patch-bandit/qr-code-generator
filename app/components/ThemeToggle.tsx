"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Switches between the night alley (default) and dawn themes.
 * Uses document attributes only: no cookies, no browser storage, no network.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  }

  const nextLabel = theme === "dark" ? "dawn" : "night";
  return (
    <button
      type="button"
      className="theme-btn"
      data-theme-btn=""
      aria-label={`Switch to the ${nextLabel} theme`}
      onClick={toggle}
    >
      <span aria-hidden="true">{nextLabel}</span>
    </button>
  );
}
