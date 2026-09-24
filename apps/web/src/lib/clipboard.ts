/**
 * Copies text to the clipboard. The async Clipboard API only exists in secure contexts (HTTPS or
 * localhost), so when the app is opened via a LAN IP over plain HTTP we fall back to a hidden
 * textarea + execCommand("copy"), which browsers still allow inside a click handler.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  // Inside a modal, focus is trapped in the dialog: append there so the selection sticks.
  const host = (document.activeElement?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
  host.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
