import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ITEM_TYPES, type ItemType } from "@flowboard/shared";
import { ItemDetail } from "@/components/item/ItemDetail";
import { useItem } from "@/hooks/queries";
import { paths } from "@/lib/project";

export function ItemPage() {
  const { projectKey = "", itemType = "", itemKey = "" } = useParams();
  const navigate = useNavigate();
  const { data: item } = useItem(itemKey);

  if (!ITEM_TYPES.includes(itemType as ItemType)) {
    return <div className="p-10 text-sm text-muted-foreground">Unknown page “{itemType}”.</div>;
  }
  // Keep URLs canonical: /projects/APP/<actual type>/APP-0001
  if (item && (item.type !== itemType || !item.key.startsWith(`${projectKey}-`))) {
    return <Navigate to={paths.item(item.key.slice(0, item.key.lastIndexOf("-")), item)} replace />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ItemDetail
        key={itemKey}
        projectKey={projectKey}
        itemKey={itemKey}
        variant="page"
        onOpenItem={(it) => navigate(paths.item(projectKey, it))}
      />
    </div>
  );
}
