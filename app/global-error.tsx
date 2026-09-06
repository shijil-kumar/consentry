"use client";

// The last net. global-error replaces the root layout entirely, so it renders
// its own <html> and cannot use anything from the app shell — no Tailwind
// classes from the layout, no fonts, no providers. Hence the inline styles.
//
// It exists because without an error boundary any component that throws takes
// the whole page to a blank white screen, with no recovery and no route back.
// On a product whose entire value is that people trust what it says, a blank
// screen is not a neutral failure.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0c",
          color: "#f4f4f5",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Something broke on our side
          </h1>
          <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#a1a1aa" }}>
            Nothing you were doing was lost or changed — this page failed to
            render, which never alters a consent record, a licence or a payment.
          </p>
          {error.digest && (
            <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#71717a" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#f4f4f5",
              fontSize: "0.9375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
