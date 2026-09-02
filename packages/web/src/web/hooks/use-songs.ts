import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type SongListItem = {
  id: string;
  title: string;
  authors: string[];
  tags: string[];
  defaultLang: string;
  source: string;
  ccliNumber: string | null;
  copyright: string | null;
  updatedAt: string;
};

export function useSongList(q: string) {
  return useQuery({
    queryKey: ["songs", q],
    queryFn: async () => {
      const res = await api.songs.$get({ query: { q } });
      // Checked rather than assumed: on a failing deployment this returns an
      // HTML or plain-text error page, and parsing that as JSON threw a
      // "Unexpected token" nobody could act on - behind a library that simply
      // looked empty. The status is what identifies the problem.
      if (!res.ok) throw new Error(`The server returned ${res.status} for the song library.`);
      const data = await res.json();
      return data.songs as SongListItem[];
    },
  });
}

export type FullSongResponse = {
  song: {
    id: string;
    title: string;
    authors: string | null;
    copyright: string | null;
    ccliNumber: string | null;
    defaultLang: string;
    tags: string | null;
    source: string;
    /** Per-song look override - null = inherit the app's active theme/background/color. */
    themeId: string | null;
    backgroundId: string | null;
    textColor: string | null;
  };
  sections: {
    id: string;
    songId: string;
    type: string;
    label: string;
    number: number | null;
    lang: string;
    lyrics: string;
    manualBreaks: string | null;
    /** JSON TextFormat[] over `lyrics`; null = plain text. */
    format: string | null;
    textAlign: string | null;
    orderIndex: number;
  }[];
  arrangements: {
    arrangement: { id: string; songId: string; name: string; isDefault: number };
    items: { id: string; arrangementId: string; sectionId: string; orderIndex: number }[];
  }[];
};

export function useFullSong(id: string | null) {
  return useQuery({
    queryKey: ["song", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.songs[":id"].$get({ param: { id: id! } });
      if (!res.ok) throw new Error("not found");
      return (await res.json()) as FullSongResponse;
    },
  });
}

export function useThemes() {
  return useQuery({
    queryKey: ["themes"],
    queryFn: async () => {
      const res = await api.themes.$get();
      const data = await res.json();
      return data.themes;
    },
  });
}

/** One row of the themes table, as the API returns it. */
export type Theme = Awaited<ReturnType<typeof fetchThemes>>[number];
async function fetchThemes() {
  const res = await api.themes.$get();
  return (await res.json()).themes;
}

/** Every writable column, so the editor can send a partial patch. */
export type ThemeDraft = {
  name?: string;
  fontId?: string | null;
  fontSize?: number | null;
  fontWeight?: number | null;
  textColor?: string | null;
  textAlign?: string | null;
  textOutline?: string | null;
  backgroundId?: string | null;
  bgColor?: string | null;
  overlayScrim?: number | null;
  displayMode?: string | null;
  maxLines?: number | null;
  verticalPos?: string | null;
  safeMargin?: number | null;
  transition?: string | null;
  transitionMs?: number | null;
};

export function useCreateTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ThemeDraft) => {
      const res = await api.themes.$post({ json: input });
      return (await res.json()) as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["themes"] }),
  });
}

export function useUpdateTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ThemeDraft }) => {
      await api.themes[":id"].$put({ param: { id }, json: patch });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["themes"] }),
  });
}

/**
 * The server refuses a delete while a theme is still in use and explains why,
 * so surface its message rather than a generic failure - "3 songs still use
 * this theme" tells the operator what to do next; "could not delete" does not.
 */
export function useDeleteTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.themes[":id"].$delete({ param: { id } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Could not delete that theme.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["themes"] }),
  });
}
