// Consentry mark: an emerald hexagon (nexus node) carrying a bold N whose
// center stroke doubles as a forward slash — connection + signature.
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden fill="none">
      <defs>
        <linearGradient id="nx-g" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <path
        d="M24 2.5 42.5 13v22L24 45.5 5.5 35V13Z"
        fill="url(#nx-g)"
      />
      <path
        d="M16 33V15h4.4l7.2 10.6V15H32v18h-4.4l-7.2-10.6V33Z"
        fill="#fafafa"
      />
    </svg>
  );
}

export function LogoWordmark({ name, dark = false }: { name: string; dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <LogoMark className="size-8" />
      <span className={dark ? "text-zinc-50" : undefined}>{name}</span>
    </span>
  );
}
