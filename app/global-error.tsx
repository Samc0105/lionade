"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: "#04080F", color: "#EEF4FF", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}>
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <div style={{ fontSize: "64px", marginBottom: "24px" }}>⚠️</div>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", letterSpacing: "2px", marginBottom: "12px" }}>
              SOMETHING WENT WRONG
            </h2>
            <p style={{ color: "rgba(238,244,255,0.4)", fontSize: "14px", marginBottom: "32px", lineHeight: "1.6" }}>
              A critical error occurred. Click below to reload.
            </p>
            <button
              onClick={reset}
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                color: "#04080F",
                border: "none",
                padding: "12px 32px",
                borderRadius: "12px",
                fontWeight: "bold",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
