// Build styled HTML doc(s) from markdown source(s).
// Self-contained: open in browser, share, or print-to-PDF (Cmd+P).
//
// Run:  node scripts/build-master-plan-doc.mjs
//
// Add a new doc by appending to the DOCS array below — markdown source +
// output path + cover metadata. The CSS, header, and structure are shared.

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const DOCS = [
  {
    src: "LIONADE_MASTER_PLAN.md",
    out: "LIONADE_MASTER_PLAN.html",
    title: "Lionade — Master Plan",
    eyebrow: "Internal · For team distribution",
    coverTitle: "LIONADE",
    coverSubtitle: "Master Plan — Features, Economics, Roadmap",
    stamp: "Last updated 2026-05-02 · Sam C",
  },
  {
    src: "FOCUS_MODE_PROPOSAL.md",
    out: "FOCUS_MODE_PROPOSAL.html",
    title: "Lionade — Focus Mode Proposal",
    eyebrow: "Internal · Feature proposal · For team review",
    coverTitle: "FOCUS MODE",
    coverSubtitle: "Proposal & Feasibility — Camera-based study lock-in",
    stamp: "2026-05-02 · Author: Sam · Originator: Dawda",
  },
];

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
});

const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    color: #1a1f2e;
    background: #f5f1e6;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    padding: 32px 0;
  }

  .page {
    max-width: 880px;
    margin: 0 auto;
    background: #ffffff;
    box-shadow: 0 4px 32px rgba(10, 16, 32, 0.06);
    border-radius: 12px;
    padding: 64px 72px;
  }

  .cover {
    text-align: left;
    padding-bottom: 32px;
    margin-bottom: 40px;
    border-bottom: 2px solid #f0b429;
  }
  .cover .eyebrow {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 12px;
  }
  .cover h1.title {
    font-family: "Bebas Neue", sans-serif;
    font-size: 72px;
    line-height: 0.95;
    letter-spacing: 0.02em;
    color: #1a1f2e;
    margin-bottom: 12px;
  }
  .cover .subtitle {
    font-size: 20px;
    color: #4b5563;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .cover .stamp {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #6b7280;
    margin-top: 16px;
  }

  h1 {
    font-family: "Bebas Neue", sans-serif;
    font-size: 36px;
    letter-spacing: 0.04em;
    color: #1a1f2e;
    margin: 56px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e5e7eb;
  }
  h1:first-of-type { margin-top: 0; }
  h2 {
    font-family: "Bebas Neue", sans-serif;
    font-size: 26px;
    letter-spacing: 0.04em;
    color: #1a1f2e;
    margin: 36px 0 12px;
  }
  h3 {
    font-family: "Inter", sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: #1a1f2e;
    margin: 28px 0 10px;
    letter-spacing: -0.01em;
  }
  h4 {
    font-family: "Inter", sans-serif;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #f0b429;
    margin: 24px 0 8px;
  }

  p { margin: 12px 0; color: #1f2937; font-size: 15px; }
  ul, ol { margin: 12px 0 12px 20px; color: #1f2937; font-size: 15px; }
  li { margin: 6px 0; }
  li > p { margin: 4px 0; }
  strong { color: #0f172a; font-weight: 700; }
  em { color: #334155; }

  a {
    color: #2563eb;
    text-decoration: none;
    border-bottom: 1px solid rgba(37, 99, 235, 0.25);
  }
  a:hover { border-bottom-color: #2563eb; }

  hr { border: none; border-top: 1px solid #e5e7eb; margin: 40px 0; }

  blockquote {
    border-left: 3px solid #f0b429;
    background: #fffaee;
    margin: 16px 0;
    padding: 12px 18px;
    font-size: 14px;
    color: #4b5563;
    border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: 4px 0; color: inherit; font-size: inherit; }

  code {
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    color: #be185d;
  }
  pre {
    background: #0f172a;
    color: #f1f5f9;
    padding: 16px 20px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 16px 0;
    font-size: 13px;
  }
  pre code { background: transparent; color: inherit; padding: 0; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 18px 0;
    font-size: 13.5px;
    background: #ffffff;
  }
  thead { background: #1a1f2e; color: #ffffff; }
  thead th {
    text-align: left;
    padding: 10px 12px;
    font-family: "Inter", sans-serif;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  tbody td {
    padding: 9px 12px;
    border-bottom: 1px solid #e5e7eb;
    color: #1f2937;
    vertical-align: top;
  }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody tr:hover { background: #fffaee; }

  ol > li > a { font-weight: 500; }

  @media print {
    body { background: #ffffff; padding: 0; }
    .page { box-shadow: none; border-radius: 0; padding: 24px 32px; max-width: none; }
    h1 { page-break-before: auto; page-break-after: avoid; }
    h2, h3 { page-break-after: avoid; }
    table, pre, blockquote { page-break-inside: avoid; }
    a { color: #1a1f2e; border-bottom: none; }
    thead { background: #1a1f2e !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tbody tr:nth-child(even) { background: #fafafa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

function render({ src, out, title, eyebrow, coverTitle, coverSubtitle, stamp }) {
  const md = fs.readFileSync(path.join(ROOT, src), "utf8");
  const body = marked.parse(md);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${SHARED_CSS}</style>
</head>
<body>
<div class="page">
  <div class="cover">
    <div class="eyebrow">${eyebrow}</div>
    <h1 class="title">${coverTitle}</h1>
    <div class="subtitle">${coverSubtitle}</div>
    <div class="stamp">${stamp}</div>
  </div>
  ${body}
</div>
</body>
</html>
`;

  const outPath = path.join(ROOT, out);
  fs.writeFileSync(outPath, html);
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Wrote ${out} (${sizeKb} KB)`);
}

for (const doc of DOCS) render(doc);
