/**
 * vMix Web API bridge - "teleport" the live stream overlay into vMix as a
 * Web Browser input (Function=AddInput&Value=WebBrowser|<url>, per vMix's
 * Shortcut Function Reference).
 *
 * vMix's HTTP API doesn't send CORS headers, so the request is sent with
 * mode:"no-cors": vMix still receives and executes it, but the browser
 * refuses to expose the response to JS. A thrown fetch error (host/port
 * unreachable) is the only signal we get back - "no error" is reported as
 * sent, not confirmed delivered.
 */

export class VmixError extends Error {}

export async function sendToVmix(opts: { host: string; port: number; url: string }): Promise<void> {
  const params = new URLSearchParams({ Function: "AddInput", Value: `WebBrowser|${opts.url}` });
  try {
    await fetch(`http://${opts.host}:${opts.port}/api/?${params.toString()}`, { mode: "no-cors" });
  } catch {
    throw new VmixError("Could not reach vMix - check the host/port and that vMix is running with Web Controller enabled.");
  }
}
