import { useCallback, useEffect, useRef, useState } from "react";
import { peakLevel, publishMicLevel } from "../lib/audio-taps";
import { parseSpokenReference, spokenRefToQuery } from "../lib/spoken-ref";
import { LocalRecogniser, pcmFromStream } from "../lib/local-stt";
import { api } from "../lib/api";

/** Minimal slide shape auto-follow needs (satisfied by lyric & bible slides). */
type FollowSlide = { sourceLines: string[]; translationLines: string[] };

/**
 * AI auto-follow via Deepgram live transcription.
 *
 * Captures the room mic, streams PCM to Deepgram's realtime WS, and matches the
 * rolling transcript against the words of upcoming slides. When a later slide's
 * text is confidently heard, it advances. MANUAL OVERRIDE ALWAYS WINS: the
 * operator's own next/prev/goLive updates `currentIndex` and auto-follow simply
 * continues from wherever the operator left it.
 */

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// Longest contiguous token overlap between transcript tail and a slide.
function matchScore(transcriptTokens: string[], slideTokens: string[]): number {
  if (!slideTokens.length || !transcriptTokens.length) return 0;
  const tail = transcriptTokens.slice(-14);
  const set = new Set(tail);
  let hits = 0;
  for (const w of slideTokens) if (set.has(w)) hits++;
  return hits / slideTokens.length;
}

export type AutoFollowStatus = "off" | "connecting" | "listening" | "error" | "unavailable";

export function useAutoFollow(opts: {
  slides: FollowSlide[];
  currentIndex: number;
  onAdvanceTo: (index: number) => void;
  /** Fraction of a slide's words that must be heard to advance (0.15–0.6). */
  threshold?: number;
  /** How many upcoming slides to scan for a match. */
  lookahead?: number;
  /** Microphone to listen on; null/undefined = system default input. */
  inputDeviceId?: string | null;
  /** Browser-level noise suppression on the listening stream. Default on. */
  noiseSuppression?: boolean;
  /**
   * Lowercased canon book names. Given these, a scripture reference spoken
   * out loud is cued through `onScripture`; without them that is off.
   */
  bookNames?: string[];
  /** A reference the preacher just read out, as "john 3:16". */
  onScripture?: (query: string) => void;
  /**
   * The passage already on screen. A preacher names the book once and then
   * walks it - "verse eighteen", "and nineteen", "turn over to chapter four"
   * - so without this the following stops exactly when the reading starts.
   */
  scriptureContext?: { book: string; chapter: number } | null;
  /** "deepgram" (default) or "local" - Whisper running on this machine. */
  engine?: "deepgram" | "local";
  /** Which Whisper to download and run, when engine is "local". */
  localModel?: string | null;
  /** Spoken language code, or "multi". Used by the local engine. */
  language?: string | null;
}) {
  const {
    slides, currentIndex, onAdvanceTo, threshold = 0.34, lookahead = 3,
    inputDeviceId, noiseSuppression = true, bookNames, onScripture,
    scriptureContext, engine = "deepgram", localModel, language,
  } = opts;
  const [status, setStatus] = useState<AutoFollowStatus>("off");
  const [heard, setHeard] = useState("");
  /** Model download progress, 0-1, while a local model is being fetched. */
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  /**
   * What actually went wrong, when something did. "error" on its own sends
   * an operator hunting through microphone settings for what is usually a
   * blocked download.
   */
  const [errorText, setErrorText] = useState<string | null>(null);

  const bookNamesRef = useRef(bookNames);
  bookNamesRef.current = bookNames;
  const onScriptureRef = useRef(onScripture);
  onScriptureRef.current = onScripture;
  const contextRef = useRef(scriptureContext ?? null);
  contextRef.current = scriptureContext ?? null;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const localModelRef = useRef(localModel ?? null);
  localModelRef.current = localModel ?? null;
  const languageRef = useRef(language ?? null);
  languageRef.current = language ?? null;

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const transcriptRef = useRef<string[]>([]);
  const idxRef = useRef(currentIndex);
  const slidesRef = useRef(slides);
  const lastAdvanceRef = useRef(0);
  const tuningRef = useRef({ threshold, lookahead });
  // Read through a ref: start() is a stable callback, so changing the mic in
  // Settings must not tear down and restart a listening session mid-song.
  const inputDeviceIdRef = useRef(inputDeviceId ?? null);
  const noiseSuppressionRef = useRef(noiseSuppression);
  idxRef.current = currentIndex;
  slidesRef.current = slides;
  tuningRef.current = { threshold, lookahead };
  inputDeviceIdRef.current = inputDeviceId ?? null;
  noiseSuppressionRef.current = noiseSuppression;

  const slideTokens = useCallback((i: number) => {
    const s = slidesRef.current[i];
    if (!s) return [];
    return tokenize([...s.sourceLines, ...s.translationLines].join(" "));
  }, []);

  const evaluate = useCallback(() => {
    const tokens = transcriptRef.current;
    const cur = idxRef.current;
    const { threshold: thr, lookahead: look } = tuningRef.current;
    // Look at the next few slides; advance to the furthest confident match.
    let best = -1;
    let bestScore = thr; // threshold
    for (let i = cur + 1; i <= Math.min(cur + look, slidesRef.current.length - 1); i++) {
      const sc = matchScore(tokens, slideTokens(i));
      if (sc >= bestScore) {
        best = i;
        bestScore = sc;
      }
    }
    if (best >= 0 && Date.now() - lastAdvanceRef.current > 1200) {
      lastAdvanceRef.current = Date.now();
      onAdvanceTo(best);
    }
  }, [onAdvanceTo, slideTokens]);

  /*
   * The level the mixer's Microphone meter shows while Auto-Follow listens.
   *
   * Tapped off the stream that is already open rather than a second one -
   * two streams on one microphone means two recording indicators, and some
   * drivers will not hand the device out twice.
   */
  const meterRef = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);

  const stopMeter = useCallback(() => {
    const m = meterRef.current;
    meterRef.current = null;
    if (!m) return;
    clearInterval(m.timer);
    void m.ctx.close().catch(() => {});
    publishMicLevel(null);
  }, []);

  const startMeter = useCallback(
    (stream: MediaStream) => {
      stopMeter();
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        // Not connected to the destination: the room mic through the room
        // speakers is feedback, not monitoring.
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        meterRef.current = {
          ctx,
          timer: setInterval(() => publishMicLevel(peakLevel(analyser, buf)), 80),
        };
      } catch {
        // No meter, but Auto-Follow itself carries on listening.
      }
    },
    [stopMeter],
  );

  const localRef = useRef<LocalRecogniser | null>(null);
  const pcmStopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    pcmStopRef.current?.();
    pcmStopRef.current = null;
    localRef.current?.stop();
    localRef.current = null;
    stopMeter();
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    transcriptRef.current = [];
    setModelProgress(null);
    setErrorText(null);
    setStatus("off");
  }, [stopMeter]);

  /*
   * A reference read out loud, cued once.
   *
   * Only the sentence just finished is looked at, not the rolling window the
   * lyric matcher uses: a preacher who says "John three sixteen" and then
   * preaches on it for ten minutes should not have the verse re-cued every
   * time the window happens to still contain those words. Saying it again
   * deliberately does cue it again, once enough has been said in between for
   * it to leave the last-seen slot.
   */
  const lastRefRef = useRef<string | null>(null);
  const listenForScripture = useCallback(
    (sentence: string) => {
      if (!bookNamesRef.current?.length || !onScriptureRef.current) return;
      const ref = parseSpokenReference(sentence, bookNamesRef.current, contextRef.current);
      if (!ref) return;
      const query = spokenRefToQuery(ref);
      if (query === lastRefRef.current) return;
      lastRefRef.current = query;
      onScriptureRef.current(query);
    },
    [],
  );

  /*
   * Act on what is being said, not on what has been said.
   *
   * Deepgram finalises an utterance only once the speaker pauses, which for a
   * preacher mid-flow can be ten or fifteen seconds after the reference left
   * their mouth. Reading the interim results instead puts the verse up while
   * the sentence is still being spoken - which is the whole point, since the
   * congregation is already turning there.
   *
   * It is safe here in a way it would not be for the lyric matcher: a
   * reference is only acted on when the shape is unmistakable, and the same
   * reference arriving again as the interim firms up is swallowed by the
   * dedupe above. The worst case is a correction - "John three" and then
   * "John three sixteen" a moment later - which lands on the right verse one
   * step late rather than on the wrong one.
   */
  const interimRef = useRef({ at: 0 });
  const listenForScriptureInterim = useCallback(
    (sentence: string) => {
      // Interim messages arrive several times a second. Parsing is cheap, but
      // there is no sense doing it on every keystroke-sized update.
      const now = Date.now();
      if (now - interimRef.current.at < 250) return;
      interimRef.current.at = now;
      listenForScripture(sentence);
    },
    [listenForScripture],
  );

  /** The one place the room mic is opened, whichever engine is listening. */
  const openMic = useCallback(async () => {
    // Use the microphone chosen in Settings → AI. Without this the browser
    // picks the system default, which on Windows is often a webcam mic
    // pointed away from the room - Auto-Follow then "works" but hears
    // nothing. `ideal` (not `exact`) so a mic unplugged since it was chosen
    // falls back to the default instead of throwing mid-service.
    const deviceId = inputDeviceIdRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        noiseSuppression: noiseSuppressionRef.current,
      },
    });
    mediaRef.current = stream;
    // While Auto-Follow is listening it IS the microphone, so it reports the
    // level too: the mixer's meter then costs nothing extra, and nothing
    // opens the device a second time to draw it.
    startMeter(stream);
    return stream;
  }, [startMeter]);

  /**
   * Whisper on this machine - no key, no account, no uplink.
   *
   * Everything downstream is the same as Deepgram's: whole utterances in,
   * the lyric matcher and the scripture listener fed exactly as before. The
   * only honest difference is latency, which is why the heavier models carry
   * a warning rather than being hidden.
   */
  const startLocal = useCallback(async () => {
    setErrorText(null);
    setStatus("connecting");
    try {
      const stream = await openMic();
      const rec = new LocalRecogniser(
        localModelRef.current || "Xenova/whisper-base.en",
        languageRef.current,
        (ev) => {
          if (ev.type === "progress") {
            setModelProgress(ev.total ? ev.loaded / ev.total : null);
            return;
          }
          if (ev.type === "ready") {
            setModelProgress(null);
            setStatus("listening");
            return;
          }
          if (ev.type === "error") {
            setErrorText(ev.message);
            setStatus("error");
            return;
          }
          const toks = tokenize(ev.text);
          if (!toks.length) return;
          transcriptRef.current = [...transcriptRef.current, ...toks].slice(-40);
          setHeard(transcriptRef.current.slice(-10).join(" "));
          listenForScripture(ev.text);
          evaluate();
        },
      );
      localRef.current = rec;
      rec.start();
      // Audio starts flowing straight away: the worker buffers it while the
      // model downloads, so the first thing said is not lost to the wait.
      pcmStopRef.current = pcmFromStream(stream, (pcm) => rec.push(pcm));
    } catch {
      setStatus("error");
      mediaRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [openMic, evaluate, listenForScripture]);

  const start = useCallback(async () => {
    if (engineRef.current === "local") return startLocal();
    setErrorText(null);
    setStatus("connecting");
    try {
      const cfgRes = await api.autofollow.config.$get();
      const cfg = (await cfgRes.json()) as
        | { enabled: false; reason?: string }
        | { enabled: true; key: string; model: string; language?: string; provider: string };
      if (!cfg.enabled) {
        setStatus("unavailable");
        return;
      }

      const stream = await openMic();

      // No `encoding` param: MediaRecorder sends containerized WebM/Opus and
      // Deepgram auto-detects containers; forcing encoding=opus (raw packets)
      // makes transcription silently fail.
      const langParam = cfg.language ? `&language=${encodeURIComponent(cfg.language)}` : "";
      const url = `wss://api.deepgram.com/v1/listen?model=${cfg.model}${langParam}&smart_format=true&interim_results=true`;
      const ws = new WebSocket(url, ["token", cfg.key]);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("listening");
        const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(ev.data);
        };
        rec.start(250);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const alt = msg.channel?.alternatives?.[0];
          const text: string = alt?.transcript ?? "";
          if (text && !msg.is_final) listenForScriptureInterim(text);
          if (text && msg.is_final) {
            const toks = tokenize(text);
            if (toks.length) {
              transcriptRef.current = [...transcriptRef.current, ...toks].slice(-40);
              setHeard(transcriptRef.current.slice(-10).join(" "));
              listenForScripture(text);
              evaluate();
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        recorderRef.current?.stop();
        recorderRef.current = null;
      };
    } catch {
      setStatus("error");
      mediaRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [evaluate, openMic, startLocal, listenForScripture, listenForScriptureInterim]);

  useEffect(() => stop, [stop]);

  return { status, heard, start, stop, modelProgress, errorText };
}
