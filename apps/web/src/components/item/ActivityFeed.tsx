import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import {
  PRIORITY_LABELS,
  type Activity,
  type Priority,
} from "@flowboard/shared";
import { ActorAvatar, ActorName } from "@/components/common";
import { useActivity } from "@/hooks/queries";
import { useProjectScope } from "@/lib/project";

const FIELD_LABELS: Record<string, string> = {
  parentId: "parent",
  startDate: "start date",
  dueDate: "due date",
};

function pretty(field: string | null, value: string | null, statusName: (id: string) => string) {
  if (value === null) return "none";
  if (field === "status") return statusName(value);
  if (field === "priority") return PRIORITY_LABELS[value as Priority] ?? value;
  if (field === "labels") {
    try {
      return (JSON.parse(value) as string[]).join(", ") || "none";
    } catch {
      return value;
    }
  }
  if (field === "parentId") return "another item";
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

function describe(a: Activity, statusName: (id: string) => string) {
  switch (a.action) {
    case "created":
      return <>created this item</>;
    case "commented":
      return <>added a comment</>;
    case "moved":
    case "updated": {
      const field = a.field ?? "";
      const label = FIELD_LABELS[field] ?? field;
      if (field === "description") return <>updated the description</>;
      return (
        <>
          changed <span className="font-medium text-foreground">{label}</span>{" "}
          {a.fromValue !== null && (
            <>
              from <span className="line-through decoration-muted-foreground/60">{pretty(field, a.fromValue, statusName)}</span>{" "}
            </>
          )}
          to <span className="font-medium text-foreground">{pretty(field, a.toValue, statusName)}</span>
        </>
      );
    }
    default:
      return <>{a.action}</>;
  }
}

export function ActivityFeed({ itemId }: { itemId: string }) {
  const { data = [] } = useActivity(itemId);
  const { statusById } = useProjectScope();
  const statusName = (id: string) => statusById(id).name;
  if (!data.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="size-4" /> No activity yet.
      </p>
    );
  }
  return (
    <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-3 before:w-px before:bg-border">
      {data.map((a) => (
        <li key={a.id} className="relative flex items-start gap-3 text-sm">
          <ActorAvatar name={a.actor} type={a.actorType} className="relative ring-4 ring-background" />
          <div className="pt-0.5 text-muted-foreground">
            <ActorName name={a.actor} type={a.actorType} /> {describe(a, statusName)}
            <span className="ml-2 text-xs" title={new Date(a.createdAt).toLocaleString()}>
              {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
