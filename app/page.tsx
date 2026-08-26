import Chat from '@/components/chat';

export const dynamic = 'force-dynamic';

/**
 * The whole of `/` is the assistant.
 *
 * There is no marketing copy and no navigation here on purpose: a customer
 * arriving at a support URL wants to type their question, and every heading or
 * menu item between them and the composer is one more thing to read first. The
 * agent surfaces keep their own rail, and the customer is never shown a link
 * to them.
 */
export default function Page() {
  return (
    <main id="main" className="bg-brand-900">
      <Chat />
    </main>
  );
}
