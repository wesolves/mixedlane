import { Pencil } from "lucide-react";
import type { PresenceUser } from "@flowboard/shared";
import { UserAvatar } from "@/components/common";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Stacked avatars of the other people looking at (or editing) the same thing. */
export function PresenceAvatars({ users, className, max = 4 }: { users: PresenceUser[]; className?: string; max?: number }) {
  if (!users.length) return null;
  const shown = users.slice(0, max);
  const editing = users.filter((u) => u.mode === "editing");
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex -space-x-1.5">
        {shown.map((u) => (
          <Tooltip key={u.userId}>
            <TooltipTrigger asChild>
              <span className="relative rounded-full ring-2 ring-background">
                <UserAvatar name={u.name} className="size-6" />
                {u.mode === "editing" && (
                  <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-amber-500 ring-2 ring-background">
                    <Pencil className="size-1.5 text-white" strokeWidth={4} />
                  </span>
                )}
                <span className="sr-only">{u.name}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {u.name} is {u.mode}
            </TooltipContent>
          </Tooltip>
        ))}
        {users.length > max && (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">+{users.length - max}</span>
        )}
      </div>
      {editing.length > 0 && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {editing.length === 1 ? `${editing[0].name} is editing` : `${editing.length} people editing`}
        </span>
      )}
    </div>
  );
}
