import { LogoMark } from "@/components/logo";

// Friendly gradient header for every dashboard: greeting, role blurb, and a
// slot for a contextual action on the right.
export function WelcomeBand({ name, blurb, heading, children }: {
  name: string;
  blurb: string;
  /** Page identity for sub-pages. Omit on a dashboard home to keep the greeting. */
  heading?: string;
  children?: React.ReactNode;
}) {
  const greeting = "Welcome back";
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-5 text-white shadow-md">
      <div className="flex items-center gap-4">
        <span className="hidden rounded-xl bg-white/15 p-2 backdrop-blur sm:block">
          <LogoMark className="size-9" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {heading ?? `${greeting}, ${name.split(" ")[0]}`}
          </h1>
          <p className="mt-0.5 text-sm text-emerald-50/90">{blurb}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
