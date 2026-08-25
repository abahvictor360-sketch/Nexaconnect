/**
 * The public page has no product rail. It is a marketing surface, and wrapping
 * it in an agent console's navigation would be the wrong first impression.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-white text-ink dark:bg-brand-950 dark:text-brand-50">{children}</div>;
}
