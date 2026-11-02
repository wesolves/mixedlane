import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { allowedParentTypes, canBeRoot, type WorkItemDetail } from "@mixedlane/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { paths } from "@/lib/project";
import { useProjects, useProjectTree } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function TransferItemDialog({ item, onClose, onTransferred }: { item: WorkItemDetail; onClose: () => void; onTransferred?: () => void }) {
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState("");
  const [parentId, setParentId] = useState("");
  const project = projects.find((p) => p.id === projectId);
  const tree = useProjectTree(project?.key);
  const parents = (tree.data ?? []).filter((p) => project && allowedParentTypes(item.type, project.itemTypes).includes(p.type));
  const rootAllowed = project && canBeRoot(item.type, project.itemTypes);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const transfer = useMutation({
    mutationFn: () => api.items.transfer(item.id, { projectId, parentId: parentId || null }),
    onSuccess: async (moved) => {
      await Promise.all(["projects", "tree", "item", "activity", "whatsapp"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
      onClose(); onTransferred?.();
      navigate(paths.item(project!.key, moved));
      toast.success(`Moved to ${moved.key}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const selectClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
  return <Dialog open onOpenChange={(open) => { if (!open && !transfer.isPending) onClose(); }}><DialogContent><DialogHeader>
    <DialogTitle>Move {item.key} to another project</DialogTitle>
    <DialogDescription>All descendants move together. Ticket keys change to the destination project’s code and old ticket URLs stop working. Comments, attachments and history stay with each ticket. Statuses are matched by workflow category.</DialogDescription>
  </DialogHeader><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!transfer.isPending) transfer.mutate(); }}>
    <div className="space-y-2"><Label htmlFor="transfer-project">Destination project</Label><select id="transfer-project" className={selectClass} value={projectId} disabled={transfer.isPending} onChange={(e) => { setProjectId(e.target.value); setParentId(""); }} required><option value="">Choose a project</option>{projects.filter((p) => p.id !== item.projectId && p.itemTypes.includes(item.type)).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></div>
    {project && <div className="space-y-2"><Label htmlFor="transfer-parent">Destination parent</Label><select id="transfer-parent" className={selectClass} value={parentId} disabled={transfer.isPending || tree.isLoading} onChange={(e) => setParentId(e.target.value)} required={!rootAllowed}><option value="">{rootAllowed ? "Project root" : "Choose a parent"}</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.title}</option>)}</select>{tree.error && <p role="alert" className="text-sm text-destructive">{tree.error.message}</p>}</div>}
    <DialogFooter><Button type="button" variant="outline" disabled={transfer.isPending} onClick={onClose}>Cancel</Button><Button disabled={!project || (!rootAllowed && !parentId) || tree.isLoading || !!tree.error || transfer.isPending}>{transfer.isPending ? "Moving…" : "Move ticket"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
