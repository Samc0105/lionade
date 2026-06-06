"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error.tsx] root unhandled", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#04080F",
          color: "#EEF4FF",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          minHeight: "100vh",
        }}
      >
        <style>{`
          @keyframes ge-drift-a {
            0%, 100% { transform: translate3d(-3%, -2%, 0) scale(1); opacity: 0.5; }
            50%      { transform: translate3d(4%, 3%, 0) scale(1.07); opacity: 0.7; }
          }
          @keyframes ge-drift-b {
            0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.03); opacity: 0.4; }
            50%      { transform: translate3d(-3%, -3%, 0) scale(0.97); opacity: 0.55; }
          }
          @keyframes ge-fade-up {
            from { opacity: 0; transform: translate3d(0, 12px, 0); }
            to   { opacity: 1; transform: translate3d(0, 0, 0); }
          }
          .ge-drift-a { animation: ge-drift-a 13s ease-in-out infinite; will-change: transform, opacity; }
          .ge-drift-b { animation: ge-drift-b 17s ease-in-out infinite; will-change: transform, opacity; }
          .ge-fade-up { animation: ge-fade-up 0.55s cubic-bezier(0.16,1,0.3,1) both; will-change: transform, opacity; }
          .ge-btn-primary:hover   { transform: translate3d(0, -2px, 0); }
          .ge-btn-secondary:hover { transform: translate3d(0, -2px, 0); }
          .ge-btn-primary:active, .ge-btn-secondary:active { transform: scale(0.97); }
          @media (prefers-reduced-motion: reduce) {
            .ge-drift-a, .ge-drift-b, .ge-fade-up { animation: none; }
            .ge-btn-primary:hover, .ge-btn-secondary:hover { transform: none; }
          }
        `}</style>

        <div
          style={{
            position: "relative",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            className="ge-drift-a"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse 60% 50% at 32% 30%, rgba(255,215,0,0.09) 0%, transparent 60%)",
            }}
          />
          <div
            aria-hidden="true"
            className="ge-drift-b"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse 55% 45% at 72% 70%, rgba(182,160,255,0.09) 0%, transparent 65%)",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, rgba(4,8,15,0.85) 100%)",
            }}
          />

          <div
            className="ge-fade-up"
            style={{ position: "relative", textAlign: "center", maxWidth: "480px" }}
          >
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.32em",
                color: "rgba(238,244,255,0.4)",
                marginBottom: "16px",
              }}
            >
              Critical drift
            </p>

            <h1
              style={{
                fontSize: "clamp(48px, 9vw, 88px)",
                fontWeight: 800,
                letterSpacing: "0.08em",
                lineHeight: 1,
                margin: 0,
                color: "#EEF4FF",
                textShadow:
                  "0 0 32px rgba(255,215,0,0.16), 0 0 64px rgba(182,160,255,0.10)",
              }}
            >
              SOMETHING GLITCHED
            </h1>

            <p
              style={{
                color: "rgba(238,244,255,0.55)",
                fontSize: "15px",
                lineHeight: 1.6,
                marginTop: "24px",
                marginBottom: "32px",
                maxWidth: "400px",
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              The whole console blinked. Reload to relight the lions.
            </p>

            <button
              onClick={reset}
              className="ge-btn-primary"
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                color: "#04080F",
                border: "none",
                padding: "12px 32px",
                borderRadius: "12px",
                fontWeight: 700,
                fontSize: "14px",
                cursor: "pointer",
                boxShadow:
                  "0 8px 24px rgba(255,215,0,0.22), inset 0 0 0 1px rgba(255,215,0,0.35)",
                transition: "transform 0.2s ease",
                willChange: "transform",
                letterSpacing: "0.02em",
              }}
            >
              Reload Lionade
            </button>

            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.28em",
                color: "rgba(238,244,255,0.3)",
                marginTop: "40px",
              }}
            >
              {error?.digest ? `REF / ${error.digest}` : "ERR / ROOT"}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
