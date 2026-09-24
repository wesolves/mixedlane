import { useEffect, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichText } from "@/components/editor/RichEditor";
import { TextDiff } from "@/components/docs/TextDiff";
import { useRestoreVersion, useVersion, useVersions } from "@/hooks/docs";
import { cn } from "@/lib/utils";

/** Version history: pick a version to see what changed from the one before, then restore it. */
export function HistorySheet({
  pageId,
  current,
  canWrite,
  open,
  onOpenChange,
}: {
  pageId: string;
  current: number;
  canWrite: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: versions = [] } = useVersions(pageId, open);
  const [selected, setSelected] = useState<number | null>(null);
  const restore = useRestoreVersion(pageId);
  useEffect(() => {
    if (open) setSelected(current);
  }, [open, current]);

  const { data: version } = useVersion(pageId, selected);
  const { data: previous } = useVersion(pageId, selected && selected > 1 ? selected - 1 : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-4xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <History className="size-4" /> Page history
          </SheetTitle>
          <SheetDescription>Every save is kept. Restoring creates a new version, so nothing is lost.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1">
          <ol className="w-60 shrink-0 overflow-y-auto border-r p-2 scroll-thin">
            {versions.map((v) => (
              <li key={v.version}>
                <button
                  onClick={() => setSelected(v.version)}
                  className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-muted", selected === v.version && "bg-muted")}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    Version {v.version}
                    {v.version === current && <span className="rounded bg-primary/10 px-1.5 text-[10px] font-semibold text-primary uppercase">Current</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {v.authorName} · {formatDistanceToNowStrict(new Date(v.createdAt), { addSuffix: true })}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="min-w-0 flex-1 overflow-y-auto p-5 scroll-thin">
            {version ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{version.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Saved by {version.authorName} on {format(new Date(version.createdAt), "MMM d, yyyy 'at' HH:mm")}
                    </p>
                  </div>
                  {canWrite && version.version !== current && (
                    <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(version.version, { onSuccess: () => onOpenChange(false) })}>
                      <RotateCcw className="size-4" /> Restore this version
                    </Button>
                  )}
                </div>
                <Tabs defaultValue="changes">
                  <TabsList>
                    <TabsTrigger value="changes">Changes</TabsTrigger>
                    <TabsTrigger value="content">Content</TabsTrigger>
                  </TabsList>
                  <TabsContent value="changes" className="pt-3">
                    {version.version === 1 ? (
                      <p className="text-sm text-muted-foreground">First version — the page was created.</p>
                    ) : previous ? (
                      <>
                        {previous.title !== version.title && (
                          <p className="mb-3 text-sm">
                            Title: <del className="text-rose-600">{previous.title}</del> → <ins className="text-emerald-600 no-underline">{version.title}</ins>
                          </p>
                        )}
                        <TextDiff before={previous.contentText} after={version.contentText} />
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    )}
                  </TabsContent>
                  <TabsContent value="content" className="pt-3">
                    <RichText html={version.contentHtml} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a version.</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
