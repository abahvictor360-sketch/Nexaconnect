import { useEffect } from "react";
import { AnnouncementTicker } from "../components/announcement-ticker";
import { CaptureStage } from "../components/capture-stage";
import { useLiveState } from "../hooks/use-live";
import { useSettings } from "../hooks/use-settings";
import { getDesktopAPI } from "../lib/desktop";

/** Pure lyric output. Loaded in the second-monitor Electron window (or a browser tab). */
export default function ProjectorPage() {
  const state = useLiveState();
  // Polls (rather than a new push channel) so the announcement bar picks up
  // operator edits within a few seconds without extra plumbing.
  const settings = useSettings({ refetchInterval: 4000 }).data;
  const announcement = settings?.announcement;

  useEffect(() => {
    document.title = "Vifug Projector";
    document.body.style.cursor = "none";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  // Esc closes the projection. In the desktop app this closes the projector
  // window via the main process (which also notifies the operator and stops
  // NDI); in a browser it closes the popup window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const desktop = getDesktopAPI();
      if (desktop) {
        // dismissed: the operator shut the output off here, at the projector.
        // Without that the operator window's auto-open reopens it at once and
        // Esc looks like it does nothing.
        desktop.closeProjector({ dismissed: true }).catch(() => window.close());
      } else {
        window.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      {/* The projector IS the output, so it's the one instance that should
          actually be heard when a capture carries audio. */}
      <CaptureStage state={state} playAudio micDeviceId={settings?.audio?.inputDeviceId ?? null} />
      {announcement?.enabled && (
        <AnnouncementTicker
          text={announcement.text}
          speed={announcement.speed}
          bgColor={announcement.bgColor}
          textColor={announcement.textColor}
        />
      )}
    </div>
  );
}
