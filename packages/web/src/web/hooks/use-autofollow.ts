import { useCallback, useEffect, useRef, useState } from "react";
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
}) {
  const { slides, currentIndex, onAdvanceTo, threshold = 0.34, lookahead = 3, inputDeviceId } = opts;
  const [status, setStatus] = useState<AutoFollowStatus>("off");
  const [heard, setHeard] = useState("");

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
  idxRef.current = currentIndex;
  slidesRef.current = slides;
  tuningRef.current = { threshold, lookahead };
  inputDeviceIdRef.current = inputDeviceId ?? null;

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

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    transcriptRef.current = [];
    setStatus("off");
  }, []);

  const start = useCallback(async () => {
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

      // Use the microphone chosen in Settings → AI. Without this the browser
      // picks the system default, which on Windows is often a webcam mic
      // pointed away from the room - Auto-Follow then "works" but hears
      // nothing. `ideal` (not `exact`) so a mic unplugged since it was chosen
      // falls back to the default instead of throwing mid-service.
      const deviceId = inputDeviceIdRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
      });
      mediaRef.current = stream;

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
          if (text && msg.is_final) {
            const toks = tokenize(text);
            if (toks.length) {
              transcriptRef.current = [...transcriptRef.current, ...toks].slice(-40);
              setHeard(transcriptRef.current.slice(-10).join(" "));
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
  }, [evaluate]);

  useEffect(() => stop, [stop]);

  return { status, heard, start, stop };
}
