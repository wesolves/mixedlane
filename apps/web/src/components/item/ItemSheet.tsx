import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ItemDetail } from "@/components/item/ItemDetail";
import { useItemSheet } from "@/hooks/ui";
import { projectKeyOf } from "@/lib/project";

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
        <SheetTitle className="sr-only">{openKey}</SheetTitle>
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
      </SheetContent>
    </Sheet>
  );
}
