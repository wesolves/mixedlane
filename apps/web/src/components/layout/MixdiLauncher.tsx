import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { MixdiChatView, type MixdiContext } from "@/pages/MixdiPage";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/** Mounted inside the ticket quick-view too, so its modal focus trap doesn't hide the launcher. */
export function MixdiLauncher({ itemKey, inItemSheet = false }: { itemKey?: string; inItemSheet?: boolean }) {
  const { org } = useOrg();
  const { pathname, search } = useLocation();
  const access = useQuery({ queryKey: ["mixdi-access", org?.id], queryFn: api.mixdi.access });
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<{ itemKey?: string; projectKey?: string }>({});
  const route = pathname.match(/^\/[^/]+\/projects\/([^/]+)(?:\/(epic|milestone|story|task|subtask)\/([^/]+))?(?:\/.*)?$/);
  const hidden = !inItemSheet && (new URLSearchParams(search).has("item") || pathname.endsWith("/mixdi"));
  if (!access.data?.allowed || hidden) return null;
  return <>
    <Button aria-label="Open Mixdi assistant" title="Ask Mixdi" className="fixed right-5 bottom-5 z-40 h-12 gap-2 rounded-full px-4 shadow-lg ring-1 ring-primary/20 sm:right-6 sm:bottom-6" onClick={() => { setContext({ itemKey: itemKey ?? route?.[3], projectKey: route?.[1] }); setOpen(true); }}><Sparkles className="size-5" /><span>Mixdi</span></Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full gap-0 p-0 sm:w-[38rem] sm:max-w-[calc(100vw-2rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetTitle className="border-b px-5 py-3 text-sm">Mixdi assistant</SheetTitle>
        <SheetDescription className="sr-only">Create tickets and documents with saved, private chat history.</SheetDescription>
        {open && <ContextualChat key={`${org?.id}:${context.itemKey ?? context.projectKey ?? "workspace"}`} context={context} close={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  </>;
}

function ContextualChat({ context, close }: { context: { itemKey?: string; projectKey?: string }; close: () => void }) {
  const { org } = useOrg();
  const item = useQuery({ queryKey: ["mixdi-launch-item", org?.id, context.itemKey], queryFn: () => api.items.byKey(context.itemKey!), enabled: !!context.itemKey });
  const project = useQuery({ queryKey: ["mixdi-launch-project", org?.id, context.projectKey], queryFn: () => api.projects.get(context.projectKey!), enabled: !context.itemKey && !!context.projectKey });
  if ((context.itemKey && item.isPending) || (!context.itemKey && context.projectKey && project.isPending)) return <p className="p-6 text-sm text-muted-foreground">Loading ticket context…</p>;
  if (item.isError || project.isError) return <p role="alert" className="p-6 text-sm text-destructive">Unable to load this ticket or project. Close and retry.</p>;
  const initial: MixdiContext = item.data ? { destination: item.data.projectId, parentId: item.data.id, parentType: item.data.type, parentLabel: `${item.data.key} · ${item.data.title}` } : { destination: project.data?.id };
  return <MixdiChatView initial={initial} compact onNavigate={close} />;
}
