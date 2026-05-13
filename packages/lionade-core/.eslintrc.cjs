/**
 * lionade-core platform-boundary enforcement.
 *
 * This package MUST be consumable by both web (Next.js) and iOS (Expo + RN).
 * Any imports listed below would break one of those platforms.
 *
 * If you need a forbidden import:
 *  - DOM/browser globals → not in core. Pass as DI from the app.
 *  - React/RN/Next/Expo → not in core. Put in the app's components/ folder.
 *  - node:* → not in core. Server-only modules stay in /app/api/* on web.
 *  - direct Supabase client instance → not in core. Pass createClient() result via DI.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["react", "react-*"], message: "lionade-core must be platform-agnostic. No React imports." },
          { group: ["react-native", "react-native-*"], message: "lionade-core must be platform-agnostic. No React Native imports." },
          { group: ["next", "next/*"], message: "lionade-core must be platform-agnostic. No Next.js imports." },
          { group: ["expo", "expo-*"], message: "lionade-core must be platform-agnostic. No Expo imports." },
          { group: ["swr", "swr/*"], message: "SWR is a React hook lib. Put SWR hooks in each app, not core." },
          { group: ["node:*"], message: "lionade-core must not import node:* modules. Server-only code stays in /app/api on web." },
        ],
        paths: [
          { name: "fs", message: "Node fs is not allowed in lionade-core." },
          { name: "path", message: "Node path is not allowed in lionade-core." },
          { name: "crypto", message: "Use a DI'd random number generator instead of node:crypto." },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      { name: "window", message: "lionade-core must not access DOM globals." },
      { name: "document", message: "lionade-core must not access DOM globals." },
      { name: "localStorage", message: "lionade-core must not access DOM globals. Use DI'd storage instead." },
      { name: "sessionStorage", message: "lionade-core must not access DOM globals." },
    ],
  },
};
