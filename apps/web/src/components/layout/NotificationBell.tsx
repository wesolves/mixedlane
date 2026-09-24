import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AtSign, Bell, CheckCheck, CircleDot, MessageSquare, UserPlus, type LucideIcon } from "lucide-react";
import type { Notification } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

const ICONS: Record<Notification["type"], LucideIcon> = {
  assigned: UserPlus,
  mentioned: AtSign,
  commented: MessageSquare,
  status_changed: CircleDot,
};

export const useNotifications = () => useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications.list() });

/** Inbox: assignments, @mentions, comments and status changes on your work. Updated live. */
export function NotificationBell({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const read = useMutation({ mutationFn: api.notifications.read, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: refresh });

  const openOne = (n: Notification) => {
    if (!n.readAt) read.mutate(n.id);
    setOpen(false);
    navigate(paths.inOrg(n.link));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={className} aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
          <span className="relative">
            <Bell className="size-4" />
            {unread > 0 && collapsed && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary" />}
          </span>
          {!collapsed && (
            <>
              Inbox
              {unread > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Inbox</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto scroll-thin">
          {!data?.items.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing yet. You'll hear about assignments, mentions and changes to your work here.
            </p>
          ) : (
            data.items.map((n) => {
              const Icon = ICONS[n.type];
              return (
                <button
                  key={n.id}
                  onClick={() => openOne(n)}
                  className={cn("flex w-full gap-3 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted/60", !n.readAt && "bg-primary/5")}
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                    <span className="block text-[11px] text-muted-foreground">{formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })}</span>
                  </span>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
