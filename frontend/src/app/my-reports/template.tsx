// Each screen settles in on the expressive spring when you arrive at it
// (a template re-mounts on navigation, a layout does not).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
