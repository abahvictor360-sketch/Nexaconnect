import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/** A coloured span of the sermon body, by character offset. */
export type SermonHighlight = { start: number; end: number; color: string };

export type Sermon = {
  id: string;
  title: string;
  speaker: string | null;
  preachedOn: string | null;
  body: string;
  /** JSON-encoded SermonHighlight[] as stored; use parseHighlights to read. */
  highlights: string;
  createdAt: string;
  updatedAt: string;
};

export function parseHighlights(raw: string | null | undefined): SermonHighlight[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SermonHighlight[]) : [];
  } catch {
    return [];
  }
}

export function useSermons() {
  return useQuery({
    queryKey: ["sermons"],
    queryFn: async () => {
      const res = await fetch("/api/sermons");
      if (!res.ok) throw new Error("failed to load sermons");
      return ((await res.json()) as { sermons: Sermon[] }).sermons;
    },
  });
}

export function useCreateSermon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string; speaker?: string; preachedOn?: string; body?: string }) => {
      const res = await fetch("/api/sermons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("failed to create sermon");
      return ((await res.json()) as { sermon: Sermon }).sermon;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sermons"] }),
  });
}

export function useUpdateSermon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: {
        id: string;
        title?: string;
        speaker?: string | null;
        preachedOn?: string | null;
        body?: string;
        highlights?: SermonHighlight[];
      },
    ) => {
      const { id, ...patch } = input;
      const res = await fetch(`/api/sermons/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("failed to save sermon");
      return ((await res.json()) as { sermon: Sermon }).sermon;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sermons"] }),
  });
}

export function useDeleteSermon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/sermons/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed to delete sermon");
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sermons"] }),
  });
}
