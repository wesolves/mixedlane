import { Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { installApp, useInstall } from "@/lib/install";

export function InstallApp() {
  const { prompt, installed } = useInstall();
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex items-center gap-3"><Smartphone className="size-6 shrink-0 text-primary" /><div><h2 className="font-semibold">Install Mixedlane</h2><p className="text-sm text-muted-foreground">Open Mixedlane from your home screen in its own app window.</p></div></div>
    {installed ? <p role="status" className="text-sm">Mixedlane is running as an installed app.</p> : <>
      {prompt && <Button onClick={() => { void installApp().catch(() => toast.error("Couldn't open installation. Use your browser's install menu.")); }}><Download className="size-4" />Install app</Button>}
      {!window.isSecureContext && <p className="text-sm text-muted-foreground">Open Mixedlane using its HTTPS address to install it.</p>}
      <div className="grid gap-4 text-sm sm:grid-cols-2"><div><h3 className="font-medium">Android</h3><p className="mt-1 text-muted-foreground">Open this site in Chrome, tap the browser menu, then Install app or Add to Home screen.</p></div><div><h3 className="font-medium">iPhone or iPad</h3><p className="mt-1 text-muted-foreground">Open this site in Safari, tap Share, then Add to Home Screen. If shown, turn on Open as Web App, then tap Add.</p></div></div>
      <p className="text-xs text-muted-foreground">On desktop, use the install option in Chrome or Edge’s address bar or browser menu. An internet connection is needed to load and update your projects.</p>
    </>}
  </section>;
}
