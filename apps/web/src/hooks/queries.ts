import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { GitAutomation, ItemCreate, ItemMove, ItemUpdate, ProjectCreate, ProjectUpdate, WorkItemSummary } from "@flowboard/shared";
import { api } from "@/lib/api";

export const qk = {
  projects: ["projects"] as const,
  project: (key: string) => ["project", key] as const,
  tree: (key: string) => ["tree", key] as const,
  item: (key: string) => ["item", key] as const,
  comments: (id: string) => ["comments", id] as const,
  activity: (id: string) => ["activity", id] as const,
};

const onError = (err: Error) => toast.error(err.message);

export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: api.projects.list });

export const useProject = (key: string | undefined) =>
  useQuery({ queryKey: qk.project(key!), queryFn: () => api.projects.get(key!), enabled: !!key });

/** Every item in a project with roll-ups. Most views derive from this one query. */
export const useProjectTree = (key: string | undefined) =>
  useQuery({ queryKey: qk.tree(key!), queryFn: () => api.projects.tree(key!), enabled: !!key, refetchInterval: 30_000 });

export const useItem = (key: string | undefined) =>
  useQuery({ queryKey: qk.item(key!), queryFn: () => api.items.byKey(key!), enabled: !!key, refetchInterval: 30_000 });

export const useComments = (id: string | undefined) =>
  useQuery({ queryKey: qk.comments(id!), queryFn: () => api.items.comments(id!), enabled: !!id });

export const useActivity = (id: string | undefined) =>
  useQuery({ queryKey: qk.activity(id!), queryFn: () => api.items.activity(id!), enabled: !!id });

/** Invalidate everything that shows work items (cheap for a local SQLite app). */
function useInvalidateWork() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["tree"] }),
      qc.invalidateQueries({ queryKey: ["item"] }),
      qc.invalidateQueries({ queryKey: ["activity"] }),
      qc.invalidateQueries({ queryKey: qk.projects }),
    ]);
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectCreate) => api.projects.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
    onError,
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProjectUpdate }) => api.projects.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: ["project"] });
    },
    onError,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.projects.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
    onError,
  });
}

export function useCreateItem() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (input: ItemCreate) => api.items.create(input),
    onSuccess: invalidate,
    onError,
  });
}

export function useUpdateItem() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ItemUpdate }) => api.items.update(id, patch),
    onSuccess: invalidate,
    onError,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (id: string) => api.items.remove(id),
    onSuccess: invalidate,
    onError,
  });
}

/** Kanban move with optimistic update of the project tree cache. */
export function useMoveItem(projectKey: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, move }: { id: string; move: ItemMove }) => api.items.move(id, move),
    onMutate: async ({ id, move }) => {
      await qc.cancelQueries({ queryKey: qk.tree(projectKey) });
      const prev = qc.getQueryData<WorkItemSummary[]>(qk.tree(projectKey));
      qc.setQueryData<WorkItemSummary[]>(qk.tree(projectKey), (old) =>
        old?.map((it) => (it.id === id ? { ...it, status: move.status, sortOrder: move.sortOrder } : it)),
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.tree(projectKey), ctx.prev);
      onError(err);
    },
    onSettled: invalidate,
  });
}

export function useAddComment(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.items.addComment(itemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.comments(itemId) });
      qc.invalidateQueries({ queryKey: qk.activity(itemId) });
      qc.invalidateQueries({ queryKey: ["tree"] });
    },
    onError,
  });
}

export function useUpdateComment(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.comments.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments(itemId) }),
    onError,
  });
}

export function useDeleteComment(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.comments.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.comments(itemId) });
      qc.invalidateQueries({ queryKey: ["tree"] });
    },
    onError,
  });
}

/* ---------- GitHub ---------- */

export const useGithubConnection = () => useQuery({ queryKey: ["github", "connection"], queryFn: api.github.connection });

export const useProjectGithub = (projectKey: string | undefined) =>
  useQuery({
    queryKey: ["github", "project", projectKey],
    queryFn: () => api.github.project(projectKey!),
    enabled: !!projectKey,
    // Sync status changes in the background.
    refetchInterval: 15_000,
  });

export const useDevelopment = (itemId: string | undefined) =>
  useQuery({
    queryKey: ["development", itemId],
    queryFn: () => api.github.development(itemId!),
    enabled: !!itemId,
    refetchInterval: 30_000,
  });

/** Wraps a GitHub mutation: toast on error, refresh GitHub + work-item caches on success. */
function useGithubMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["github"] }),
        qc.invalidateQueries({ queryKey: ["development"] }),
        qc.invalidateQueries({ queryKey: ["tree"] }),
        qc.invalidateQueries({ queryKey: ["item"] }),
        qc.invalidateQueries({ queryKey: ["activity"] }),
      ]),
    onError,
  });
}

export const useConnectGithub = () => useGithubMutation(api.github.connect);
export const useUpdateGithubSettings = () => useGithubMutation(api.github.updateSettings);
export const useDisconnectGithub = () => useGithubMutation(() => api.github.disconnect());
export const useLinkRepo = (projectKey: string) => useGithubMutation((fullName: string) => api.github.linkRepo(projectKey, fullName));
export const useUnlinkRepo = (projectKey: string) => useGithubMutation((repoId: string) => api.github.unlinkRepo(projectKey, repoId));
export const useRegisterWebhook = (projectKey: string) =>
  useGithubMutation((repoId: string) => api.github.registerWebhook(projectKey, repoId));
export const useSyncProject = (projectKey: string) => useGithubMutation(() => api.github.sync(projectKey));
export const useSaveAutomation = (projectKey: string) =>
  useGithubMutation((automation: GitAutomation) => api.github.saveAutomation(projectKey, automation));
export const useCreateBranch = (itemId: string) =>
  useGithubMutation((input: { repoId: string; name: string; from?: string }) => api.github.createBranch(itemId, input));
