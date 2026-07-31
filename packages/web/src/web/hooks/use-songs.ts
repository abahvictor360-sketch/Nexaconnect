import { useQuery } from "@tanstack/react-query";
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
    /** Per-song look override — null = inherit the app's active theme/background/color. */
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
