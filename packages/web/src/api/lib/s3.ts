import { S3Client } from "@aws-sdk/client-s3";

/**
 * Object storage for backgrounds and deck images.
 *
 * Optional by design: the desktop app is offline-first and stores media on
 * local disk. A serverless deployment has no writable disk, so there it is the
 * only path that works - which is why an unconfigured bucket needs to say so
 * rather than fail somewhere inside the SDK.
 */
export const S3_VARS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
] as const;

/** Which of the four are absent or blank. Empty array means fully configured. */
export function missingS3Vars(): string[] {
  return S3_VARS.filter((v) => !process.env[v]?.trim());
}

export function s3Configured(): boolean {
  return missingS3Vars().length === 0;
}

/**
 * Built on first use, not at import. Constructing eagerly with `accessKeyId:
 * undefined!` is what turned "S3 isn't set up" into an opaque 500 from deep
 * inside the credential chain, on a route the client silently falls back from.
 */
let client: S3Client | null = null;

/**
 * Bucket-in-the-path, or bucket-in-the-hostname.
 *
 * Virtual-hosted style puts the bucket in front of the endpoint host, so an
 * account endpoint becomes `<bucket>.<account>.r2.cloudflarestorage.com`. That
 * is two labels in front of `r2.cloudflarestorage.com`, and Cloudflare's
 * certificate is `*.r2.cloudflarestorage.com` - a wildcard matches exactly one
 * label, so the name is not covered and TLS fails before any request is made.
 *
 * It fails identically at both ends, which is what made it hard to see: the
 * browser's direct PUT dies as an opaque "Failed to fetch" that looks exactly
 * like a missing CORS rule, and the SDK call from the server dies as a
 * connection error that looks like bad credentials. Neither says "certificate".
 *
 * R2 documents the path-style form - `<account>.r2.cloudflarestorage.com/
 * <bucket>/<key>` - so that is what R2 endpoints get. S3_FORCE_PATH_STYLE
 * overrides either way for anything this does not recognise; MinIO and other
 * self-hosted gateways generally want it on, AWS proper wants it off.
 */
function usePathStyle(endpoint: string | undefined): boolean {
  const forced = process.env.S3_FORCE_PATH_STYLE;
  if (forced) return forced !== "false" && forced !== "0";
  return /\br2\.cloudflarestorage\.com$/i.test(hostOf(endpoint));
}

function hostOf(endpoint: string | undefined): string {
  try {
    return endpoint ? new URL(endpoint).hostname : "";
  } catch {
    return "";
  }
}

/** The endpoint's hostname, for diagnostics. Never includes credentials. */
export function s3EndpointHost(): string | null {
  return hostOf(process.env.S3_ENDPOINT) || null;
}

/** Which addressing style this endpoint will be called with. */
export function s3UsesPathStyle(): boolean {
  return usePathStyle(process.env.S3_ENDPOINT);
}

export function s3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  client ??= new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: usePathStyle(endpoint),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

export const S3_BUCKET = process.env.S3_BUCKET!;
