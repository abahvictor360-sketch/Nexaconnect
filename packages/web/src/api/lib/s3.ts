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

export function s3Client(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

export const S3_BUCKET = process.env.S3_BUCKET!;
