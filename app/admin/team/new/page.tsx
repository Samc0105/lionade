"use client";

/**
 * /admin/team/new — provision a new team member. ADMIN ONLY.
 *
 * Collects full name, desired mailbox local-part (username), personal email,
 * team role, and Lionade access level, then POSTs to /api/admin/team/provision.
 * The username field debounces a GET /api/admin/team/check-username call and
 * renders availability inline (green check when free, the server's reason when
 * not). On a 201 we route to the new member's detail page; 400/409/429/503 are
 * surfaced inline in the error banner.
 *
 * The temporary password and one-time login link live ONLY in the welcome
 * email the route sends to the personal address. They are never shown here.
 *
 * The layout hard-gates /admin to staff; this page self-gates to admins (the
 * provision route returns 403 to support staff anyway).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess } from "@/lib/toast";
import type { TeamMember, TeamRole, LionadeAccess } from "@/lib/team/types";
import { ArrowLeft, CheckCircle, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { CARD_BG } from "@/components/admin/shared";

// Assignable roles — `former_team` is a lifecycle outcome of offboarding, never
// something you provision someone INTO, so it is excluded from the picker.
const ASSIGNABLE_ROLES: { value: TeamRole; label: string }[] = [
  { value: "founder", label: "Founder" },
  { value: "engineer", label: "Engineer" },
  { value: "support", label: "Support" },
  { value: "contractor", label: "Contractor" },
  { value: "advisor", label: "Advisor" },
];

const ACCESS_OPTIONS: { value: LionadeAccess; label: string; help: string }[] = [
  { value: "none", label: "None", help: "Email mailbox only. No Lionade login is created." },
  { value: "viewer", label: "Viewer", help: "Lionade login with read access." },
  { value: "editor", label: "Editor", help: "Lionade login with edit access." },
  { value: "admin", label: "Admin", help: "Lionade login with full console access." },
];

const EMAIL_DOMAIN = "getlionade.com";

// UX-grade pre-check mirroring the server regex; the API is authoritative.
const USERNAME_RE = /^[a-z][a-z0-9.-]{2,30}$/;

type UsernameState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; reason: string };

const fieldCls =
  "w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40";
const labelCls =
  "block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1";

export default function ProvisionTeamMemberPage() {
  const router = useRouter();
  const { isAdmin } = useAdminRole();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("engineer");
  const [access, setAccess] = useState<LionadeAccess>("none");

  const [usernameState, setUsernameState] = useState<UsernameState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Debounced availability check. Normalises to lowercase first so the field
  // matches what the server stores. An empty / malformed value resets to idle.
  useEffect(() => {
    const candidate = username.trim().toLowerCase();
    if (candidate.length === 0) {
      setUsernameState({ kind: "idle" });
      return;
    }
    if (!USERNAME_RE.test(candidate)) {
      setUsernameState({
        kind: "taken",
        reason:
          "Must be 3 to 31 characters: start with a letter, then lowercase letters, numbers, dots, or hyphens.",
      });
      return;
    }
    let cancelled = false;
    setUsernameState({ kind: "checking" });
    const t = setTimeout(async () => {
      const res = await apiGet<{ available: boolean; reason?: string }>(
        `/api/admin/team/check-username?username=${encodeURIComponent(candidate)}`,
      );
      if (cancelled) return;
      if (res.ok && res.data?.available) {
        setUsernameState({ kind: "available" });
      } else if (res.ok && res.data) {
        setUsernameState({
          kind: "taken",
          reason: res.data.reason ?? "That username is not available.",
        });
      } else {
        setUsernameState({
          kind: "taken",
          reason: res.error ?? "Could not check that username.",
        });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        Provisioning team members is admin only.
      </div>
    );
  }

  const submit = async () => {
    setErrorMsg(null);
    const name = fullName.trim();
    const uname = username.trim().toLowerCase();
    const pemail = personalEmail.trim();

    if (name.length < 1) {
      setErrorMsg("Enter the team member's full name.");
      return;
    }
    if (!USERNAME_RE.test(uname)) {
      setErrorMsg(
        "Username must be 3 to 31 characters: start with a letter, then lowercase letters, numbers, dots, or hyphens.",
      );
      return;
    }
    if (usernameState.kind === "taken") {
      setErrorMsg(usernameState.reason);
      return;
    }
    if (!pemail.includes("@")) {
      setErrorMsg("Enter a valid personal email address.");
      return;
    }

    setBusy(true);
    const res = await apiPost<{ ok: boolean; teamMember: TeamMember }>(
      "/api/admin/team/provision",
      {
        full_name: name,
        username: uname,
        personal_email: pemail,
        role,
        lionade_access: access,
      },
    );
    setBusy(false);

    if (res.ok && res.data?.teamMember) {
      toastSuccess("Team member provisioned");
      router.push(`/admin/team/${res.data.teamMember.id}`);
    } else {
      setErrorMsg(res.error ?? "Provisioning failed. Please try again.");
    }
  };

  const accessHelp = ACCESS_OPTIONS.find((o) => o.value === access)?.help ?? "";

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/team"
        className="inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-cream/80 transition-colors mb-4"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to team
      </Link>

      <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">
        Provision team member
      </h1>
      <p className="text-sm text-cream/50 mb-6">
        Creates a real @getlionade.com forwarding mailbox and, if access is
        granted, a Lionade login. A temporary password and one-time setup link
        are emailed to the personal address. They are never shown here.
      </p>

      {errorMsg && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          {errorMsg}
        </div>
      )}

      <div
        className="rounded-2xl border border-white/[0.08] p-6 space-y-5"
        style={{ background: CARD_BG }}
      >
        {/* Full name */}
        <div>
          <label htmlFor="tm-fullname" className={labelCls}>
            Full name
          </label>
          <input
            id="tm-fullname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ada Lovelace"
            maxLength={120}
            className={fieldCls}
          />
        </div>

        {/* Username */}
        <div>
          <label htmlFor="tm-username" className={labelCls}>
            Mailbox username
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center rounded-xl bg-white/[0.05] border border-white/10 focus-within:border-gold/40 transition-colors">
              <input
                id="tm-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ada"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={31}
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-cream placeholder:text-cream/25 outline-none"
              />
              <span className="px-3 text-sm text-cream/40 font-mono select-none">
                @{EMAIL_DOMAIN}
              </span>
            </div>
          </div>
          {/* Inline availability feedback */}
          <div className="mt-1.5 min-h-[18px] text-xs flex items-center gap-1.5">
            {usernameState.kind === "checking" && (
              <span className="flex items-center gap-1.5 text-cream/45">
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 border-cream/20 border-t-cream/60 animate-spin"
                  aria-hidden="true"
                />
                Checking availability...
              </span>
            )}
            {usernameState.kind === "available" && (
              <span className="flex items-center gap-1.5 text-green-300">
                <CheckCircle size={14} weight="fill" aria-hidden="true" />
                Available
              </span>
            )}
            {usernameState.kind === "taken" && (
              <span className="flex items-center gap-1.5 text-amber-300">
                <XCircle size={14} weight="fill" aria-hidden="true" />
                {usernameState.reason}
              </span>
            )}
          </div>
        </div>

        {/* Personal email */}
        <div>
          <label htmlFor="tm-personal-email" className={labelCls}>
            Personal email
          </label>
          <input
            id="tm-personal-email"
            type="email"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
            placeholder="ada@personal.com"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={254}
            className={fieldCls}
          />
          <p className="mt-1 text-[11px] text-cream/35">
            Where the team mailbox forwards to, and where the welcome email with
            login details is delivered.
          </p>
        </div>

        {/* Role */}
        <div>
          <label htmlFor="tm-role" className={labelCls}>
            Role
          </label>
          <select
            id="tm-role"
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            className={`${fieldCls} [&>option]:bg-[#0a1020]`}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* Lionade access */}
        <div>
          <label htmlFor="tm-access" className={labelCls}>
            Lionade access
          </label>
          <select
            id="tm-access"
            value={access}
            onChange={(e) => setAccess(e.target.value as LionadeAccess)}
            className={`${fieldCls} [&>option]:bg-[#0a1020]`}
          >
            {ACCESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-cream/35">{accessHelp}</p>
        </div>

        <div className="flex gap-2 pt-1">
          <Link
            href="/admin/team"
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold text-center hover:bg-white/5 transition-all"
          >
            Cancel
          </Link>
          <button
            onClick={submit}
            disabled={busy || usernameState.kind === "checking"}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{
              background:
                "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
            }}
          >
            {busy ? "Provisioning..." : "Provision team member"}
          </button>
        </div>
      </div>
    </div>
  );
}
