/*
 * The landing's own segment. It is a route group — `(home)` contributes
 * nothing to the URL — so it wraps `/` and `/uk` and nothing else. It loads
 * no face (the root layout carries Geist, Geist Mono and Unbounded with their
 * Cyrillic subsets) and no metadata: each address writes its own, in its own
 * language (`page.tsx`, `uk/page.tsx`).
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
