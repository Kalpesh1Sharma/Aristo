"use client";
import { useEffect, useState } from "react";

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem("mg-theme");
    const next = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    requestAnimationFrame(() => setTheme(next));
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mg-theme", next);
    setTheme(next);
  }
  return <button className="theme-switch" type="button" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "light"}><span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>{theme === "dark" ? "Dark" : "Light"}</button>;
}
