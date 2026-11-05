import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ItemDetail } from "@/components/item/ItemDetail";
import { useItemSheet } from "@/hooks/ui";
import { projectKeyOf } from "@/lib/project";
import { MixdiLauncher } from "@/components/layout/MixdiLauncher";

/** Quick-view panel, opened from the board or lists via `?item=KEY`. */
export function ItemSheet() {
  const { openKey, open, close } = useItemSheet();
  return (
    <Sheet open={!!openKey} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-2">
          <SheetTitle className="font-mono text-xs text-muted-foreground">{openKey}</SheetTitle>
          <SheetClose asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Close item details"><X className="size-4" /></Button></SheetClose>
        </div>
        <SheetDescription className="sr-only">Work item details</SheetDescription>
        {openKey && (
          <ItemDetail
            key={openKey}
            projectKey={projectKeyOf(openKey)}
            itemKey={openKey}
            variant="sheet"
            onOpenItem={(item) => open(item.key)}
            onDeleted={close}
          />
        )}
        {openKey && <MixdiLauncher key={openKey} itemKey={openKey} inItemSheet />}
      </SheetContent>
    </Sheet>
  );
}
