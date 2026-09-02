import { useMediaUrl } from "../hooks/use-media-url";

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
  if (!url) return null;
  return <audio src={url} {...rest} />;
}
