// Bluff Trivia shared constants.
//
// FORFEIT_SENTINEL is the magic answer text a player submits to sit a round
// out. Three places depend on the EXACT same string + comparison:
//   - components/party/BluffView.tsx        (client submits it)
//   - app/api/party/bluff/rounds/[id]/route.ts   (GET filters it from vote +
//     reveal payloads so it never renders as a votable card)
//   - app/api/party/bluff/rounds/[id]/vote/route.ts (backstop: rejects votes
//     targeting a sentinel row by crafted/stale id)
// If these drift, the vote-list filter and the vote backstop stop agreeing
// and a forfeit row becomes a votable card worth unearned trick points.
// Import from here; never inline the literal.

export const FORFEIT_SENTINEL = "__forfeit__";

export function isForfeitText(text: string | null | undefined): boolean {
  return (text ?? "").trim().toLowerCase() === FORFEIT_SENTINEL;
}
