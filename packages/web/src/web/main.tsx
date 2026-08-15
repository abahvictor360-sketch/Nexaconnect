/**
 * Vifug Lyrics - free, offline-first worship presentation software.
 * Created by Victor Abah (github.com/abahvictor360-sketch).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import App from "./app.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<Router hook={useHashLocation}>
				<App />
			</Router>
		</QueryClientProvider>
	</StrictMode>,
);
