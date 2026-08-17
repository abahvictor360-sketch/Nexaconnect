import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type PresentationListItem = {
  id: string;
  title: string;
  source: string;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PresentationSlide = {
  id: string;
  presentationId: string;
  orderIndex: number;
  heading: string | null;
  body: string | null;
  backgroundId: string | null;
  backgroundUrl: string | null;
  /** Design carried from an imported deck; null = inherit the app theme. */
  bgColor: string | null;
  textColor: string | null;
  /** JSON TextFormat[] over `body`; null = plain text. */
  format: string | null;
  textAlign: string | null;
};

export type FullPresentation = {
  presentation: { id: string; title: string; source: string; createdAt: string; updatedAt: string };
  slides: PresentationSlide[];
};

/** Editable slide shape used by the create/edit form and sent back to the API. */
export type SlideDraft = {
  heading: string;
  body: string;
  backgroundId: string | null;
  bgColor?: string | null;
  textColor?: string | null;
  format?: string | null;
  textAlign?: string | null;
};

export function usePresentationList() {
  return useQuery({
    queryKey: ["presentations"],
    queryFn: async () => {
      const res = await api.presentations.$get();
      const data = await res.json();
      return data.presentations as PresentationListItem[];
    },
  });
}

export function useFullPresentation(id: string | null) {
  return useQuery({
    queryKey: ["presentation", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.presentations[":id"].$get({ param: { id: id! } });
      if (!res.ok) throw new Error("not found");
      return (await res.json()) as FullPresentation;
    },
  });
}

export function useCreatePresentation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; slides: SlideDraft[] }) => {
      const res = await api.presentations.$post({ json: input });
      return (await res.json()) as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["presentations"] }),
  });
}

export function useSavePresentation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, slides }: { id: string; title: string; slides: SlideDraft[] }) => {
      const res = await api.presentations[":id"].$put({ param: { id }, json: { title, slides } });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["presentations"] });
      qc.invalidateQueries({ queryKey: ["presentation", vars.id] });
    },
  });
}

export function useDeletePresentation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.presentations[":id"].$delete({ param: { id } });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["presentations"] }),
  });
}

/** Import a .pptx: best-effort text + first image per slide (see api/lib/pptx.ts). */
export function useImportPptx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/presentations/import-pptx", { method: "POST", body: fd });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Import failed (${res.status})`);
      }
      return (await res.json()) as { id: string; slideCount: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["presentations"] }),
  });
}
