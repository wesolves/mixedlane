// Applies the dark theme before first paint (no flash). A plain blocking script so the
// Content-Security-Policy can stay `script-src 'self'` with no inline scripts.
try {
  const t = localStorage.getItem("theme");
  if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch {}
