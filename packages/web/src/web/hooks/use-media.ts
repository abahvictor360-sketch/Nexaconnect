import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type MediaKind = "image" | "video" | "audio" | "color";

export type MediaItem = {
  id: string;
  type: MediaKind;
  uri: string;
  url: string;
  loop: number | null;
  fit: string | null;
  /** Video only: 1 = plays silently (the usual "background" case). */
  muted: number | null;
  createdAt: string;
};

export function useMedia() {
  return useQuery({
    queryKey: ["media"],
    queryFn: async () => {
      const res = await api.media.$get();
      const data = await res.json();
      return data.media as MediaItem[];
    },
  });
}

/**
 * Upload a background file. Tries Tigris/S3 via presigned URL first (hosted
 * deployments); when S3 isn't configured/reachable — the offline desktop app —
 * falls back to the server's local storage endpoint.
 */
export async function uploadMediaFile(file: File): Promise<MediaItem> {
  try {
    const presign = await api.media.presign.$post({
      json: { filename: file.name, contentType: file.type },
    });
    if (!presign.ok) throw new Error("presign unavailable");
    const { url, key } = await presign.json();
    const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    if (!put.ok) throw new Error("s3 upload failed");
    const type = file.type.startsWith("video")
      ? "video"
      : file.type.startsWith("audio")
        ? "audio"
        : "image";
    const res = await api.media.$post({ json: { type, uri: key, fit: "cover", loop: true } });
    const data = await res.json();
    return data.media as MediaItem;
  } catch {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/media/upload", { method: "POST", body: form });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const data = await res.json();
    return data.media as MediaItem;
  }
}

export function useAddMediaUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: MediaKind;
      uri: string;
      fit?: "cover" | "contain" | "fill";
      muted?: boolean;
    }) => {
      const res = await api.media.$post({
        json: { type: input.type, uri: input.uri, fit: input.fit ?? "cover", loop: true, muted: input.muted },
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });
}

/** Edit an existing item's loop / fit / sound without re-uploading. */
export function useUpdateMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; loop?: boolean; fit?: "cover" | "contain" | "fill"; muted?: boolean }) => {
      const { id, ...patch } = input;
      const res = await api.media[":id"].$put({ param: { id }, json: patch });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.media[":id"].$delete({ param: { id } });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });
}

export function useUploadMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadMediaFile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });
}
