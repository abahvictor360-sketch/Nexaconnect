import { useRef } from "react";
import { useMediaUrl } from "../hooks/use-media-url";
import { useAudioOutputMuted, useRoutedAudio } from "../hooks/use-audio-output";

/**
 * <img> and <video> that understand a browser-held file.
 *
 * Everywhere a thumbnail is drawn from a MediaItem's url, that url may be a
 * "session:<id>" marker for a file that was never uploaded. These resolve it
 * for the document they are rendered in and draw nothing until they can - the
 * alternative being a broken-image icon in the media library for a picture the
 * operator is looking straight at.
 */
export function MediaImg({ src, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string | null }) {
  const url = useMediaUrl(src);
  if (!url) return <span aria-hidden style={{ display: "block", width: "100%", height: "100%" }} />;
  return <img src={url} {...rest} />;
}

export function MediaVideo({
  src,
  ...rest
}: React.VideoHTMLAttributes<HTMLVideoElement> & { src?: string | null }) {
  const url = useMediaUrl(src);
  if (!url) return <span aria-hidden style={{ display: "block", width: "100%", height: "100%" }} />;
  return <video src={url} {...rest} />;
}

export function MediaAudio({
  src,
  ...rest
}: React.AudioHTMLAttributes<HTMLAudioElement> & { src?: string | null }) {
  const url = useMediaUrl(src);
  // Auditioning a track from the library plays out of the same device as the
  // service does - checking it on the laptop speakers is not checking it.
  const ref = useRef<HTMLAudioElement>(null);
  useRoutedAudio(ref, url);
  const outputMuted = useAudioOutputMuted();
  if (!url) return null;
  // muted after the spread, so the master mute wins over a caller's own value
  // rather than being overwritten by it.
  return <audio ref={ref} src={url} {...rest} muted={outputMuted || rest.muted} />;
}
