import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PageNode } from "@flowboard/shared";
import { api } from "@/lib/api";

export const dk = {
  spaces: ["docs", "spaces"] as const,
  space: (key: string) => ["docs", "space", key] as const,
  tree: (key: string) => ["docs", "tree", key] as const,
  page: (id: string) => ["docs", "page", id] as const,
  versions: (id: string) => ["docs", "versions", id] as const,
  version: (id: string, v: number) => ["docs", "version", id, v] as const,
  search: (q: string) => ["docs", "search", q] as const,
};

const onError = (err: Error) => toast.error(err.message);

export const useSpaces = () => useQuery({ queryKey: dk.spaces, queryFn: api.docs.spaces });
export const useSpace = (key: string | undefined) => useQuery({ queryKey: dk.space(key!), queryFn: () => api.docs.space(key!), enabled: !!key });
export const usePageTree = (key: string | undefined) => useQuery({ queryKey: dk.tree(key!), queryFn: () => api.docs.tree(key!), enabled: !!key });
export const usePage = (id: string | undefined) => useQuery({ queryKey: dk.page(id!), queryFn: () => api.docs.page(id!), enabled: !!id });
export const useVersions = (id: string, enabled: boolean) => useQuery({ queryKey: dk.versions(id), queryFn: () => api.docs.versions(id), enabled });
export const useVersion = (id: string, v: number | null) =>
  useQuery({ queryKey: dk.version(id, v ?? 0), queryFn: () => api.docs.version(id, v!), enabled: !!v, staleTime: Infinity });
export const useDocSearch = (q: string) => useQuery({ queryKey: dk.search(q), queryFn: () => api.docs.search(q), enabled: q.trim().length > 1 });

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.docs.createSpace,
    onSuccess: () => qc.invalidateQueries({ queryKey: dk.spaces }),
    onError,
  });
}

export function useUpdateSpace(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.docs.updateSpace>[1]) => api.docs.updateSpace(key, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
    onError,
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.docs.deleteSpace,
    onSuccess: () => qc.invalidateQueries({ queryKey: dk.spaces }),
    onError,
  });
}

export function useCreatePage(spaceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; parentId?: string | null; contentHtml?: string }) => api.docs.createPage(spaceKey, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dk.tree(spaceKey) });
      qc.invalidateQueries({ queryKey: dk.spaces });
    },
    onError,
  });
}

/** Reorder/nest with an optimistic tree update. */
export function useMovePage(spaceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId, beforeId }: { id: string; parentId: string | null; beforeId?: string | null }) => api.docs.movePage(id, { parentId, beforeId }),
    onSuccess: (tree) => qc.setQueryData<PageNode[]>(dk.tree(spaceKey), tree),
    onError: (err: Error) => {
      onError(err);
      qc.invalidateQueries({ queryKey: dk.tree(spaceKey) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["docs", "page"] }),
  });
}

export function useDeletePage(spaceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.docs.deletePage,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dk.tree(spaceKey) });
      qc.invalidateQueries({ queryKey: dk.spaces });
    },
    onError,
  });
}

/** Save without the generic error toast: the page view handles 409 conflicts itself. */
export function useSavePage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; contentHtml?: string; baseVersion: number }) => api.docs.updatePage(id, input),
    onSuccess: (page) => {
      qc.setQueryData(dk.page(id), page);
      qc.invalidateQueries({ queryKey: ["docs", "tree"] });
      qc.invalidateQueries({ queryKey: dk.versions(id) });
    },
  });
}

export function useRestoreVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: number) => api.docs.restore(id, v),
    onSuccess: (page) => {
      qc.setQueryData(dk.page(id), page);
      qc.invalidateQueries({ queryKey: dk.versions(id) });
      qc.invalidateQueries({ queryKey: ["docs", "tree"] });
      toast.success(`Restored — saved as version ${page.version}`);
    },
    onError,
  });
}
