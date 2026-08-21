import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type LutListItem = { id: string; name: string; createdAt: string };

export function useLuts() {
  return useQuery({
    queryKey: ["luts"],
    queryFn: async () => {
      const res = await api.luts.$get();
      const data = await res.json();
      return data.luts as LutListItem[];
    },
  });
}

export function useUploadLut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/luts/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
      return data.lut as { id: string; name: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["luts"] }),
  });
}

export function useDeleteLut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.luts[":id"].$delete({ param: { id } });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["luts"] }),
  });
}

/** Fetches and caches a LUT's raw .cube text by id - the picker only lists names. */
const cubeCache = new Map<string, Promise<string>>();
export function fetchCubeText(id: string): Promise<string> {
  let p = cubeCache.get(id);
  if (!p) {
    p = api.luts[":id"].$get({ param: { id } }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !("lut" in data)) throw new Error("LUT not found");
      return (data as { lut: { cube: string } }).lut.cube;
    });
    cubeCache.set(id, p);
    p.catch(() => cubeCache.delete(id)); // don't cache a failed fetch forever
  }
  return p;
}
