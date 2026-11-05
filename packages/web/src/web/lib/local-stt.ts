/**
 * Speech recognition that runs on this machine, with no API key and no
 * internet during the service.
 *
 * Deepgram is better and will stay the default, but it needs an account, a
 * card and a working uplink - and a church hall's Wi-Fi is the least
 * dependable thing in the building. Whisper running locally is slower and
 * rougher, and it keeps following when the line drops.
 *
 * The model is downloaded ONCE, on the operator's say-so, and cached by the
 * browser from then on. Nothing is fetched mid-service.
 */

export type WhisperModelId =
  | "Xenova/whisper-tiny.en"
  | "Xenova/whisper-tiny"
  | "Xenova/whisper-base.en"
  | "Xenova/whisper-base"
  | "Xenova/whisper-small.en"
  | "Xenova/whisper-small"
  | "onnx-community/whisper-large-v3-turbo";

export type WhisperModelInfo = {
  id: WhisperModelId;
  label: string;
  /** Rough download size, which is what an operator is actually choosing between. */
  size: string;
  /** English only, or every language Whisper knows. */
  multilingual: boolean;
  blurb: string;
};

/**
 * Deliberately includes the heavy ones.
 *
 * A laptop driving a projector has nothing else to do, and a church that
 * wants the accuracy and is willing to wait 1.5GB for it should be allowed
 * to have it rather than be protected from the choice.
 */
export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: "Xenova/whisper-tiny.en",
    label: "Tiny (English)",
    size: "~40 MB",
    multilingual: false,
    blurb: "Fastest. Fine for following along; it will mis-hear names.",
  },
  {
    id: "Xenova/whisper-tiny",
    label: "Tiny (all languages)",
    size: "~40 MB",
    multilingual: true,
    blurb: "Same speed, any language, a little less accurate in English.",
  },
  {
    id: "Xenova/whisper-base.en",
    label: "Base (English)",
    size: "~80 MB",
    multilingual: false,
    blurb: "A clear step up for not much more waiting. A good default.",
  },
  {
    id: "Xenova/whisper-base",
    label: "Base (all languages)",
    size: "~80 MB",
    multilingual: true,
    blurb: "Base, for a service that isn't in English.",
  },
  {
    id: "Xenova/whisper-small.en",
    label: "Small (English)",
    size: "~250 MB",
    multilingual: false,
    blurb: "Noticeably better with names and numbers. Wants a recent machine.",
  },
  {
    id: "Xenova/whisper-small",
    label: "Small (all languages)",
    size: "~250 MB",
    multilingual: true,
    blurb: "Small, for a service that isn't in English.",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Large v3 Turbo (all languages)",
    size: "~800 MB",
    multilingual: true,
    blurb:
      "The accurate one, and the slow one. It needs a graphics card the app can reach; on CPU it will fall a sentence or more behind the preacher. Try Base first.",
  },
];

export const DEFAULT_WHISPER_MODEL: WhisperModelId = "Xenova/whisper-base.en";

export function whisperModel(id: string | null | undefined): WhisperModelInfo {
  return WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS.find((m) => m.id === DEFAULT_WHISPER_MODEL)!;
}

/** Whisper is trained at 16 kHz and resamples nothing for you. */
export const WHISPER_RATE = 16000;

export type LocalSttEvent =
  | { type: "progress"; loaded: number; total: number; file: string }
  | { type: "ready"; device: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string };

type WorkerMsg =
  | { type: "load"; model: string; language: string | null; host: string | null }
  | { type: "audio"; pcm: Float32Array }
  | { type: "close" };

/**
 * A running local recogniser.
 *
 * Audio goes in as 16 kHz mono float samples; text comes out as whole
 * utterances. The worker does the windowing, because deciding when a sentence
 * has ended is the part that needs to see the audio.
 */
export class LocalRecogniser {
  private worker: Worker | null = null;

  constructor(
    private readonly model: string,
    private readonly language: string | null,
    private readonly onEvent: (e: LocalSttEvent) => void,
    /** Where to fetch models from. null = Hugging Face's own CDN. */
    private readonly host: string | null = null,
  ) {}

  start() {
    // new URL(..., import.meta.url) is how Vite finds and bundles a worker;
    // a plain string path works in dev and 404s in the built app.
    this.worker = new Worker(new URL("../workers/whisper-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<LocalSttEvent>) => this.onEvent(ev.data);
    this.worker.onerror = (ev) =>
      this.onEvent({ type: "error", message: ev.message || "The local model failed to start." });
    this.post({ type: "load", model: this.model, language: this.language, host: this.host });
  }

  /** 16 kHz mono samples. Transferred, not copied - do not reuse the buffer. */
  push(pcm: Float32Array) {
    this.worker?.postMessage({ type: "audio", pcm }, [pcm.buffer]);
  }

  stop() {
    this.post({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
  }

  private post(msg: WorkerMsg) {
    this.worker?.postMessage(msg);
  }
}

/**
 * Mic stream -> 16 kHz mono float frames.
 *
 * An AudioContext asked for 16 kHz does the resampling itself, in C++, which
 * is both faster and more correct than anything worth writing here. The
 * fallback to ScriptProcessor exists because AudioWorklet needs a module URL
 * and one deprecated node is a smaller risk than a worklet that fails to load
 * five minutes into a sermon.
 */
export function pcmFromStream(
  stream: MediaStream,
  onFrame: (pcm: Float32Array) => void,
): () => void {
  const ctx = new AudioContext({ sampleRate: WHISPER_RATE });
  const src = ctx.createMediaStreamSource(stream);
  // 4096 frames at 16 kHz is a quarter second - small enough to feel live,
  // big enough that the main thread is not woken constantly.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (ev) => {
    // Copied: the event's buffer is reused by the next callback.
    onFrame(new Float32Array(ev.inputBuffer.getChannelData(0)));
  };
  src.connect(node);
  // ScriptProcessor only runs while connected to the destination. A zero gain
  // keeps it pumping without putting the room mic through the room speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume().catch(() => {});

  return () => {
    try {
      node.disconnect();
      src.disconnect();
      mute.disconnect();
    } catch {
      /* already torn down */
    }
    void ctx.close().catch(() => {});
  };
}

/** What a GPUAdapter looks like to the bit of it that matters here. */
export type AdapterLike = { info?: { subgroupMinSize?: number } } | null | undefined;

export type LoadAttempt = { device: "webgpu" | "wasm"; dtype: "fp32" | "q8" };

/**
 * Which backends to try, in order, for a given WebGPU adapter.
 *
 * Pulled out of the worker so the rule can be tested, because getting it
 * wrong shipped: the first version asked only whether `navigator.gpu`
 * existed. It exists in Electron 30 (Chromium 124) while `GPUAdapter.info`
 * does not - that arrived in Chromium 131 - and ONNX Runtime's WebGPU
 * backend reads `adapter.info.subgroupMinSize` as it starts up. Every
 * desktop copy therefore downloaded the whole model and then died with
 * "Cannot read properties of undefined (reading 'subgroupMinSize')".
 *
 * So the test is for the information the backend will read, not for WebGPU
 * as an idea; and WASM is always left on the end of the list, because this
 * can only rule out the failures already seen.
 */
export function loadAttempts(adapter: AdapterLike): LoadAttempt[] {
  const wasm: LoadAttempt = { device: "wasm", dtype: "q8" };
  // fp32 on the GPU: quantised encoders are where WebGPU backends break.
  if (typeof adapter?.info?.subgroupMinSize === "number") {
    return [{ device: "webgpu", dtype: "fp32" }, wasm];
  }
  return [wasm];
}

/* ---------------- Languages and accents ---------------- */

/**
 * The languages Whisper actually knows, as far as this app offers them.
 *
 * Taken from the model's own list of 99, not from a wish list. The African
 * languages are first because they are the ones people here ask for and the
 * ones buried deepest in an alphabetical list of ninety-nine.
 */
export const WHISPER_LANGS: { code: string; label: string; group: string }[] = [
  { code: "multi", label: "Auto-detect", group: "General" },
  { code: "en", label: "English", group: "General" },

  { code: "yo", label: "Yoruba", group: "Africa" },
  { code: "ha", label: "Hausa", group: "Africa" },
  { code: "sw", label: "Swahili", group: "Africa" },
  { code: "am", label: "Amharic", group: "Africa" },
  { code: "so", label: "Somali", group: "Africa" },
  { code: "sn", label: "Shona", group: "Africa" },
  { code: "ln", label: "Lingala", group: "Africa" },
  { code: "mg", label: "Malagasy", group: "Africa" },
  { code: "af", label: "Afrikaans", group: "Africa" },

  { code: "fr", label: "French", group: "Other" },
  { code: "es", label: "Spanish", group: "Other" },
  { code: "pt", label: "Portuguese", group: "Other" },
  { code: "ar", label: "Arabic", group: "Other" },
  { code: "de", label: "German", group: "Other" },
  { code: "it", label: "Italian", group: "Other" },
  { code: "nl", label: "Dutch", group: "Other" },
  { code: "hi", label: "Hindi", group: "Other" },
  { code: "id", label: "Indonesian", group: "Other" },
  { code: "zh", label: "Chinese", group: "Other" },
  { code: "ko", label: "Korean", group: "Other" },
];

/**
 * Languages Vifug ships a Bible in but Whisper cannot hear.
 *
 * Said out loud in the settings panel rather than left to be discovered
 * mid-service. An Igbo congregation picking the local engine and finding
 * nothing happens deserves to have been told, and the honest answer is that
 * the model was never trained on it - no setting will fix that.
 */
export const WHISPER_CANNOT_HEAR = ["Igbo", "Nigerian Pidgin", "Twi"];

/** The all-languages sibling of an English-only model, if it has one. */
const MULTILINGUAL_TWIN: Record<string, WhisperModelId> = {
  "Xenova/whisper-tiny.en": "Xenova/whisper-tiny",
  "Xenova/whisper-base.en": "Xenova/whisper-base",
  "Xenova/whisper-small.en": "Xenova/whisper-small",
};

/** True for the `.en` models, which were trained on English alone. */
export function isEnglishOnly(modelId: string): boolean {
  return modelId.endsWith(".en");
}

/**
 * The model to actually load, given the language and the accent in the room.
 *
 * Two reasons it may not be the one in the dropdown:
 *
 *  - A language other than English on an English-only model cannot work at
 *    all. Silently loading it would transcribe Yoruba as nonsense English.
 *
 *  - The `.en` models were trained on English only, and in practice that
 *    means mostly American and British English. The all-languages models
 *    heard far more of the world, and handle Nigerian, Ghanaian, Kenyan,
 *    Caribbean and Indian English noticeably better - which is the whole
 *    point of the accent switch. They are the same size and the same speed;
 *    only the training differs.
 *
 * A custom model id is left exactly as typed: whoever pasted a fine-tune in
 * knows what they are doing, and second-guessing it would make the box
 * useless.
 */
export function effectiveModel(
  modelId: string,
  language: string | null | undefined,
  accentedEnglish: boolean,
): string {
  if (!(modelId in MULTILINGUAL_TWIN)) return modelId;
  const nonEnglish = !!language && language !== "en";
  if (nonEnglish || accentedEnglish) return MULTILINGUAL_TWIN[modelId]!;
  return modelId;
}

/** Why the loaded model differs from the chosen one, for saying so in the UI. */
export function modelSwapReason(
  modelId: string,
  language: string | null | undefined,
  accentedEnglish: boolean,
): "language" | "accent" | null {
  if (effectiveModel(modelId, language, accentedEnglish) === modelId) return null;
  return language && language !== "en" ? "language" : "accent";
}
