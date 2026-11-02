import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const standalone = window.matchMedia("(display-mode: standalone)");
let state = { prompt: null as InstallPrompt | null, installed: standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone };
const listeners = new Set<() => void>();
function update(next: typeof state) { state = next; listeners.forEach((fn) => fn()); }
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); update({ ...state, prompt: event as InstallPrompt }); });
window.addEventListener("appinstalled", () => update({ prompt: null, installed: true }));
standalone.addEventListener("change", () => update({ ...state, installed: standalone.matches }));

export const useInstall = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
export async function installApp() {
  const prompt = state.prompt;
  if (!prompt) return;
  update({ ...state, prompt: null });
  await prompt.prompt();
  await prompt.userChoice;
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => { /* Installation guidance remains available if registration fails. */ }); });
}
