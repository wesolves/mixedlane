import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);
  return { dark, toggle };
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/** Single-key shortcuts that are ignored while typing. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts?: { mod?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (opts?.mod ? !mod : mod || e.altKey || isTyping(e)) return;
      if (document.querySelector("[role=dialog]") && !opts?.mod) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, opts?.mod]);
}

/** The quick-view side sheet is driven by `?item=KEY` so it is linkable. */
export function useItemSheet() {
  const [params, setParams] = useSearchParams();
  const openKey = params.get("item");
  const open = useCallback(
    (key: string) =>
      setParams((p) => {
        p.set("item", key);
        return p;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((p) => {
        p.delete("item");
        return p;
      }),
    [setParams],
  );
  return { openKey, open, close };
}
