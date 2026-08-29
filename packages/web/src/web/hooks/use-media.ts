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
  /** LUT-style look preset id (see lib/color-filters.ts), or a raw CSS filter string. */
  colorFilter: string | null;
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
 * Whether S3 is worth trying at all.
 *
 * The desktop app has no S3 configured, so the presign call can only fail -
 * but it still costs a round-trip, and the server's AWS client spends real
 * time resolving credentials that are not there. Paying that once is fine;
 * paying it per file turns a 40-slide import into a minutes-long wait for
 * nothing. The first failure is remembered for the rest of the session.
 */
/**
 * Set once object storage has been shown to be absent, so every later upload
 * in this session goes straight to disk instead of re-asking. Deliberately NOT
 * set when a configured bucket refuses an upload: that is a fault to report,
 * not a reason to switch to a path that cannot work on a hosted deployment.
 */
let s3Unavailable = false;

/**
 * Upload a background file.
 *
 * Object storage first, local disk only when there is no object storage - the
 * offline desktop app. The distinction matters: a hosted deployment has a
 * read-only filesystem, so falling back there turns a bucket problem into
 * "MEDIA_DIR is not writable", which sends whoever reads it to the one place
 * that was never going to work.
 */
export async function uploadMediaFile(file: File, role?: "slide"): Promise<MediaItem> {
  if (s3Unavailable) return uploadToLocalStore(file, role);

  let presign: Awaited<ReturnType<typeof api.media.presign.$post>>;
  try {
    presign = await api.media.presign.$post({
      json: { filename: file.name, contentType: file.type },
    });
  } catch {
    // Could not reach our own API at all - offline, or no server.
    s3Unavailable = true;
    return uploadToLocalStore(file, role);
  }

  // 503 is this app's own "no bucket configured" (see /media/presign), which is
  // the desktop case and the only one where local disk is the right answer.
  if (presign.status === 503) {
    s3Unavailable = true;
    return uploadToLocalStore(file, role);
  }
  if (!presign.ok) throw new Error(`Could not prepare the upload (${presign.status}).`);

  const { url, key } = await presign.json();

  let put: Response;
  try {
    put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  } catch (err) {
    // The browser uploads straight to the bucket, so a missing CORS rule fails
    // here - and fails as an opaque TypeError, because the browser never lets
    // the response through to be read. No status, no body, nothing but this.
    throw new Error(
      `The storage bucket refused an upload from ${window.location.origin}. ` +
        "That is almost always a missing CORS rule: allow the PUT method and the " +
        "content-type header from this origin on the bucket. " +
        `(${(err as Error).message})`,
    );
  }
  if (!put.ok) {
    throw new Error(
      `The storage bucket rejected the upload (${put.status} ${put.statusText}). ` +
        "Check the bucket name and that the access key may write to it.",
    );
  }

  const type = file.type.startsWith("video")
    ? "video"
    : file.type.startsWith("audio")
      ? "audio"
      : "image";
  const res = await api.media.$post({ json: { type, uri: key, fit: "cover", loop: true } });
  if (!res.ok) throw new Error(`The file uploaded, but registering it failed (${res.status}).`);
  const data = await res.json();
  return data.media as MediaItem;
}

/** The server's own storage - the only path the offline desktop app uses. */
async function uploadToLocalStore(file: File, role?: "slide"): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  // Deck pages are stored like anything else but kept out of the library.
  if (role) form.append("role", role);
  const res = await fetch("/api/media/upload", { method: "POST", body: form });
  if (!res.ok) {
    // The server explains storage failures (no bucket configured, read-only
    // disk) and the operator is the one who can act on them, so the message
    // travels instead of being flattened to a status code.
    const detail = await res
      .json()
      .then((d: { error?: string; hint?: string }) => [d.error, d.hint].filter(Boolean).join(" - "))
      .catch(() => "");
    throw new Error(detail || `Upload failed (${res.status})`);
  }
  const data = await res.json();
  return data.media as MediaItem;
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
    mutationFn: async (input: {
      id: string; loop?: boolean; fit?: "cover" | "contain" | "fill"; muted?: boolean;
      colorFilter?: string | null;
    }) => {
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
    // Wrapped rather than passed by reference: uploadMediaFile takes an
    // optional second argument, and react-query would hand its own second
    // argument to it. Anything the library passes there must not be mistaken
    // for a role.
    mutationFn: (file: File) => uploadMediaFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });
}
