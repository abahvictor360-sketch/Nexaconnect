import AppShell from '@/components/app-shell';
import { getViewer } from '@/lib/auth';

/** Everything behind the product rail: the chat, the console, the dashboard. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <AppShell viewer={viewer}>
      <main id="main" className="min-w-0">
        {children}
      </main>
    </AppShell>
  );
}
