/// <reference lib="webworker" />
/**
 * Whisper, off the main thread.
 *
 * Transcription is seconds of solid arithmetic per window. On the main thread
 * that is the operator screen locking up every few seconds - the clock
 * stopping, buttons not pressing - for the whole service. So it lives here,
 * and the only thing crossing back is text.
 */

import { pipeline, env } from "@huggingface/transformers";
import type { LocalSttEvent } from "../lib/local-stt";

// The model comes from the Hugging Face CDN the first time and from the
// browser's cache every time after. Local files are not looked for: there is
// no server path to serve them from in the packaged app.
env.allowLocalModels = false;

const RATE = 16000;
/** How much audio each pass sees. Whisper is trained on 30s and degrades on very short clips. */
const WINDOW = RATE * 6;
/** How much of the previous window is kept, so a word split across a boundary survives. */
const OVERLAP = RATE * 1;
/** Transcribe once this much NEW audio has arrived. The latency floor, in effect. */
const HOP = RATE * 1.5;

type Recogniser = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

let recogniser: Recogniser | null = null;
let language: string | null = null;
let buffer = new Float32Array(0);
let sinceLast = 0;
let busy = false;
let closed = false;

function say(e: LocalSttEvent) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(e);
}

function append(pcm: Float32Array) {
  const merged = new Float32Array(buffer.length + pcm.length);
  merged.set(buffer, 0);
  merged.set(pcm, buffer.length);
  // Slide the window: anything older than WINDOW is dropped off the front.
  buffer = merged.length > WINDOW ? merged.slice(merged.length - WINDOW) : merged;
}

/** Whisper's hallucinations on silence, which it emits with total confidence. */
const JUNK = /^[\s.,!?-]*$|thank you for watching|subscribe|^\[.*\]$|^\(.*\)$/i;

async function load(model: string, lang: string | null, host?: string | null) {
  language = lang;
  /*
   * Serve the models from somewhere else, when asked.
   *
   * Plenty of church networks block huggingface.co outright, and plenty of
   * people would rather the download came off their own server or a USB
   * copy on the hall PC than off the internet at all. The layout a host has
   * to mirror is the plain one: <host>/<model id>/... exactly as Hugging
   * Face serves it.
   */
  if (host) {
    env.remoteHost = host.replace(/\/+$/, "") + "/";
    env.remotePathTemplate = "{model}/";
  }
  try {
    /*
     * WebGPU where it exists, WASM where it does not.
     *
     * Not a performance nicety: the large models are unusable on WASM, and
     * falling back silently is better than a model that loads and then runs
     * thirty seconds behind the preacher with no explanation.
     */
    const hasGpu = "gpu" in navigator && !!(navigator as { gpu?: unknown }).gpu;
    const device = hasGpu ? "webgpu" : "wasm";
    const built = await pipeline("automatic-speech-recognition", model, {
      device: device as "webgpu" | "wasm",
      // q8 on WASM keeps the download and the arithmetic down; fp32 on GPU
      // because quantised encoders are where WebGPU backends tend to break.
      dtype: hasGpu ? "fp32" : "q8",
      progress_callback: (p: unknown) => {
        const q = p as { status?: string; file?: string; loaded?: number; total?: number };
        if (q?.status === "progress" && q.total) {
          say({ type: "progress", loaded: q.loaded ?? 0, total: q.total, file: q.file ?? "" });
        }
      },
    });
    recogniser = built as unknown as Recogniser;
    say({ type: "ready", device });
  } catch (e) {
    /*
     * The download is the part that fails, and "Failed to fetch" tells an
     * operator nothing they can act on. It is almost always the connection:
     * the model comes down the first time, and a hall with no internet - or
     * a firewall that blocks huggingface.co - is exactly the setup that
     * chose the local engine in the first place.
     */
    const raw = e instanceof Error ? e.message : "";
    const offline = /failed to fetch|networkerror|load failed|ERR_/i.test(raw);
    say({
      type: "error",
      message: offline
        ? "Could not download the model. The first run needs to reach the model host (huggingface.co by default); after that it works offline."
        : raw
          ? `Could not load the local model: ${raw}`
          : "Could not load the local model.",
    });
  }
}

async function run() {
  if (busy || closed || !recogniser || buffer.length < RATE) return;
  busy = true;
  const audio = buffer;
  try {
    const out = await recogniser(audio, {
      // Greedy, no timestamps: both of the expensive options buy accuracy
      // this does not need and latency it cannot afford.
      chunk_length_s: 30,
      return_timestamps: false,
      ...(language && language !== "multi" ? { language } : {}),
      task: "transcribe",
    });
    const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? "";
    const clean = text.trim();
    if (clean && !JUNK.test(clean)) say({ type: "text", text: clean });
  } catch (e) {
    say({ type: "error", message: e instanceof Error ? e.message : "Transcription failed." });
  } finally {
    // Keep a tail so the next pass has the run-up to whatever was mid-word.
    buffer = buffer.subarray(Math.max(0, buffer.length - OVERLAP)).slice();
    busy = false;
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as
    | { type: "load"; model: string; language: string | null; host?: string | null }
    | { type: "audio"; pcm: Float32Array }
    | { type: "close" };

  if (msg.type === "load") {
    void load(msg.model, msg.language, msg.host);
    return;
  }
  if (msg.type === "close") {
    closed = true;
    recogniser = null;
    buffer = new Float32Array(0);
    return;
  }
  if (msg.type === "audio") {
    append(msg.pcm);
    sinceLast += msg.pcm.length;
    if (sinceLast >= HOP) {
      sinceLast = 0;
      void run();
    }
  }
};
