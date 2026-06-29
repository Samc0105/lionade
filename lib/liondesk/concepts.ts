// Concept taxonomy for TechHub mastery tracking. Every ticket the player works
// maps to one support concept (phishing, DNS, lockouts, ...). New content can
// tag a ticket explicitly via ShiftItem.concept, but the ~170 already-authored
// tickets carry no tag, so conceptForItem infers one from the item's tools and
// authored text. This is read-only inference: nothing here grants Fangs, and the
// shift content files are left untouched.

import type { ShiftItem } from "./types";

export interface ConceptDef {
  id: string;
  /** Display label for the review surface. */
  label: string;
  /** One line on what the concept covers. */
  blurb: string;
}

// Display order on the review surface. The last entry is the catch-all default.
export const CONCEPTS: ConceptDef[] = [
  { id: "phishing-id", label: "Phishing & Email Threats", blurb: "Spotting malicious mail and reporting it instead of clicking." },
  { id: "account-lockout", label: "Account Lockouts", blurb: "Getting people back in with safe unlocks and resets." },
  { id: "credential-hygiene", label: "Credential Hygiene", blurb: "MFA, password policy, and keeping logins secure." },
  { id: "privilege-escalation", label: "Privilege & Access", blurb: "Granting the right access without over provisioning." },
  { id: "dns-troubleshooting", label: "DNS & Connectivity", blurb: "Name resolution, networking, and restoring access." },
  { id: "hardware", label: "Hardware & Stockroom", blurb: "Diagnosing devices and ordering the right part in time." },
  { id: "incident-triage", label: "Incident Triage", blurb: "Finding one root cause behind a flood of tickets." },
  { id: "escalation-judgment", label: "Escalation Judgment", blurb: "Knowing when to escalate and to whom." },
  { id: "general-support", label: "General Support", blurb: "Everyday desk work that spans the basics." },
];

/** The default concept used when nothing else matches. */
export const DEFAULT_CONCEPT = "general-support";

const CONCEPT_IDS = new Set(CONCEPTS.map((c) => c.id));
const LABELS: Record<string, string> = Object.fromEntries(CONCEPTS.map((c) => [c.id, c.label]));

/** Display label for a concept id, falling back to the id itself. */
export function conceptLabel(id: string): string {
  return LABELS[id] ?? id;
}

/** Whether a string names a real concept (used to validate explicit tags). */
export function isConcept(id: string | undefined): id is string {
  return !!id && CONCEPT_IDS.has(id);
}

// Keyword inference, ordered most specific first; the first rule that hits wins.
// Patterns run against a space-normalized haystack (hyphens and underscores in
// ids/asset keys become spaces), so a ticket id like "account-lockout" or a kb
// key like "kb-dns" reads as plain words.
const KEYWORD_RULES: { concept: string; re: RegExp }[] = [
  { concept: "phishing-id", re: /phish|spoof|suspicious (e ?mail|link|attachment|message)|malware|ransomware|\bscam\b|fraud|impersonat|gift card|wire transfer|verify your (account|password)|click(ed)? (the|a|this) link|malicious|quarantine/ },
  { concept: "incident-triage", re: /outage|incident|multiple (users|people)|everyone|company ?wide|store ?wide|widespread|\bmass\b|root cause|sev ?1|degraded|service (is )?down|all users|postmortem|major incident/ },
  { concept: "account-lockout", re: /lock(ed)? ?out|lockout|locked account|can ?t (log|sign) ?in|cannot (log|sign) ?in|too many attempts|forgot (my )?password|disabled account|unlock (the |his |her |their )?account/ },
  { concept: "credential-hygiene", re: /\bmfa\b|2fa|two factor|authenticator|\botp\b|password (policy|manager|expir|reuse|reset|rotat)|shared password|reused password|passphrase|credential|lost device|stolen (phone|laptop|device)|account compromise/ },
  { concept: "privilege-escalation", re: /admin (rights|access)|local admin|elevat|\bsudo\b|privilege|permission|access request|group member|\brole\b|entitlement|needs? access|grant access|software center/ },
  { concept: "dns-troubleshooting", re: /\bdns\b|resolve|hostname|nslookup|\bping\b|network|connectivity|\bvpn\b|gateway|dhcp|ip address|subnet|can ?t (reach|connect|load)|website (is )?down|latency|wi ?fi|ethernet|proxy|\bcert\b|certificate|\bssl\b|\btls\b|mapped drive/ },
  { concept: "hardware", re: /laptop|desktop|monitor|keyboard|\bmouse\b|docking|\bdock\b|printer|toner|cartridge|\bcable\b|\bram\b|\bssd\b|hard drive|battery|stockroom|peripheral|headset|webcam|charger|adapter|\bsku\b|scanner|spooler|reimage|reinstall|cracked screen|hardware/ },
  { concept: "escalation-judgment", re: /escalat|tier ?2|tier ?3|\bsenior\b|out of scope|beyond (my|the)|loop in|hand ?off|vendor|on call|who owns|route (it )?to|defer to/ },
];

function haystack(i: ShiftItem): string {
  const parts: string[] = [i.id, i.subject, i.goal, i.hint, i.asset ?? "", i.kbArticleId ?? "", i.ticketBody ?? ""];
  if (i.email?.body) parts.push(i.email.body);
  if (i.phone) {
    parts.push(i.phone.opener);
    for (const f of i.phone.followups) parts.push(f.label, f.reply);
  }
  for (const a of i.actions) parts.push(a.label, a.detail ?? "", a.teach);
  return parts.join(" ").toLowerCase().replace(/[-_]+/g, " ");
}

/**
 * Infer the concept for a ticket. Explicit ShiftItem.concept wins; then the
 * item's tools give strong structural signals (a phishing email, an incident
 * group, an AD action, a part to ship); then keyword inference over the authored
 * text; then the General Support default. Pure and deterministic, safe to call
 * during SSR and from the shift generator.
 */
export function conceptForItem(item: ShiftItem): string {
  if (isConcept(item.concept)) return item.concept;

  // Structural signals from the item's tools.
  if (item.email?.isPhish) return "phishing-id";
  if (item.incident) return "incident-triage";
  if (item.ad?.action === "reset_mfa") return "credential-hygiene";
  if (item.ad?.action === "unlock" || item.ad?.action === "reset_pw") return "account-lockout";
  if (item.part) return "hardware";

  // Keyword inference over the authored text.
  const hay = haystack(item);
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(hay)) return rule.concept;
  }

  return DEFAULT_CONCEPT;
}
