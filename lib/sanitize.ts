// ─── Suspicious pattern detection ─────────────────────────────────────────────
const DANGEROUS_PATTERNS = [
  /<\s*script/i,           // <script tags
  /javascript\s*:/i,       // javascript: URLs
  /on\w+\s*=\s*["']/i,    // inline event handlers (onclick=, onload=, etc.)
  /vbscript\s*:/i,         // vbscript: URLs
  /data\s*:\s*text\/html/i, // data: HTML injection
  // SQL injection patterns
  /'\s*(or|and)\s+'?\d/i,
  /union\s+select/i,
  /drop\s+table/i,
  /insert\s+into/i,
  /delete\s+from/i,
  /update\s+\w+\s+set/i,
  /exec\s*\(/i,
  /xp_\w+/i,              // SQL Server extended procs
];

export function isSuspicious(value: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(value));
}

// ─── Strip HTML tags ───────────────────────────────────────────────────────────
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

// ─── General text field ────────────────────────────────────────────────────────
export function sanitizeText(value: string, maxLength = 255): string {
  return stripHtml(value).trim().slice(0, maxLength);
}

// ─── Username ──────────────────────────────────────────────────────────────────
export function sanitizeUsername(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .trim()
    .slice(0, 30);
}

// ─── Email ─────────────────────────────────────────────────────────────────────
export function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, 254);
}

// ─── Bio / longer text ─────────────────────────────────────────────────────────
export function sanitizeBio(value: string): string {
  return stripHtml(value).trim().slice(0, 150);
}

// ─── Password (no transformation, just length cap) ────────────────────────────
export function sanitizePassword(value: string): string {
  return value.slice(0, 128);
}

// ─── Validate and sanitize a whole form object ────────────────────────────────
export interface SanitizeResult<T> {
  data: T;
  blocked: boolean;
  reason?: string;
}

export function sanitizeSignupForm(raw: {
  email: string;
  username: string;
  password: string;
  firstName?: string;
}): SanitizeResult<typeof raw> {
  const data = {
    email:     sanitizeEmail(raw.email),
    username:  sanitizeUsername(raw.username),
    password:  sanitizePassword(raw.password),
    firstName: raw.firstName ? sanitizeText(raw.firstName, 50) : "",
  };

  for (const [field, val] of Object.entries(data)) {
    if (field !== "password" && isSuspicious(val)) {
      return { data, blocked: true, reason: `Suspicious content in ${field}` };
    }
  }

  return { data, blocked: false };
}

export function sanitizeLoginForm(raw: {
  email: string;
  password: string;
}): SanitizeResult<typeof raw> {
  const data = {
    email:    sanitizeEmail(raw.email),
    password: sanitizePassword(raw.password),
  };

  if (isSuspicious(data.email)) {
    return { data, blocked: true, reason: "Suspicious content in email" };
  }

  return { data, blocked: false };
}
