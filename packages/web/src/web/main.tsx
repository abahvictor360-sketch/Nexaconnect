/**
 * Vifug - free, offline-first worship presentation software.
 * Created by Victor Abah.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import App from "./app.tsx";
import { registerServiceWorker, watchInstallPrompt } from "./lib/pwa";
import { hydrateSessionMedia } from "./lib/session-media";

const queryClient = new QueryClient();

/**
 * Hash location with the query stripped, for matching only.
 *
 * wouter's useHashLocation reports everything after the "#", query string
 * included, so "#/projector?screen=overflow" is compared against the route
 * "/projector" and does not match - the page renders nothing at all, which is
 * a blank projector rather than an error anyone can act on.
 *
 * The hash itself is left alone, so anything reading the query still can (see
 * lib/screens.ts). Only what the router matches on changes.
 */
function useHashPath(): [string, (to: string, opts?: { replace?: boolean }) => void] {
	const [loc, navigate] = useHashLocation();
	const q = loc.indexOf("?");
	return [q === -1 ? loc : loc.slice(0, q), navigate];
}

// Installable, and able to open without a connection. Both are no-ops in the
// desktop app, which ships its own assets and has no browser to install into.
watchInstallPrompt();
registerServiceWorker();
// Files this browser was holding before the last reload. Fire-and-forget: the
// app renders now and the media library fills in when the read lands.
void hydrateSessionMedia();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<Router hook={useHashPath}>
				<App />
			</Router>
		</QueryClientProvider>
	</StrictMode>,
);
