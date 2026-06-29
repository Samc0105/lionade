"use client";

import { Component, type ReactNode } from "react";

/**
 * Widget-level error boundary. Wrap an independent dashboard widget so a
 * render-time throw (for example a malformed but HTTP-200 API payload that
 * violates a render assumption) degrades to a small "couldn't load" card
 * instead of unwinding the whole route to the root app/error.tsx fallback and
 * blanking the entire page. The SWR fetchers already .catch() network failures
 * into safe defaults; this covers the residual render-time throws those cannot.
 *
 * Class component on purpose: only class lifecycles (getDerivedStateFromError /
 * componentDidCatch) can catch render errors. Kept presentational and
 * synchronous so the fallback itself cannot throw.
 */
export default class WidgetErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[WidgetErrorBoundary] ${this.props.label ?? "widget"}`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-5 text-center">
          <p className="font-syne text-sm text-red-300">
            This section couldn&apos;t load. Give it another shot.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
