import { Suspense } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { AuthForm } from "@/components/auth-form";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <LogoMark className="size-8" />
        {PLATFORM}
      </Link>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
