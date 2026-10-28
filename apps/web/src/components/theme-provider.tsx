"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

function getTheme(): Theme {
  const stored = window.localStorage.getItem("erp-theme");
  return stored === "dark" || stored === "system" ? stored : "light";
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("erp-theme-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("erp-theme-change", listener);
  };
}

function setTheme(theme: Theme) {
  window.localStorage.setItem("erp-theme", theme);
  window.dispatchEvent(new Event("erp-theme-change"));
}

function getServerTheme(): Theme {
  return "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  return [theme, setTheme] as const;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme] = useTheme();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  return children;
}
