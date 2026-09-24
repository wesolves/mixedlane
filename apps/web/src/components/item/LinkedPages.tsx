import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { paths } from "@/lib/project";

/** Docs pages that mention this item's key (only pages you can read). */
export function LinkedPages({ itemId }: { itemId: string }) {
  const { data: pages = [] } = useQuery({ queryKey: ["docs", "item-pages", itemId], queryFn: () => api.docs.pagesForItem(itemId) });
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Linked pages</h3>
      {pages.length === 0 ? (
        <p className="text-xs text-muted-foreground">Mention this item's key in a docs page to link it here.</p>
      ) : (
        <ul className="-mx-1.5 space-y-0.5">
          {pages.map((p) => (
            <li key={p.id}>
              <Link to={paths.page(p.spaceKey, p.id)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.spaceName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
