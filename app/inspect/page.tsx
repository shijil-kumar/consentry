import Link from "next/link";
import { InspectDropzone } from "@/components/inspect-dropzone";
import { PublicHeader } from "@/components/public-header";


export const metadata = {
  title: "Inspect a video",
  description: "Drop in any video and check it against the consent ledger — creator, licence, consent status, and the approved script.",
};

export default function InspectPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicHeader width="max-w-3xl">
        <Link href="/marketplace" className="text-zinc-300 hover:text-white">Marketplace</Link>
      </PublicHeader>

      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Inspect a video</h1>
        {/* Claim exactly what the pipeline does, no more: credentials sealed in
            the file, PLUS a fingerprint recorded in the ledger. Both are checked
            here. Copy that outruns the result panel below costs more credibility
            than the bigger claim ever wins. */}
        <p className="mt-3 max-w-xl text-zinc-300">
          Every video this platform delivers carries C2PA Content Credentials sealed inside the
          file, and is fingerprinted into our ledger. Drop any video here to read them back and
          see whose consent backs it, who licensed it, and which script was approved.
        </p>
        <div className="mt-8">
          <InspectDropzone />
        </div>
        <p className="mt-8 text-xs leading-relaxed text-zinc-400">
          A video with no credentials isn&apos;t necessarily fake — but it can&apos;t prove what it
          is. One of ours can: the credentials survive re-uploading and renaming, and the consent
          behind them is re-read at the moment you ask, so a revoked grant shows up immediately.
        </p>
      </main>
    </div>
  );
}
