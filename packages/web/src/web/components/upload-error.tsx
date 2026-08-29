/**
 * Why an upload did not happen.
 *
 * react-query keeps the error and every upload surface threw it away: the
 * button span, the mutation failed, and nothing appeared - indistinguishable
 * from a slow network, and silent about the one thing that fixes it (on a
 * hosted deployment, an unconfigured bucket). Three components start uploads,
 * so this lives in one place rather than being remembered in three.
 */
export function UploadError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="border-b border-[var(--v-border)] bg-[var(--v-live-soft)] px-4 py-2 text-[12px] text-[var(--v-live)]"
    >
      {(error as Error)?.message || "Upload failed."}
    </p>
  );
}
