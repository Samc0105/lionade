"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import useSWR from "swr";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";
import { avatarFor } from "@/lib/avatar";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { Medal, Diamond, DiamondsFour, Users, CheckCircle, Sword, Trophy, Megaphone, X as XIcon, BookOpen, Fire, Target, MedalMilitary, GameController, Coins, PushPinSimple, Crown, UserPlus, MagnifyingGlass } from "@phosphor-icons/react";
import { toastError, toastSuccess } from "@/lib/toast";
import CountUp from "@/components/CountUp";
import AnimatedUsername from "@/components/AnimatedUsername";
import EquippedFlair from "@/components/EquippedFlair";
import Avatar from "@/components/Avatar";
import { resolveRowUsernameEffect, resolveRowNameColor } from "@/lib/use-username-effect";
import PastLobbiesPanel from "@/components/social/PastLobbiesPanel";
import ReferralCard from "@/components/social/ReferralCard";

// ── Types ────────────────────────────────────────────────────

interface Friend {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  is_online: boolean;
  last_seen: string | null;
  unreadCount: number;
  // Shop V2 — optional. Server populates when /api/social/friends includes it.
  equipped_username_effect?: string | null;
  equipped_frame?: string | null;
  equipped_name_color?: string | null;
  equipped_avatar_aura?: string | null;
  flair?: string | null;
}

interface PendingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
  equipped_username_effect?: string | null;
  equipped_frame?: string | null;
  equipped_name_color?: string | null;
  equipped_avatar_aura?: string | null;
  flair?: string | null;
}

interface OutgoingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
  sentAt: string;
}

// Relationship between the searching user and a search result. Drives which
// action button renders in the Add-Friend search dropdown.
//   none     → "Add friend"  (sends a request)
//   incoming → "Accept"      (they sent ME a request — accept it)
//   outgoing → "Requested"   (I already sent them — disabled)
//   friends  → "Friends"     (already accepted — disabled)
type Relationship = "none" | "incoming" | "outgoing" | "friends";

interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  relationship: Relationship;
  friendshipId: string | null;
  flair?: string | null;
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

interface ArenaEvent {
  id: string;
  match_id: string;
  user1_id: string;
  user2_id: string;
  winner_id: string | null;
  player1_score: number;
  player2_score: number;
  wager: number;
  created_at: string;
}

interface FeedItem {
  id: string;
  friendId: string;
  friendUsername: string;
  friendAvatarUrl: string | null;
  flair?: string | null;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface CircleRank {
  userId: string;
  username: string;
  avatarUrl: string | null;
  flair?: string | null;
  coinsThisWeek: number;
  isMe: boolean;
}

// Icon + pin color per feed event type — drives both the rendered icon and
// the thumbtack tint on the post card.
const FEED_META: Record<string, { Icon: typeof BookOpen; pin: string; label: string }> = {
  quiz_reward:      { Icon: BookOpen,      pin: "#4A90D9", label: "quiz" },
  duel_win:         { Icon: Sword,         pin: "#EF4444", label: "duel" },
  streak_milestone: { Icon: Fire,          pin: "#F97316", label: "streak" },
  streak_bonus:     { Icon: Fire,          pin: "#F97316", label: "streak" },
  bounty_reward:    { Icon: Target,        pin: "#FFD700", label: "bounty" },
  badge_bonus:      { Icon: MedalMilitary, pin: "#A855F7", label: "badge" },
  game_reward:      { Icon: GameController, pin: "#22C55E", label: "game" },
};

// ── Helpers ──────────────────────────────────────────────────

const ELO_TIERS = [
  { name: "Bronze", min: 0, max: 1199, color: "#CD7F32", Icon: Medal },
  { name: "Silver", min: 1200, max: 1399, color: "#C0C0C0", Icon: Medal },
  { name: "Gold", min: 1400, max: 1599, color: "#FFD700", Icon: Medal },
  { name: "Platinum", min: 1600, max: 1799, color: "#00CED1", Icon: Diamond },
  { name: "Diamond", min: 1800, max: 9999, color: "#B9F2FF", Icon: DiamondsFour },
];

function getEloTier(elo: number) {
  return ELO_TIERS.find(t => elo >= t.min && elo <= t.max) ?? ELO_TIERS[0];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Selector for the tabbable controls inside a dialog. Disabled controls and
// elements pulled out of the tab order (tabindex=-1) are excluded so the trap
// only cycles real stops.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Modal focus management — used by the Nudge, Challenge, and Add-Friend
// dialogs. When `active` flips true it: (1) remembers the element that had
// focus (the triggering control), (2) optionally moves focus to the first
// interactive control inside the dialog, and (3) traps Tab / Shift+Tab so
// focus can't escape to the page behind the modal. When `active` flips false
// it restores focus to the triggering control. Escape handling stays in the
// existing per-modal effects.
function useDialogFocus(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  autoFocusFirst: boolean,
) {
  // Remember the trigger across the open lifetime without re-running the
  // open effect when it changes.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    triggerRef.current = document.activeElement as HTMLElement | null;

    if (autoFocusFirst) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      // Defer to next frame so the slide-up animation has mounted children.
      requestAnimationFrame(() => first?.focus());
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      // Focus sitting outside the dialog (or on the dialog itself) — pull it
      // back to the appropriate edge.
      if (!activeEl || !container.contains(activeEl)) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
        return;
      }
      if (e.shiftKey && activeEl === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger on close. Guard against a stale node
      // (e.g. the trigger unmounted) by checking it's still connected.
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected) trigger.focus();
      triggerRef.current = null;
    };
    // ref is a stable ref object; depend on the open flag + autofocus choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoFocusFirst]);
}

// ── Component ────────────────────────────────────────────────

export default function SocialPage() {
  const { user } = useAuth();
  const router = useRouter();
  // Pull stats so the navbar / dashboard SWR cache stays warm with this
  // user's profile — keeps the user pill in sync across pages.
  const { stats: userStats } = useUserStats(user?.id);

  // Friends
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRequest[]>([]);
  // Track whether friends data has been hydrated (cache or fetch) so the
  // hero pulse chips can render a soft placeholder instead of flashing "0".
  const [friendsHydrated, setFriendsHydrated] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  // Add-Friend popover (formerly inline in the left sidebar). Triggered by the
  // top-right UserPlus button so the sidebar isn't permanently consumed by it.
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  // Esc-key closes the Add-Friend modal (matches the pattern in ClockInButton).
  useEffect(() => {
    if (!showAddFriendModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAddFriendModal(false);
        setAddUsername("");
        setShowDropdown(false);
        setAddError("");
        setAddSuccess("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showAddFriendModal]);
  const [searchQuery, setSearchQuery] = useState("");
  type SocialTab = "friends" | "notifs" | "lobbies";
  const [activeTab, setActiveTab] = useState<SocialTab>("friends");
  const showNotifView = activeTab === "notifs";
  const showLobbiesView = activeTab === "lobbies";
  const setShowNotifView = (next: boolean) => setActiveTab(next ? "notifs" : "friends");
  // socialNotifs / socialUnreadCount / notifsHydrated are DERIVED from the
  // notifications SWR hook below (see `notifsData`) rather than mirrored into
  // useState via onSuccess. onSuccess doesn't fire when the mount revalidation
  // is deduped (global 60s dedupingInterval), which used to strand this panel
  // on skeletons for up to 60s after a quick back-nav.
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Messages — messages / arenaEvents / messagesLoadedFor are DERIVED from
  // the per-friend messages SWR hook below (see `messagesData`). Local state
  // mirrors were dropped: a deduped refetch (60s global dedupingInterval)
  // skips onSuccess, so switching threads A→C→A inside the window left
  // friend C's messages rendered in A's chat.
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);

  // Feed + circle leaderboard
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [circle, setCircle] = useState<CircleRank[]>([]);
  // Flipped when the sessionStorage seed restores a prior feed/circle snapshot
  // on a cold hard reload, so feedHydrated is true even before the first fetch.
  const [feedSeeded, setFeedSeeded] = useState(false);

  // Challenge modal
  const [challengeTarget, setChallengeTarget] = useState<Friend | null>(null);
  const [challengeWager, setChallengeWager] = useState(25);
  const [sendingChallenge, setSendingChallenge] = useState(false);

  // Nudges — sessionStorage-restored fallback for hard reloads where the SWR
  // cache is cold. The rendered `nudgeState` / `nudgeHydrated` are derived
  // below from the nudge SWR hook (cache wins), with this as the fallback,
  // so a deduped mount revalidation can't strand the pulse chip on its
  // placeholder.
  const [nudgeStateCached, setNudgeStateCached] = useState<{ remaining: number; limit: number; nudgedToday: string[] }>({
    remaining: 5, limit: 5, nudgedToday: [],
  });
  const [nudgeCacheSeeded, setNudgeCacheSeeded] = useState(false);
  const [nudgeTarget, setNudgeTarget] = useState<{ id: string; username: string } | null>(null);
  const [sendingNudge, setSendingNudge] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const msgInputRef = useRef<HTMLInputElement>(null);

  // Dialog containers — focus trap + focus restore (a11y). Each modal moves
  // focus to its first control on open, traps Tab while open, and restores
  // focus to its triggering control on close. Add-Friend keeps its own input
  // autoFocus, so the hook there only traps + restores (autoFocusFirst=false).
  const nudgeDialogRef = useRef<HTMLDivElement>(null);
  const challengeDialogRef = useRef<HTMLDivElement>(null);
  const addFriendDialogRef = useRef<HTMLDivElement>(null);

  // userStats is fetched purely so the navbar/dashboard SWR cache stays
  // hot. The social page itself doesn't currently render the viewer's own
  // avatar (chat shows friend's only).
  void userStats;

  // ── Hydrate visible lists from sessionStorage on mount ─────
  // Network fetches still run in the background, but the page renders
  // the previous-known data immediately so navigating away and back
  // doesn't visibly empty the friend list / feed / leaderboard.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = sessionStorage.getItem(`lionade_social_${user.id}`);
      if (!raw) return;
      const c = JSON.parse(raw) as {
        friends?: Friend[];
        pendingRequests?: PendingRequest[];
        outgoingRequests?: OutgoingRequest[];
        feed?: FeedItem[];
        circle?: CircleRank[];
        nudgeState?: typeof nudgeStateCached;
      };
      if (Array.isArray(c.friends)) { setFriends(c.friends); setFriendsHydrated(true); }
      if (Array.isArray(c.pendingRequests)) setPendingRequests(c.pendingRequests);
      if (Array.isArray(c.outgoingRequests)) setOutgoingRequests(c.outgoingRequests);
      if (Array.isArray(c.feed)) { setFeed(c.feed); setFeedSeeded(true); }
      if (Array.isArray(c.circle)) { setCircle(c.circle); setFeedSeeded(true); }
      if (c.nudgeState) { setNudgeStateCached(c.nudgeState); setNudgeCacheSeeded(true); }
    } catch { /* ignore — corrupt cache won't block fresh fetches */ }
  }, [user?.id]);

  const cacheSocial = useCallback((patch: Record<string, unknown>) => {
    if (!user?.id) return;
    try {
      const key = `lionade_social_${user.id}`;
      const prev = JSON.parse(sessionStorage.getItem(key) || "{}");
      sessionStorage.setItem(key, JSON.stringify({ ...prev, ...patch }));
    } catch { /* quota / private mode */ }
  }, [user?.id]);

  // ── Online heartbeat ───────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const setOnline = async () => {
      await supabase
        .from("profiles")
        .update({ is_online: true, last_seen: new Date().toISOString() })
        .eq("id", user.id);
    };

    setOnline();
    const heartbeat = setInterval(setOnline, 120000);

    const handleUnload = () => {
      navigator.sendBeacon?.(
        `/api/social/friends?offline=${user.id}`,
      );
      // Best-effort offline update
      supabase
        .from("profiles")
        .update({ is_online: false, last_seen: new Date().toISOString() })
        .eq("id", user.id);
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [user?.id]);

  // ── Load friends ───────────────────────────────────────────
  // Perf 2026-05-17: manual setInterval(10s) → SWR refreshInterval. The global
  // persistent <SWRConfig> caches the last friends payload so the panel is
  // instant on re-nav. `friends`/pending/outgoing stay useState because
  // friends is locally mutated (unread→0 on open, optimistic accept/remove);
  // SWR hydrates them via onSuccess and the pre-existing sessionStorage
  // (cacheSocial) restore path is left untouched. loadFriends is kept as a
  // mutate-backed revalidator so every imperative loadFriends() call site
  // (post-accept, focus, etc.) works unchanged.
  const { data: friendsData, mutate: mutateFriends } = useSWR(
    user?.id ? `social-friends/${user.id}` : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => apiGet<any>("/api/social/friends"),
    {
      // Poll dropped 10s → 5s as a safety net under the realtime invalidation
      // (the Navbar notifications channel revalidates this key on a friend
      // request/accept). revalidateOnMount forces a fresh fetch even when the
      // persistent SWR cache holds a stale "0 pending", so a request that
      // arrived while away can't be masked by a stale cache on re-entry.
      refreshInterval: 5000,
      revalidateOnMount: true,
      keepPreviousData: true,
    }
  );
  // Sync local mirrors from `friendsData` via effect, NOT onSuccess: a mount
  // revalidation inside the global 60s dedupingInterval is deduped (no fetch
  // → no onSuccess), which left the panel on skeletons after a quick back-nav
  // whenever the sessionStorage seed was missing. This effect also runs on
  // remount-with-cached-data, closing that hole. `friends` stays useState
  // because it's locally mutated (unread→0 on thread open, optimistic
  // accept/remove).
  useEffect(() => {
    if (friendsData?.ok && friendsData.data) {
      const friends = friendsData.data.friends ?? [];
      const pendingRequests = friendsData.data.pendingRequests ?? [];
      const outgoingRequests = friendsData.data.outgoingRequests ?? [];
      setFriends(friends);
      setPendingRequests(pendingRequests);
      setOutgoingRequests(outgoingRequests);
      setFriendsHydrated(true);
      cacheSocial({ friends, pendingRequests, outgoingRequests });
    }
  }, [friendsData, cacheSocial]);
  const loadFriends = useCallback(async () => {
    await mutateFriends();
  }, [mutateFriends]);

  // ── Load activity feed + circle leaderboard ───────────────
  // Perf 2026-05-17: manual setInterval(30s) → SWR refreshInterval (cached).
  // `feedData` is captured so feedHydrated can gate the feed/circle empty
  // states: without it the "board's empty" copy flashed before the first
  // fetch resolved (the flash-of-empty equivalent of flash-of-zero). The
  // sessionStorage seed below sets feedSeeded for cold hard reloads.
  const { data: feedData, mutate: mutateFeed } = useSWR(
    user?.id ? `social-feed/${user.id}` : null,
    () => apiGet<{ feed: FeedItem[]; circle: CircleRank[] }>("/api/social/feed"),
    {
      refreshInterval: 30000,
      keepPreviousData: true,
      onSuccess: (res) => {
        if (res.ok && res.data) {
          const feed = res.data.feed ?? [];
          const circle = res.data.circle ?? [];
          setFeed(feed);
          setCircle(circle);
          cacheSocial({ feed, circle });
        }
      },
    }
  );
  // True once the feed/circle payload exists in the SWR cache OR the
  // sessionStorage seed restored a prior snapshot. Empty states only render
  // after this flips true.
  const feedHydrated = feedData !== undefined || feedSeeded;
  const loadFeed = useCallback(async () => {
    await mutateFeed();
  }, [mutateFeed]);

  // ── Load nudge budget for the day ──────────────────────────
  // Perf 2026-05-17: manual setInterval(60s) → SWR refreshInterval (cached).
  const { data: nudgeData, mutate: mutateNudge } = useSWR(
    user?.id ? `social-nudge/${user.id}` : null,
    () => apiGet<{ remaining: number; limit: number; nudgedToday: string[] }>("/api/social/nudge"),
    {
      refreshInterval: 60000,
      keepPreviousData: true,
      onSuccess: (res) => {
        // sessionStorage write-through only — the displayed state is derived
        // from `nudgeData` below, because deduped mount revalidations skip
        // onSuccess entirely.
        if (res.ok && res.data) cacheSocial({ nudgeState: res.data });
      },
    }
  );
  // Cache-first derivation (same dedupe-window fix as notifs/messages): the
  // SWR cache wins; the sessionStorage restore covers cold hard reloads.
  const nudgeState = nudgeData?.ok && nudgeData.data ? nudgeData.data : nudgeStateCached;
  const nudgeHydrated = nudgeData !== undefined || nudgeCacheSeeded;
  const loadNudgeBudget = useCallback(async () => {
    await mutateNudge();
  }, [mutateNudge]);

  // ── Send nudge ─────────────────────────────────────────────
  const sendNudge = useCallback(async (preset: string) => {
    if (!nudgeTarget || sendingNudge) return;
    setSendingNudge(true);
    const res = await apiPost<{ ok: boolean; remaining: number }>("/api/social/nudge", {
      recipientId: nudgeTarget.id,
      preset,
    });
    setSendingNudge(false);
    if (res.ok) {
      toastSuccess(`Nudge sent to ${nudgeTarget.username}`);
      setNudgeTarget(null);
      loadNudgeBudget();
    } else {
      console.error("[social:nudge] failed", res.error);
      toastError("Couldn't send nudge. Try again.");
    }
  }, [nudgeTarget, sendingNudge, loadNudgeBudget]);

  // ── Send direct arena challenge ────────────────────────────
  const sendChallenge = useCallback(async () => {
    if (!challengeTarget || sendingChallenge) return;
    setSendingChallenge(true);
    const res = await apiPost<{ challengeId?: string }>("/api/arena/challenge", {
      challengedUsername: challengeTarget.username,
      wager: challengeWager,
    });
    setSendingChallenge(false);
    if (res.ok) {
      toastSuccess(`Challenge sent to ${challengeTarget.username}`);
      setChallengeTarget(null);
    } else {
      console.error("[social:challenge] failed", res.error);
      toastError("Couldn't send challenge. Try again.");
    }
  }, [challengeTarget, challengeWager, sendingChallenge]);

  // Esc closes the nudge / challenge modals (matches the Add-Friend modal).
  // Guarded by the in-flight flags so a mid-send keypress can't dismiss the
  // sheet while the request resolves.
  useEffect(() => {
    if (!nudgeTarget && !challengeTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (nudgeTarget && !sendingNudge) setNudgeTarget(null);
      if (challengeTarget && !sendingChallenge) setChallengeTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nudgeTarget, challengeTarget, sendingNudge, sendingChallenge]);

  // ── Load notifications for social panel ─────────────────────
  // Perf 2026-05-17: manual setInterval(15s) → SWR refreshInterval (cached).
  // Perf 2026-05-25 (Phase A): SWR key changed `social-notifs/${user.id}` →
  // `notifications/${user.id}` so this hook SHARES THE CACHE with the
  // Navbar's notifications poll (also keyed on `notifications/${user.id}`).
  // Previously each page ran its own 15s poll on the same endpoint —
  // doubling API hits. With a shared key both pages see the same data and
  // the Navbar's realtime INSERT channel invalidates this hook too.
  // socialNotifs/unreadCount/notifsHydrated are derived from `notifsData`
  // (the SWR cache) — see the dedupe-window note at the state block above.
  // loadSocialNotifs kept as a mutate-backed revalidator (called imperatively
  // when the notif view opens).
  const { data: notifsData, mutate: mutateSocialNotifs } = useSWR(
    user?.id ? `notifications/${user.id}` : null,
    () =>
      apiGet<{
        notifications: { id: string; type: string; title: string; message: string | null; read: boolean; action_url: string | null; created_at: string }[];
        unreadCount: number;
      }>("/api/notifications"),
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  const notifsHydrated = notifsData !== undefined;
  const socialNotifs = useMemo(
    () => (notifsData?.ok && notifsData.data ? notifsData.data.notifications ?? [] : []),
    [notifsData],
  );
  const socialUnreadCount =
    notifsData?.ok && notifsData.data ? notifsData.data.unreadCount ?? 0 : null;
  const loadSocialNotifs = useCallback(async () => {
    await mutateSocialNotifs();
  }, [mutateSocialNotifs]);

  // ── Load conversation ──────────────────────────────────────
  // Perf 2026-05-17: manual useEffect fetch → SWR keyed on the selected
  // friend, so re-opening a recent conversation is instant from the global
  // persistent cache. The thread timeline is DERIVED from `messagesData`
  // (keyed per friend) — never local state — so a deduped refetch on friend
  // switch can't leave another thread's messages on screen. The original
  // side-effect — clearing that friend's unread badge on open — is preserved
  // in onSuccess. loadMessages kept as a mutate-backed revalidator with the
  // same (friendId) signature so any imperative call site is unchanged.
  const { data: messagesData, mutate: mutateMessages } = useSWR(
    user?.id && selectedFriend
      ? `social-messages/${user.id}/${selectedFriend.id}`
      : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => apiGet<any>(`/api/social/messages?friendId=${selectedFriend!.id}`),
    {
      // Override the global keepPreviousData for this hook: the key changes
      // per friend, and keeping friend A's payload visible under friend B's
      // key is exactly the cross-thread bleed this derivation must prevent.
      // On switch, data resets to undefined (skeleton) until B's payload is
      // in cache — instant if B was opened before, one fetch otherwise.
      keepPreviousData: false,
      onSuccess: (res) => {
        if (res.ok && res.data) {
          const fid = selectedFriend?.id;
          if (fid) {
            setFriends(prev =>
              prev.map(f => (f.id === fid ? { ...f, unreadCount: 0 } : f))
            );
          }
        }
      },
    }
  );
  const messages = useMemo<Message[]>(
    () => (messagesData?.ok && messagesData.data ? messagesData.data.messages ?? [] : []),
    [messagesData],
  );
  const arenaEvents = useMemo<ArenaEvent[]>(
    () => (messagesData?.ok && messagesData.data ? messagesData.data.arenaEvents ?? [] : []),
    [messagesData],
  );
  // Gates the "Say hi" empty state: only hydrated once THIS friend's payload
  // exists in the cache (data is undefined across a key change because
  // keepPreviousData is off here).
  const messagesLoadedFor = selectedFriend && messagesData !== undefined ? selectedFriend.id : null;
  const loadMessages = useCallback(
    async (_friendId: string) => {
      await mutateMessages();
    },
    [mutateMessages]
  );
  // Append a message to the current thread's SWR cache. Replaces the old
  // setMessages local append — the timeline is cache-derived now, so realtime
  // and optimistic sends write through to the keyed cache (no revalidate).
  const appendMessage = useCallback((newMsg: Message) => {
    mutateMessages(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prev: any) =>
        prev?.ok && prev.data
          ? { ...prev, data: { ...prev.data, messages: [...(prev.data.messages ?? []), newMsg] } }
          : prev,
      { revalidate: false },
    );
  }, [mutateMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus management — when a thread is opened, move keyboard focus into the
  // message input so a keyboard user lands ready to type. Keyed on the friend
  // id so it re-focuses on every thread switch, not on each new message.
  useEffect(() => {
    if (selectedFriend?.id) msgInputRef.current?.focus();
  }, [selectedFriend?.id]);

  // ── Realtime messages ──────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !selectedFriend) return;

    const channel = supabase
      .channel(`social-chat-${user.id}-${selectedFriend.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${user.id}`,
      }, (payload: any) => {
        const newMsg = payload.new as Message;
        if (newMsg.sender_id === selectedFriend.id) {
          appendMessage(newMsg);
          // Mark as read
          supabase.from("messages").update({ read: true }).eq("id", newMsg.id);
        }
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id, selectedFriend?.id, appendMessage]);

  // ── Send message ───────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!user?.id || !selectedFriend || !msgInput.trim() || sending) return;
    setSending(true);

    const res = await apiPost<{ message: Message }>("/api/social/messages", {
      receiverId: selectedFriend.id,
      content: msgInput.trim(),
    });
    if (res.ok && res.data?.message) {
      appendMessage(res.data.message);
      setMsgInput("");
    } else {
      console.error("[social:message] failed", res.error);
      toastError("Couldn't send message. Try again.");
    }
    setSending(false);
  }, [user?.id, selectedFriend, msgInput, sending, appendMessage]);

  // ── Debounced search for add friend autocomplete ────────────
  const handleAddUsernameChange = useCallback((value: string) => {
    setAddUsername(value);
    setAddError("");
    setAddSuccess("");

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setShowDropdown(true);

    searchTimerRef.current = setTimeout(async () => {
      const res = await apiGet<{ users: SearchResult[] }>(
        `/api/social/search?q=${encodeURIComponent(value.trim())}`,
      );
      setSearchResults(res.ok && res.data ? res.data.users ?? [] : []);
      setSearchLoading(false);
    }, 300);
  }, [user?.id]);

  // Send a friend request to a `none`-relationship search result.
  const sendRequestTo = useCallback(async (username: string) => {
    if (!user?.id) return;
    setAddError("");
    setAddSuccess("");
    const res = await apiPost("/api/social/friends", { friendUsername: username });
    if (!res.ok) {
      setAddError(res.error ?? "Failed to send request");
      return;
    }
    setAddSuccess(`Request sent to ${username}!`);
    // Reflect the new state immediately in the dropdown (none → outgoing).
    setSearchResults(prev =>
      prev.map(u => (u.username === username ? { ...u, relationship: "outgoing" } : u)),
    );
    loadFriends();
    setTimeout(() => setAddSuccess(""), 3000);
  }, [user?.id, loadFriends]);

  // Accept an incoming request surfaced in a search result — same action as
  // the pending-requests list. This is the key Bug-2 fix: searching for
  // someone who sent you a request now lets you accept right there.
  const acceptFromSearch = useCallback(async (result: SearchResult) => {
    if (!user?.id || !result.friendshipId) return;
    setAddError("");
    setAddSuccess("");
    const res = await apiPatch("/api/social/friends", {
      friendshipId: result.friendshipId,
      action: "accept",
    });
    if (!res.ok) {
      setAddError(res.error ?? "Failed to accept request");
      return;
    }
    setAddSuccess(`You and ${result.username} are now friends!`);
    setSearchResults(prev =>
      prev.map(u => (u.id === result.id ? { ...u, relationship: "friends" } : u)),
    );
    loadFriends();
    setTimeout(() => setAddSuccess(""), 3000);
  }, [user?.id, loadFriends]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Add friend ─────────────────────────────────────────────
  const addFriend = useCallback(async () => {
    if (!user?.id || !addUsername.trim()) return;
    setAddError("");
    setAddSuccess("");

    const res = await apiPost("/api/social/friends", {
      friendUsername: addUsername.trim(),
    });
    if (!res.ok) {
      setAddError(res.error ?? "Failed to send request");
    } else {
      setAddSuccess(`Request sent to ${addUsername}!`);
      setAddUsername("");
      setTimeout(() => setAddSuccess(""), 3000);
    }
  }, [user?.id, addUsername]);

  // ── Accept / Decline ───────────────────────────────────────
  const handleRequest = useCallback(async (friendshipId: string, action: "accept" | "decline") => {
    if (!user?.id) return;
    await apiPatch("/api/social/friends", { friendshipId, action });
    loadFriends();
  }, [user?.id, loadFriends]);

  // ── Cancel outgoing request ───────────────────────────
  const cancelRequest = useCallback(async (friendshipId: string) => {
    if (!user?.id) return;
    await apiDelete(`/api/social/friends?id=${friendshipId}`);
    setOutgoingRequests(prev => prev.filter(r => r.friendshipId !== friendshipId));
  }, [user?.id]);

  // ── Merge messages + arena events for timeline ─────────────
  const timeline = useMemo(() => {
    const items: { type: "message" | "arena"; data: Message | ArenaEvent; time: string }[] = [];
    for (const m of messages) items.push({ type: "message", data: m, time: m.created_at });
    for (const e of arenaEvents) items.push({ type: "arena", data: e, time: e.created_at });
    items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return items;
  }, [messages, arenaEvents]);

  // Filtered + sorted friends. Online friends bubble to the top so the
  // panel reads as "who's around right now" first, then recency by
  // last_seen so the next-most-active are next.
  const filteredFriends = useMemo(() => {
    const base = searchQuery
      ? friends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))
      : friends.slice();
    return base.sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      const aT = a.last_seen ? new Date(a.last_seen).getTime() : 0;
      const bT = b.last_seen ? new Date(b.last_seen).getTime() : 0;
      return bT - aT;
    });
  }, [friends, searchQuery]);

  // ── Derived circle metrics (for hero strip + showdown + squad goal) ───────
  const onlineCount = friends.filter(f => f.is_online).length;

  const myRank = useMemo(() => {
    const idx = circle.findIndex(c => c.isMe);
    return idx >= 0 ? idx + 1 : null;
  }, [circle]);

  const myWeekly = useMemo(() => {
    return circle.find(c => c.isMe)?.coinsThisWeek ?? 0;
  }, [circle]);

  // Showdown rival — the circle member closest to you in Fangs-this-week
  // (excluding yourself). Null when you have no friends in the circle yet.
  const rival = useMemo(() => {
    const others = circle.filter(c => !c.isMe);
    if (others.length === 0) return null;
    return others.reduce((best, c) =>
      Math.abs(c.coinsThisWeek - myWeekly) < Math.abs(best.coinsThisWeek - myWeekly) ? c : best
    , others[0]);
  }, [circle, myWeekly]);

  // Squad goal — simple collective target that scales with circle size
  const squadTarget = Math.max(200, circle.length * 80);
  const squadProgress = circle.reduce((s, c) => s + c.coinsThisWeek, 0);
  const squadPct = Math.min(100, (squadProgress / squadTarget) * 100);

  // ── Dialog focus management ────────────────────────────────
  // Nudge + Challenge auto-focus their first control; Add-Friend keeps its
  // own input autoFocus (so we don't double-focus / fight it) and only traps
  // + restores. All three restore focus to the trigger on close.
  useDialogFocus(nudgeDialogRef, !!nudgeTarget, true);
  useDialogFocus(challengeDialogRef, !!challengeTarget, true);
  useDialogFocus(addFriendDialogRef, showAddFriendModal, false);

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <ProtectedRoute>
      <FeatureGate feature="social">
      <div data-force-dark className="relative min-h-screen pt-16 pb-0 overflow-hidden" style={{ isolation: "isolate" }}>
        <div className="relative z-10 h-[calc(100vh-64px)] flex max-w-7xl mx-auto">

          {/* ═══ LEFT PANEL — Friends List ═══ */}
          <div className={`flex-shrink-0 flex flex-col border-r border-white/[0.06] sm:w-[320px] sm:flex ${selectedFriend ? "hidden" : "w-full"}`}>

            {/* Friends search + Add-friend trigger (top-right, opens modal) */}
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <label htmlFor="social-friend-search" className="sr-only">Search friends</label>
              <input
                id="social-friend-search"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="flex-1 min-w-0 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/55 focus:outline-none focus:border-electric/40 focus-visible:ring-2 focus-visible:ring-electric/30 transition"
              />
              <button
                type="button"
                onClick={() => setShowAddFriendModal(true)}
                aria-label="Add friend"
                title="Add friend"
                className="flex-shrink-0 w-10 h-10 rounded-lg inline-flex items-center justify-center transition-all hover:scale-105 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04080F]"
                style={{
                  background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                  color: "#04080F",
                }}
              >
                <UserPlus size={18} weight="bold" aria-hidden="true" />
              </button>
            </div>

            {/* Tab toggle: Friends / Lobbies / Notifications */}
            <div className="flex border-b border-white/[0.06]" role="tablist" aria-label="Social sections">
              <button
                role="tab"
                aria-selected={activeTab === "friends"}
                onClick={() => setActiveTab("friends")}
                className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/60 ${activeTab === "friends" ? "text-cream border-b-2 border-electric" : "text-cream/55 hover:text-cream"}`}
              >
                Friends
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "lobbies"}
                onClick={() => setActiveTab("lobbies")}
                className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/60 ${activeTab === "lobbies" ? "text-cream border-b-2 border-electric" : "text-cream/55 hover:text-cream"}`}
              >
                Lobbies
              </button>
              <button
                role="tab"
                aria-selected={activeTab === "notifs"}
                onClick={() => { setActiveTab("notifs"); loadSocialNotifs(); }}
                className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold uppercase tracking-wider transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/60 ${activeTab === "notifs" ? "text-cream border-b-2 border-electric" : "text-cream/55 hover:text-cream"}`}
              >
                Notifs
                {(socialUnreadCount ?? 0) > 0 && (
                  <span
                    className="absolute top-1.5 ml-1 min-w-[16px] h-4 rounded-full inline-flex items-center justify-center px-1 text-[9px] font-bold"
                    style={{ background: "#EF4444", color: "#fff" }}
                    aria-label={`${socialUnreadCount} unread notifications`}
                  >
                    {socialUnreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* Notifications Panel */}
            {showNotifView ? (
              <FeatureGate feature="social.notifications" compact>
              <div className="flex-1 overflow-y-auto">
                {!notifsHydrated ? (
                  /* Fetch hasn't resolved yet — skeleton, never the empty copy */
                  <div className="px-4 py-4 space-y-2" aria-hidden="true">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="h-12 rounded-lg bg-white/[0.05] animate-pulse" />
                    ))}
                  </div>
                ) : socialNotifs.length === 0 ? (
                  <div className="py-12 px-6 text-center flex flex-col items-center gap-2.5">
                    <CheckCircle size={28} weight="fill" className="text-electric/60" aria-hidden="true" />
                    <p className="text-cream/70 text-sm font-semibold">You're all caught up</p>
                    <p className="text-cream/55 text-xs">New activity from friends shows up here.</p>
                  </div>
                ) : (
                  socialNotifs.map(n => (
                    <button
                      key={n.id}
                      onClick={() => {
                        if (n.action_url) {
                          router.push(n.action_url);
                        }
                      }}
                      aria-label={`${n.read ? "" : "Unread. "}${n.title}`}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/50 transition-colors"
                      style={!n.read ? { borderLeft: "2px solid #FFD700" } : { borderLeft: "2px solid transparent" }}
                    >
                      <span className="flex-shrink-0 mt-0.5 text-cream">
                        {(() => {
                          const map = { friend_request: Users, friend_accepted: CheckCircle, arena_challenge: Sword, arena_result: Trophy, rank_up: Medal };
                          const NIcon = map[n.type as keyof typeof map] ?? Megaphone;
                          return <NIcon size={18} weight="fill" aria-hidden="true" />;
                        })()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${n.read ? "text-cream/50" : "text-cream"}`}>
                          {n.title}
                        </p>
                        {n.message && <p className="text-[10px] text-cream/55 mt-0.5 truncate">{n.message}</p>}
                        <p className="text-[9px] text-cream/55 mt-1">
                          {(() => {
                            const diff = Date.now() - new Date(n.created_at).getTime();
                            const mins = Math.floor(diff / 60000);
                            if (mins < 1) return "Just now";
                            if (mins < 60) return `${mins}m ago`;
                            const hrs = Math.floor(mins / 60);
                            if (hrs < 24) return `${hrs}h ago`;
                            return `${Math.floor(hrs / 24)}d ago`;
                          })()}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              </FeatureGate>
            ) : showLobbiesView ? (
              <FeatureGate feature="social.lobbies" compact>
                <PastLobbiesPanel router={router} />
              </FeatureGate>
            ) : (
            <FeatureGate feature="social.friend_list" compact>
            <>
            {/* Referral growth loop — share code / link to earn Fangs. Self-hides
                when the referral migration isn't applied. */}
            <ReferralCard />

            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-cream/60 text-[10px] font-bold uppercase tracking-widest mb-2">
                  Pending Requests ({pendingRequests.length})
                </p>
                <div className="space-y-2">
                  {pendingRequests.map(req => {
                    const tier = getEloTier(req.arena_elo);
                    return (
                      <div key={req.friendshipId} className="flex items-center gap-3 p-2 rounded-lg"
                        aria-label={`Friend request from ${req.username}`}
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <Avatar url={avatarFor(req.username, req.avatar_url)} alt={req.username} size="sm" frame={req.equipped_frame} aura={req.equipped_avatar_aura} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-cream text-xs font-semibold truncate">
                              <AnimatedUsername username={req.username} effect={resolveRowUsernameEffect(req.equipped_username_effect)} nameColor={resolveRowNameColor(req.equipped_name_color)} size="sm" />
                            </span>
                            <EquippedFlair flair={req.flair} compact />
                          </div>
                          <p className="text-[10px] inline-flex items-center gap-1" style={{ color: tier.color }}>
                            <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                            {tier.name}
                          </p>
                        </div>
                        <button onClick={() => handleRequest(req.friendshipId, "accept")}
                          aria-label={`Accept friend request from ${req.username}`}
                          className="text-green-400 text-[10px] font-bold px-2 py-1 rounded bg-green-400/10 hover:bg-green-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 transition">
                          Accept
                        </button>
                        <button onClick={() => handleRequest(req.friendshipId, "decline")}
                          aria-label={`Decline friend request from ${req.username}`}
                          className="text-cream/55 w-7 h-7 grid place-items-center rounded hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition">
                          <XIcon size={12} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sent Requests moved to the Add-Friend modal (top-right UserPlus button). */}

            {/* Friends List */}
            <div className="flex-1 overflow-y-auto">
              {/* Initial fetch in flight (no cache restore yet) — skeleton rows,
                  never the "Build your circle" empty copy. */}
              {!friendsHydrated && filteredFriends.length === 0 && (
                <div aria-hidden="true">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full bg-white/[0.06] animate-pulse flex-shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse" />
                        <div className="h-2.5 w-16 rounded bg-white/[0.04] animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {friendsHydrated && filteredFriends.length === 0 && (
                <div className="px-4 py-12 text-center flex flex-col items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full grid place-items-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,215,0,0.14) 0%, rgba(184,150,12,0.06) 100%)",
                      border: "1px solid rgba(255,215,0,0.22)",
                    }}
                  >
                    <Users size={20} weight="fill" className="text-gold/80" aria-hidden="true" />
                  </div>
                  {searchQuery ? (
                    <p className="text-cream/55 text-sm">No friends match {`"${searchQuery}"`}</p>
                  ) : (
                    <>
                      <p className="text-cream/80 text-sm font-semibold">Build your circle</p>
                      <p className="font-serif italic text-cream/55 text-xs max-w-[200px]">
                        tap the gold + up top to find someone by username
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAddFriendModal(true)}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-transform hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04080F]"
                        style={{
                          background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                          color: "#04080F",
                        }}
                      >
                        <UserPlus size={12} weight="bold" aria-hidden="true" />
                        Find friends
                      </button>
                    </>
                  )}
                </div>
              )}
              {filteredFriends.map(friend => {
                const tier = getEloTier(friend.arena_elo);
                const isSelected = selectedFriend?.id === friend.id;
                return (
                  <button
                    key={friend.id}
                    onClick={() => setSelectedFriend(friend)}
                    aria-label={`Open chat with ${friend.username}${friend.is_online ? ", online now" : ""}${friend.unreadCount > 0 ? `, ${friend.unreadCount} unread` : ""}`}
                    className="social-friend-row w-full text-left px-4 py-3 flex items-center gap-3 will-change-transform hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric/50"
                    style={isSelected ? {
                      background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(74,144,217,0.03) 100%)",
                      borderLeft: "2px solid #4A90D9",
                    } : { borderLeft: "2px solid transparent" }}
                  >
                    {/* Avatar in tinted circular chip — green ring when online, neutral otherwise. */}
                    <div
                      className="relative flex-shrink-0 grid place-items-center w-11 h-11 rounded-full"
                      style={{
                        background: friend.is_online
                          ? "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.06) 100%)"
                          : "rgba(255,255,255,0.04)",
                        border: friend.is_online
                          ? "1px solid rgba(34,197,94,0.35)"
                          : "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <Avatar url={avatarFor(friend.username, friend.avatar_url)} alt={friend.username} size="xs" frame={friend.equipped_frame} aura={friend.equipped_avatar_aura} />
                      {friend.is_online && (
                        <div className="absolute bottom-0 right-0 z-10 w-3 h-3 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-cream text-sm font-semibold truncate">
                          <AnimatedUsername username={friend.username} effect={resolveRowUsernameEffect(friend.equipped_username_effect)} nameColor={resolveRowNameColor(friend.equipped_name_color)} size="sm" />
                        </span>
                        <EquippedFlair flair={friend.flair} compact />
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{
                          color: tier.color,
                          background: `${tier.color}15`,
                        }}>
                          <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                          {tier.name}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] mt-0.5 text-cream/55 truncate">
                        {friend.is_online ? (
                          <span className="text-green-400/80">Online now</span>
                        ) : (
                          timeAgo(friend.last_seen)
                        )}
                      </p>
                    </div>

                    {/* Unread badge (count already in the row's aria-label) */}
                    {friend.unreadCount > 0 && (
                      <div className="flex-shrink-0 min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5 font-bold text-[10px]"
                        aria-hidden="true"
                        style={{
                          background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                          color: "#04080F",
                        }}>
                        {friend.unreadCount}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            </>
            </FeatureGate>
            )}
          </div>

          {/* ═══ RIGHT PANEL — Chat ═══ */}
          <div className="flex-1 flex flex-col min-w-0"
            style={!selectedFriend ? {} : undefined}
          >
            {!selectedFriend ? (
              /* ═══ Bulletin board — Activity Feed + Circle leaderboard ═══ */
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-5 sm:px-8 py-8">

                  {/* ═══ Circle Pulse — 4 live-stat chips replace the old hero ═══ */}
                  <FeatureGate feature="social.circle_pulse" compact>
                  <header className="mb-8">
                    <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/55 mb-3">
                      circle pulse &nbsp;&middot;&nbsp; {new Date().toLocaleDateString(undefined, { weekday: "long" }).toLowerCase()}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        {
                          label: "online now",
                          value: friendsHydrated
                            ? <CountUp id="social-online" value={onlineCount} duration={400} />
                            : <span className="text-cream/30">—</span>,
                          accent: "#22C55E",
                          pulse: friendsHydrated && onlineCount > 0,
                        },
                        {
                          label: "requests",
                          value: friendsHydrated
                            ? <CountUp id="social-requests" value={pendingRequests.length} duration={400} />
                            : <span className="text-cream/30">—</span>,
                          accent: pendingRequests.length > 0 ? "#FFD700" : "#71717A",
                        },
                        {
                          label: "your rank",
                          value: myRank ? <>#<CountUp id="social-rank" value={myRank} duration={400} /></> : <span className="text-cream/30">—</span>,
                          accent: "#4A90D9",
                        },
                        {
                          label: "nudges left",
                          value: nudgeHydrated
                            ? <><CountUp id="social-nudges-left" value={nudgeState.remaining} duration={300} /><span className="text-cream/55">/{nudgeState.limit}</span></>
                            : <span className="text-cream/30">—</span>,
                          accent: nudgeHydrated && nudgeState.remaining > 0 ? "#F97316" : "#71717A",
                        },
                      ].map(chip => (
                        <div
                          key={chip.label}
                          className="rounded-[6px] px-4 py-3 relative"
                          style={{
                            background: `linear-gradient(135deg, ${chip.accent}12 0%, rgba(255,255,255,0.02) 100%)`,
                            border: `1px solid ${chip.accent}28`,
                          }}
                        >
                          {chip.pulse && (
                            <span
                              className="absolute top-3 right-3 w-2 h-2 rounded-full social-studying-dot"
                              style={{ background: chip.accent }}
                              aria-hidden="true"
                            />
                          )}
                          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55">
                            {chip.label}
                          </p>
                          <p className="font-bebas text-2xl tabular-nums mt-0.5" style={{ color: chip.accent }}>
                            {chip.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </header>
                  </FeatureGate>

                  {/* ═══ Weekly Showdown — auto-picked rival ═══ */}
                  <FeatureGate feature="social.showdown" compact>
                  {rival && (
                    <section
                      className="mb-8 rounded-[8px] p-5 relative overflow-hidden"
                      style={{
                        background: "linear-gradient(90deg, rgba(239, 68, 68, 0.10) 0%, rgba(12, 16, 32, 0.95) 45%, rgba(74, 144, 217, 0.10) 100%)",
                        border: "1px solid rgba(239, 68, 68, 0.22)",
                      }}
                    >
                      <div className="flex items-baseline justify-between mb-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/60">
                          this week&rsquo;s showdown
                        </p>
                        <p className="font-mono text-[10px] text-cream/55">ends friday 23:59 UTC</p>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        {/* YOU */}
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-cream/70 text-xs font-mono uppercase tracking-wider mb-0.5">you</p>
                          <p className="font-bebas text-3xl text-red-400 tabular-nums leading-none">
                            <CountUp id="social-myweekly" value={myWeekly} duration={500} />
                            <span className="text-cream/55 text-sm ml-1.5">Fangs</span>
                          </p>
                        </div>

                        <Sword size={22} weight="fill" color="rgba(255,215,0,0.7)" aria-hidden="true" />

                        {/* RIVAL */}
                        <div className="flex-1 text-right min-w-0">
                          <p className="text-cream/70 text-xs font-mono uppercase tracking-wider mb-0.5 truncate">
                            {rival.username}
                          </p>
                          <p className="font-bebas text-3xl text-electric tabular-nums leading-none">
                            {rival.coinsThisWeek}
                            <span className="text-cream/55 text-sm ml-1.5">Fangs</span>
                          </p>
                        </div>
                      </div>

                      {/* Head-to-head bar */}
                      <div className="mt-4 relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255, 255, 255, 0.06)" }}>
                        {(() => {
                          const total = Math.max(1, myWeekly + rival.coinsThisWeek);
                          const myPct = (myWeekly / total) * 100;
                          return (
                            <div
                              className="absolute top-0 left-0 h-full"
                              style={{
                                width: `${myPct}%`,
                                background: "linear-gradient(90deg, #EF4444 0%, #F97316 100%)",
                                transition: "width 800ms var(--ease-out-emil)",
                              }}
                            />
                          );
                        })()}
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <p className="text-red-400/80 text-[10px] font-mono">
                          {myWeekly > rival.coinsThisWeek
                            ? `+${myWeekly - rival.coinsThisWeek} ahead`
                            : myWeekly < rival.coinsThisWeek
                            ? `${rival.coinsThisWeek - myWeekly} behind`
                            : "tied"}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const friend = friends.find(f => f.id === rival.userId);
                            if (friend) { setChallengeTarget(friend); setChallengeWager(25); }
                          }}
                          disabled={!friends.find(f => f.id === rival.userId)}
                          aria-label={`Challenge ${rival.username} to an arena match`}
                          className="font-mono text-[10px] uppercase tracking-[0.25em] text-electric hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 rounded px-1 py-0.5 transition-colors disabled:opacity-30"
                        >
                          challenge now →
                        </button>
                      </div>
                    </section>
                  )}
                  </FeatureGate>

                  {/* ═══ Squad Goal — collective weekly target ═══ */}
                  <FeatureGate feature="social.squad_goal" compact>
                  {circle.length > 0 && (
                    <section className="mb-10">
                      <div className="flex items-baseline justify-between mb-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/60">
                          squad goal &middot; {circle.length} member{circle.length === 1 ? "" : "s"}
                        </p>
                        <p className="font-bebas text-cream/70 text-sm tabular-nums">
                          <CountUp id="social-squad-progress" value={squadProgress} duration={500} />
                          <span className="text-cream/55 text-xs"> / {squadTarget}</span>
                        </p>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: "rgba(255, 255, 255, 0.04)" }}>
                        <div
                          className={`h-full ${squadPct > 0 && squadPct < 100 ? "progress-shimmer" : ""}`}
                          style={{
                            width: `${squadPct}%`,
                            background: squadPct >= 100
                              ? "linear-gradient(90deg, #22C55E 0%, #FFD700 100%)"
                              : "linear-gradient(90deg, #4A90D9 0%, #A855F7 100%)",
                            transition: "width 900ms var(--ease-out-emil)",
                          }}
                        />
                      </div>
                      <p className="mt-2 font-serif italic text-cream/55 text-xs">
                        {squadPct >= 100
                          ? "goal crushed. circle unlocked a 50 Fang bonus."
                          : `${Math.round(squadPct)}% there · every quiz counts toward the circle total`}
                      </p>
                    </section>
                  )}
                  </FeatureGate>

                  {/* Circle weekly leaderboard — polaroids */}
                  {circle.length > 0 && (
                    <section className="mb-10">
                      <div className="flex items-baseline justify-between mb-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60">this week · Fangs</p>
                        <p className="text-cream/25 text-[10px] italic font-serif">top 5</p>
                      </div>
                      <div className="flex gap-4 overflow-x-auto pb-4">
                        {circle.slice(0, 5).map((c, i) => {
                          const tilts = ["-2deg", "1.5deg", "-1deg", "2deg", "-1.5deg"];
                          const friendObj = friends.find(f => f.id === c.userId);
                          const alreadyNudged = nudgeState.nudgedToday.includes(c.userId);
                          const canNudge = !c.isMe && friendObj && !alreadyNudged && nudgeState.remaining > 0;
                          return (
                            <div
                              key={c.userId}
                              className="flex-shrink-0 w-[110px] flex flex-col items-center gap-2"
                            >
                              <div
                                className="social-polaroid w-[110px] text-center"
                                aria-label={`${c.isMe ? "you" : c.username} on the circle leaderboard`}
                                style={{ "--polaroid-tilt": tilts[i] } as React.CSSProperties}
                              >
                                <div className="relative w-[102px] h-[102px] mb-2 bg-[#0a1020] overflow-hidden">
                                  <img src={avatarFor(c.username, c.avatarUrl)} alt="" className="w-[102px] h-[102px] object-cover" />
                                  {i === 0 && c.coinsThisWeek > 0 && (
                                    <div className="absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#FFD700" }}>
                                      <Crown size={14} weight="fill" color="#04080F" aria-hidden="true" />
                                    </div>
                                  )}
                                </div>
                                <p className="font-mono text-[10px] text-[#1a1a1a] truncate leading-tight">
                                  {c.isMe ? "you" : c.username}
                                </p>
                                <p className="font-bebas text-sm text-[#1a1a1a] tabular-nums leading-tight">
                                  {c.coinsThisWeek}
                                  <span className="text-[#1a1a1a]/50 text-[9px]"> Fangs</span>
                                </p>
                              </div>

                              {/* Tap-to-challenge + nudge — only on friends, not on yourself */}
                              {!c.isMe && friendObj && (
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => { setChallengeTarget(friendObj); setChallengeWager(25); }}
                                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:brightness-125 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#04080F]"
                                    style={{
                                      background: "rgba(239, 68, 68, 0.1)",
                                      border: "1px solid rgba(239, 68, 68, 0.3)",
                                      color: "#EF4444",
                                    }}
                                    aria-label={`Challenge ${c.username} to an arena match`}
                                    title="Challenge"
                                  >
                                    <Sword size={14} weight="fill" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => canNudge && setNudgeTarget({ id: c.userId, username: c.username })}
                                    disabled={!canNudge}
                                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:brightness-125 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[#04080F] disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:brightness-100"
                                    style={{
                                      background: alreadyNudged ? "rgba(34, 197, 94, 0.1)" : "rgba(249, 115, 22, 0.1)",
                                      border: `1px solid ${alreadyNudged ? "rgba(34, 197, 94, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                                      color: alreadyNudged ? "#22C55E" : "#F97316",
                                      ["--tw-ring-color" as string]: alreadyNudged ? "rgba(34,197,94,0.7)" : "rgba(249,115,22,0.7)",
                                    }}
                                    aria-label={alreadyNudged ? `Already nudged ${c.username} today` : `Nudge ${c.username}`}
                                    title={alreadyNudged ? "Nudged today" : nudgeState.remaining === 0 ? "No nudges left today" : "Nudge"}
                                  >
                                    {alreadyNudged ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : <Fire size={14} weight="fill" aria-hidden="true" />}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Activity feed */}
                  <FeatureGate feature="social.activity_feed" compact>
                  <section className="relative">
                    <div className="flex items-baseline justify-between mb-5">
                      <h2 className="font-bebas text-lg text-cream tracking-[0.15em]">FEED</h2>
                      <button
                        type="button"
                        onClick={loadFeed}
                        aria-label="Refresh activity feed"
                        className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60 hover:text-electric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 rounded px-1 py-0.5 transition-colors"
                      >
                        refresh ↻
                      </button>
                    </div>

                    {!feedHydrated && feed.length === 0 ? (
                      /* First feed fetch in flight — skeleton posts, never the
                         "board's empty" copy (flash-of-empty guard). */
                      <div className="relative pl-10" aria-hidden="true">
                        <div className="social-rail" />
                        <ul className="space-y-3">
                          {[0, 1, 2].map(i => (
                            <li key={i} className="relative rounded-[6px] pl-12 pr-4 py-3.5"
                              style={{
                                background: "linear-gradient(135deg, #0f1629 0%, #0a1020 100%)",
                                border: "1px solid rgba(255,255,255,0.06)",
                              }}>
                              <div className="absolute left-3 top-3.5 w-6 h-6 rounded-full bg-white/[0.06] animate-pulse" />
                              <div className="space-y-2">
                                <div className="h-3 w-3/4 rounded bg-white/[0.06] animate-pulse" />
                                <div className="h-2.5 w-24 rounded bg-white/[0.04] animate-pulse" />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : feed.length === 0 ? (
                      <div className="py-14 text-center border-y border-white/[0.05]">
                        <PushPinSimple size={28} weight="regular" color="rgba(255,255,255,0.2)" className="mx-auto mb-3" aria-hidden="true" />
                        <p className="text-cream/60 text-sm italic font-serif mb-1">
                          board&rsquo;s empty for now
                        </p>
                        <p className="text-cream/55 text-xs">
                          {friends.length === 0 ? "add some friends and their wins show up here" : "your circle hasn't posted anything yet · be the first"}
                        </p>
                      </div>
                    ) : (
                      <div className="relative pl-10">
                        {/* Timeline rail */}
                        <div className="social-rail" aria-hidden="true" />

                        <ul className="space-y-3">
                          {feed.map((item, i) => {
                            const meta = FEED_META[item.type] ?? { Icon: Coins, pin: "#FFD700", label: item.type };
                            const ItemIcon = meta.Icon;
                            const tiltClasses = ["social-post-a", "social-post-b", "social-post-c", "social-post-d", "social-post-e"];
                            const tilt = tiltClasses[i % tiltClasses.length];
                            return (
                              <li key={item.id}
                                className={`social-post ${tilt} relative rounded-[6px] pl-12 pr-4 py-3.5`}
                                style={{
                                  background: "linear-gradient(135deg, #0f1629 0%, #0a1020 100%)",
                                  border: "1px solid rgba(255,255,255,0.06)",
                                  boxShadow: "0 6px 14px rgba(0,0,0,0.28)",
                                  "--pin": meta.pin,
                                } as React.CSSProperties}
                              >
                                <span className="social-pin" aria-hidden="true" />

                                {/* Timeline dot + avatar */}
                                <div
                                  className="absolute left-3 top-3.5 w-6 h-6 rounded-full overflow-hidden border-2"
                                  style={{ borderColor: meta.pin }}
                                >
                                  <img src={avatarFor(item.friendUsername, item.friendAvatarUrl)} alt="" className="w-5 h-5 rounded-full object-cover" />
                                </div>

                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-cream text-sm font-semibold leading-tight">
                                      <span className="text-cream">{item.friendUsername}</span>{" "}
                                      <EquippedFlair flair={item.flair} compact />
                                      <span className="text-cream/60 font-normal"> {item.description ?? `earned Fangs from ${meta.label}`}</span>
                                    </p>
                                    <p className="text-cream/55 text-[10px] mt-1 font-mono uppercase tracking-wider">
                                      {meta.label} · {timeAgo(item.createdAt)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <ItemIcon size={14} weight="regular" color={meta.pin} aria-hidden="true" />
                                    <span className="font-bebas text-lg tabular-nums" style={{ color: meta.pin }}>
                                      +{item.amount}
                                    </span>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </section>
                  </FeatureGate>

                  {friends.length > 0 && (
                    <p className="text-cream/55 text-[10px] italic font-serif text-center mt-10">
                      pick someone from the left to chat &middot; tap a post to react (soon)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <FeatureGate feature="social.chat_thread" compact>
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {/* Back button on mobile */}
                    <button
                      type="button"
                      onClick={() => setSelectedFriend(null)}
                      aria-label="Back to friends list"
                      className="sm:hidden grid place-items-center w-9 h-9 -ml-1 mr-0.5 rounded-full text-lg leading-none text-cream/60 hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 transition-colors"
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                    <div className="relative">
                      <img src={avatarFor(selectedFriend.username, selectedFriend.avatar_url)} alt="" className="w-9 h-9 rounded-full object-cover" />
                      {selectedFriend.is_online && (
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>
                    <div>
                      <p className="text-cream font-semibold text-sm">
                        {selectedFriend.username}
                        {selectedFriend.is_online && <span className="sr-only"> (online now)</span>}
                      </p>
                      {(() => {
                        const tier = getEloTier(selectedFriend.arena_elo);
                        return (
                          <p className="text-[10px] inline-flex items-center gap-1" style={{ color: tier.color }}>
                            <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                            {tier.name} · {selectedFriend.arena_elo} ELO
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Challenge button — opens direct-challenge modal (no /arena redirect) */}
                    <button
                      type="button"
                      onClick={() => { setChallengeTarget(selectedFriend); setChallengeWager(25); }}
                      aria-label={`Challenge ${selectedFriend.username} to an arena match`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:brightness-125 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04080F]"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        color: "#EF4444",
                      }}
                    >
                      <Sword size={14} weight="fill" aria-hidden="true" />
                      Challenge
                    </button>
                    {/* Close the chat → back to the main social list (all screens) */}
                    <button
                      type="button"
                      onClick={() => setSelectedFriend(null)}
                      aria-label="Close chat"
                      className="grid place-items-center w-8 h-8 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 transition-colors"
                    >
                      <XIcon size={16} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Messages area */}
                <div
                  ref={chatContainerRef}
                  className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
                  role="log"
                  aria-live="polite"
                  aria-label={`Conversation with ${selectedFriend.username}`}
                >
                  {/* "Say hi" only renders once THIS thread's fetch has resolved
                      empty — opening an existing conversation stays blank (no
                      flash) until the messages land. */}
                  {timeline.length === 0 && messagesLoadedFor === selectedFriend.id && (
                    <div className="text-center py-14 flex flex-col items-center gap-3 social-empty-thread">
                      <div
                        className="w-14 h-14 rounded-full grid place-items-center"
                        style={{
                          background: "linear-gradient(135deg, rgba(74,144,217,0.15) 0%, rgba(168,85,247,0.10) 100%)",
                          border: "1px solid rgba(74,144,217,0.25)",
                        }}
                      >
                        <Megaphone size={24} weight="fill" className="text-electric/80" aria-hidden="true" />
                      </div>
                      <p className="text-cream/80 text-sm font-semibold">
                        Say hi to {selectedFriend.username}
                      </p>
                      <p className="font-serif italic text-cream/55 text-xs max-w-[220px]">
                        first messages are weird. a {`"yo"`} works.
                      </p>
                    </div>
                  )}

                  {timeline.map((item) => {
                    if (item.type === "arena") {
                      const event = item.data as ArenaEvent;
                      const iWon = event.winner_id === user?.id;
                      const isDraw = !event.winner_id;
                      return (
                        <div key={`arena-${event.id}`} className="flex justify-center my-4">
                          <div className="rounded-xl px-5 py-3 max-w-sm w-full text-center"
                            style={{
                              background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(74,144,217,0.03) 100%)",
                              border: "1px solid rgba(74,144,217,0.15)",
                            }}>
                            <p className="text-[10px] text-cream/55 uppercase tracking-widest mb-1">Arena Match</p>
                            <p className="font-bebas text-lg tracking-wider mb-1"
                              style={{ color: isDraw ? "#E67E22" : iWon ? "#22C55E" : "#EF4444" }}>
                              {isDraw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT"}
                            </p>
                            <div className="flex items-center justify-center gap-3 text-xs text-cream/60">
                              <span className="tabular-nums">{event.player1_score} vs {event.player2_score}</span>
                              <span className="text-cream/10">|</span>
                              <span className="flex items-center gap-1">
                                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" />
                                {isDraw ? "±0" : iWon ? `+${event.wager}` : `-${event.wager}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const msg = item.data as Message;
                    const isMine = msg.sender_id === user?.id;
                    return (
                      <div key={`msg-${msg.id}`} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div className={`social-msg-bubble ${isMine ? "social-msg-mine" : "social-msg-theirs"} max-w-[70%] rounded-2xl px-4 py-2.5 will-change-transform`}
                          style={isMine ? {
                            background: "linear-gradient(135deg, rgba(255,215,0,0.14) 0%, rgba(184,150,12,0.06) 100%)",
                            border: "1px solid rgba(255,215,0,0.18)",
                            borderBottomRightRadius: "4px",
                          } : {
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            borderBottomLeftRadius: "4px",
                          }}>
                          <p className="text-cream text-sm leading-relaxed">{msg.content}</p>
                          <p className={`font-mono text-[9px] mt-1 tabular-nums ${isMine ? "text-gold/60 text-right" : "text-cream/55"}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="px-4 py-3 border-t border-white/[0.06] flex-shrink-0">
                  <form
                    className="flex gap-2"
                    onSubmit={e => { e.preventDefault(); sendMessage(); }}
                  >
                    <label htmlFor="social-msg-input" className="sr-only">
                      Message {selectedFriend.username}
                    </label>
                    <input
                      ref={msgInputRef}
                      id="social-msg-input"
                      type="text"
                      value={msgInput}
                      onChange={e => setMsgInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder={`Message ${selectedFriend.username}`}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={true}
                      className="social-msg-input flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-cream placeholder:text-cream/55 focus:outline-none focus:border-electric/40 transition"
                    />
                    <button
                      type="submit"
                      disabled={!msgInput.trim() || sending}
                      aria-label={sending ? "Sending message" : `Send message to ${selectedFriend.username}`}
                      className="px-5 py-2.5 rounded-xl font-bold text-sm transition-transform active:scale-95 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04080F] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:brightness-100 will-change-transform"
                      style={{
                        background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                        color: "#04080F",
                      }}>
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </form>
                </div>
              </>
              </FeatureGate>
            )}
          </div>
        </div>

        {/* ═══ Nudge Modal — pick a preset, send encouragement to a friend ═══ */}
        {nudgeTarget && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center px-4"
            onClick={() => !sendingNudge && setNudgeTarget(null)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
            <div
              ref={nudgeDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Nudge ${nudgeTarget.username}`}
              className="relative w-full max-w-sm rounded-2xl border border-orange-500/25 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center mb-5">
                <Fire size={40} weight="fill" color="#F97316" className="mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-bebas text-2xl text-cream tracking-wider leading-tight">
                  Nudge {nudgeTarget.username}
                </h2>
                <p className="font-serif italic text-cream/60 text-xs mt-2">
                  one-tap encouragement. you have {nudgeState.remaining} nudge{nudgeState.remaining === 1 ? "" : "s"} left today.
                </p>
              </div>

              <div className="space-y-2 mb-5">
                {[
                  { key: "grind",   label: "grind time. let's go",        accent: "#F97316" },
                  { key: "gotthis", label: "you got this, stay locked in", accent: "#FFD700" },
                  { key: "studyup", label: "we studying? hop on",          accent: "#4A90D9" },
                  { key: "missyou", label: "miss your grind. pull up",     accent: "#A855F7" },
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => sendNudge(p.key)}
                    disabled={sendingNudge}
                    aria-label={`Send nudge: ${p.label}`}
                    className="w-full text-left px-4 py-3 rounded-lg transition-all hover:brightness-125 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1020] disabled:opacity-40 disabled:hover:brightness-100"
                    style={{
                      background: `${p.accent}10`,
                      border: `1px solid ${p.accent}30`,
                      color: p.accent,
                      ["--tw-ring-color" as string]: `${p.accent}99`,
                    }}
                  >
                    <span className="font-syne text-sm font-semibold">{p.label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setNudgeTarget(null)}
                disabled={sendingNudge}
                className="w-full py-2.5 rounded-lg text-sm font-semibold border border-white/10 text-cream/70 hover:text-cream hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-all disabled:opacity-40"
              >
                {sendingNudge ? "Sending…" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* ═══ Challenge Modal — direct arena challenge with wager picker ═══ */}
        {challengeTarget && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center px-4"
            onClick={() => !sendingChallenge && setChallengeTarget(null)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
            <div
              ref={challengeDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Challenge ${challengeTarget.username} to an arena match`}
              className="relative w-full max-w-sm rounded-2xl border border-red-500/25 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center mb-5">
                <Sword size={40} weight="fill" color="#EF4444" className="mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-bebas text-2xl text-cream tracking-wider leading-tight">
                  Challenge {challengeTarget.username}?
                </h2>
                <p className="font-serif italic text-cream/60 text-xs mt-2">
                  winner takes the pot. 10 questions, 15s each.
                </p>
              </div>

              <div className="mb-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60 mb-2">wager · Fangs</p>
                <div className="grid grid-cols-4 gap-2">
                  {[10, 25, 50, 100].map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setChallengeWager(w)}
                      aria-pressed={challengeWager === w}
                      aria-label={`Wager ${w} Fangs`}
                      className={`min-h-[44px] py-2 rounded-lg text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1020] ${challengeWager === w ? "text-navy" : "text-cream/60 hover:text-cream"}`}
                      style={challengeWager === w
                        ? { background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)" }
                        : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChallengeTarget(null)}
                  disabled={sendingChallenge}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-white/10 text-cream/70 hover:text-cream hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-all disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={sendChallenge}
                  disabled={sendingChallenge}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1020] inline-flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)",
                    color: "#FFF",
                    opacity: sendingChallenge ? 0.6 : 1,
                  }}
                >
                  {sendingChallenge ? "Sending…" : <><Sword size={14} weight="fill" aria-hidden="true" /> Send Challenge</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Add-Friend Modal ═══ */}
        {showAddFriendModal && (
          <div
            ref={addFriendDialogRef}
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-label="Add friend"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowAddFriendModal(false);
                setAddUsername("");
                setShowDropdown(false);
                setAddError("");
                setAddSuccess("");
              }
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-electric/25 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)" }}
              ref={dropdownRef}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div className="inline-flex items-center gap-2.5">
                  <UserPlus size={20} weight="bold" className="text-gold" aria-hidden="true" />
                  <h2 className="font-bebas text-lg text-cream tracking-wider">ADD FRIEND</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddFriendModal(false);
                    setAddUsername("");
                    setShowDropdown(false);
                    setAddError("");
                    setAddSuccess("");
                  }}
                  aria-label="Close add friend dialog"
                  className="grid place-items-center w-8 h-8 rounded-full text-cream/55 hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 transition-colors"
                >
                  <XIcon size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>

              {/* Search input */}
              <div className="px-5 pt-4">
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    weight="bold"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40"
                    aria-hidden="true"
                  />
                  <div className="flex gap-2">
                    <label htmlFor="social-add-friend-input" className="sr-only">Search for a username to add as a friend</label>
                    <input
                      id="social-add-friend-input"
                      type="text"
                      value={addUsername}
                      onChange={(e) => handleAddUsernameChange(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addFriend()}
                      onFocus={() => {
                        if (searchResults.length > 0 || addUsername.trim().length >= 2) setShowDropdown(true);
                      }}
                      autoFocus
                      placeholder="Search username..."
                      role="combobox"
                      aria-expanded={showDropdown && addUsername.trim().length >= 2}
                      aria-controls="social-add-friend-results"
                      aria-autocomplete="list"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-cream placeholder:text-cream/55 focus:outline-none focus:border-electric/40 transition"
                    />
                    <button
                      type="button"
                      onClick={addFriend}
                      className="px-4 py-2.5 rounded-lg text-xs font-bold transition-all hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1020]"
                      style={{
                        background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                        color: "#04080F",
                      }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Autocomplete dropdown */}
                  {showDropdown && addUsername.trim().length >= 2 && (
                    <div
                      id="social-add-friend-results"
                      role="listbox"
                      aria-label="Username search results"
                      className="absolute left-0 right-0 top-full mt-1 rounded-lg overflow-hidden z-50 max-h-64 overflow-y-auto"
                      style={{
                        background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                      }}
                    >
                      {searchLoading ? (
                        <div className="flex items-center justify-center gap-2 py-4" role="status">
                          <div className="w-4 h-4 rounded-full border-2 border-electric border-t-transparent animate-spin" aria-hidden="true" />
                          <span className="text-cream/55 text-xs">Searching...</span>
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="py-4 text-center">
                          <p className="text-cream/55 text-xs">No users found</p>
                        </div>
                      ) : (
                        searchResults.map((u) => {
                          const tier = getEloTier(u.arena_elo);
                          return (
                            <div
                              key={u.id}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                            >
                              <img
                                src={avatarFor(u.username, u.avatar_url)}
                                alt={u.username}
                                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-cream text-sm font-semibold truncate">{u.username}</p>
                                  <EquippedFlair flair={u.flair} compact />
                                </div>
                                <span
                                  className="text-[9px] font-bold inline-flex items-center gap-1"
                                  style={{ color: tier.color }}
                                >
                                  <tier.Icon size={11} weight="fill" color={tier.color} aria-hidden="true" />
                                  {tier.name}
                                </span>
                              </div>
                              {/* Action per relationship — Add / Accept / Requested / Friends */}
                              {u.relationship === "incoming" ? (
                                <button
                                  type="button"
                                  onClick={() => acceptFromSearch(u)}
                                  aria-label={`Accept friend request from ${u.username}`}
                                  className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 transition inline-flex items-center gap-1"
                                >
                                  <CheckCircle size={12} weight="fill" aria-hidden="true" />
                                  Accept
                                </button>
                              ) : u.relationship === "outgoing" ? (
                                <span
                                  className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded bg-white/[0.04] text-cream/55 inline-flex items-center gap-1"
                                  aria-label={`Friend request to ${u.username} pending`}
                                >
                                  Requested
                                </span>
                              ) : u.relationship === "friends" ? (
                                <span
                                  className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded bg-electric/10 text-electric inline-flex items-center gap-1"
                                  aria-label={`Already friends with ${u.username}`}
                                >
                                  <CheckCircle size={12} weight="fill" aria-hidden="true" />
                                  Friends
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => sendRequestTo(u.username)}
                                  aria-label={`Add ${u.username} as a friend`}
                                  className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded transition inline-flex items-center gap-1 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0c1020]"
                                  style={{
                                    background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                                    color: "#04080F",
                                  }}
                                >
                                  <UserPlus size={12} weight="bold" aria-hidden="true" />
                                  Add
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                {addError && <p className="text-red-400 text-xs mt-2" role="alert">{addError}</p>}
                {addSuccess && <p className="text-green-400 text-xs mt-2" role="status">{addSuccess}</p>}
              </div>

              {/* Sent Requests list */}
              <div className="px-5 pt-5 pb-5">
                <p className="text-cream/60 text-[10px] font-bold uppercase tracking-widest mb-3 inline-flex items-center gap-2">
                  Sent Requests
                  <span className="text-cream/55 font-mono normal-case tracking-normal text-[10px]">
                    ({outgoingRequests.length})
                  </span>
                </p>
                {outgoingRequests.length === 0 ? (
                  <div className="py-6 text-center rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <p className="text-cream/55 text-xs">No pending requests</p>
                    <p className="text-cream/55 text-[10px] mt-1 font-mono">Search above to add a friend</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {outgoingRequests.map((req) => {
                      const tier = getEloTier(req.arena_elo);
                      return (
                        <div
                          key={req.friendshipId}
                          className="flex items-center gap-3 p-2.5 rounded-lg"
                          aria-label={`Outgoing friend request to ${req.username}`}
                          style={{ background: "rgba(255,255,255,0.03)" }}
                        >
                          <img
                            src={avatarFor(req.username, req.avatar_url)}
                            alt={req.username}
                            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-cream text-xs font-semibold truncate">{req.username}</p>
                            <p className="text-[10px] inline-flex items-center gap-1" style={{ color: tier.color }}>
                              <tier.Icon size={10} weight="fill" color={tier.color} aria-hidden="true" />
                              {tier.name} &middot; <span className="text-cream/55">Pending</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => cancelRequest(req.friendshipId)}
                            aria-label={`Undo friend request to ${req.username}`}
                            className="text-red-400 text-[10px] font-bold px-2.5 py-1.5 rounded bg-red-400/10 hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 transition inline-flex items-center gap-1"
                          >
                            <XIcon size={10} weight="bold" aria-hidden="true" />
                            Undo
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
