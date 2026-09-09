import { useCallback, useEffect, useState } from "react";
import { Volume2, Loader2, RefreshCw } from "lucide-react";
import {
  audioOutputSupported,
  listAudioOutputs,
  playTestTone,
  type AudioOutputDevice,
} from "../lib/audio-output";

/**
 * Speaker chooser for everything the app plays out loud.
 *
 * The failure this exists for: a laptop plugged into the desk by HDMI or USB
 * keeps sending audio to its own speakers, so a video plays on the projector
 * in silence and the operator has nowhere in the app to say "send it to the
 * PA". The Test button is the other half - a route worth checking is a route
 * worth checking BEFORE the room is full.
 */
export function SpeakerPicker({
  deviceId,
  onChange,
}: {
  deviceId: string | null;
  onChange: (device: AudioOutputDevice | null) => void;
}) {
  const supported = audioOutputSupported();
  const [devices, setDevices] = useState<AudioOutputDevice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (probe: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await listAudioOutputs({ probe }));
    } catch {
      setError("Could not read the list of sound devices.");
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Listed without prompting first: names are often already available (any
  // page that has had mic permission once), and asking for a microphone the
  // moment Settings opens - to choose a SPEAKER - is a confusing prompt.
  useEffect(() => {
    if (!supported) return;
    void load(false);
    const onChanged = () => void load(false);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChanged);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChanged);
  }, [supported, load]);

  if (!supported) {
    return (
      <p className="text-[12px] text-[var(--v-text-faint)]">
        This browser always plays through the computer's default sound device and offers no way to
        pick another - change it in the operating system's sound settings, or use the Vifug desktop
        app (or Chrome/Edge) to choose one here.
      </p>
    );
  }

  const unnamed = !!devices?.length && devices.every((d) => !d.label || /^Speaker \d+$/.test(d.label));

  return (
    <div>
      {/* On a phone, or in the narrow settings column, the device name and the
          Test button cannot both fit on one line - the select was collapsing to
          about 18px wide, too narrow to read or tap. Let the row wrap and hold
          the select to a readable width instead of letting flex crush it. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={deviceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            const dev = devices?.find((d) => d.deviceId === id);
            onChange(id ? { deviceId: id, label: dev?.label ?? "Speakers" } : null);
          }}
          className="h-8 min-w-[11rem] flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 text-xs outline-none focus:border-[var(--v-accent)]"
        >
          <option value="">System default output</option>
          {devices?.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
          {/* A device chosen last week and unplugged today would otherwise
              vanish from the list, silently reading as "System default". */}
          {deviceId && !devices?.some((d) => d.deviceId === deviceId) && (
            <option value={deviceId}>Chosen device (not connected)</option>
          )}
        </select>
        <button
          onClick={async () => {
            setTesting(true);
            setError(null);
            try {
              await playTestTone(deviceId);
            } catch {
              setError("Could not play through that device. It may be unplugged or in use.");
            } finally {
              setTesting(false);
            }
          }}
          disabled={testing}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--v-surface)] disabled:opacity-60"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
          {testing ? "Playing" : "Test"}
        </button>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          title="Re-read the sound devices, and ask for permission so they can be named"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2 py-1.5 text-[12px] hover:bg-[var(--v-surface)] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {unnamed && (
        <p className="mt-1.5 text-[12px] text-[var(--v-text-faint)]">
          Devices are unnamed until this app has been allowed audio access once - press the refresh
          button and accept the prompt to see their real names.
        </p>
      )}
      {error && <p className="mt-1.5 text-[12px] text-amber-500">{error}</p>}
    </div>
  );
}
