"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { Medal, Diamond, DiamondsFour, Users, CheckCircle, Sword, Trophy, Megaphone, X as XIcon, BookOpen, Fire, Target, MedalMilitary, GameController, Coins, PushPinSimple, Crown } from "@phosphor-icons/react";
import { toastError, toastSuccess } from "@/lib/toast";
import CountUp from "@/components/CountUp";

// ── Types ────────────────────────────────────────────────────

interface Friend {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  is_online: boolean;
  last_seen: string | null;
  unreadCount: number;
}

interface PendingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
}

interface OutgoingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
  sentAt: string;
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
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface CircleRank {
  userId: string;
  username: string;
  avatarUrl: string | null;
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
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifView, setShowNotifView] = useState(false);
  const [socialNotifs, setSocialNotifs] = useState<{ id: string; type: string; title: string; message: string | null; read: boolean; action_url: string | null; created_at: string }[]>([]);
  const [socialUnreadCount, setSocialUnreadCount] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<{ id: string; username: string; avatar_url: string | null; arena_elo: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [arenaEvents, setArenaEvents] = useState<ArenaEvent[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);

  // Feed + circle leaderboard
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [circle, setCircle] = useState<CircleRank[]>([]);

  // Challenge modal
  const [challengeTarget, setChallengeTarget] = useState<Friend | null>(null);
  const [challengeWager, setChallengeWager] = useState(25);
  const [sendingChallenge, setSendingChallenge] = useState(false);

  // Nudges
  const [nudgeState, setNudgeState] = useState<{ remaining: number; limit: number; nudgedToday: string[] }>({
    remaining: 5, limit: 5, nudgedToday: [],
  });
  const [nudgeTarget, setNudgeTarget] = useState<{ id: string; username: string } | null>(null);
  const [sendingNudge, setSendingNudge] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

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
        nudgeState?: typeof nudgeState;
      };
      if (Array.isArray(c.friends)) setFriends(c.friends);
      if (Array.isArray(c.pendingRequests)) setPendingRequests(c.pendingRequests);
      if (Array.isArray(c.outgoingRequests)) setOutgoingRequests(c.outgoingRequests);
      if (Array.isArray(c.feed)) setFeed(c.feed);
      if (Array.isArray(c.circle)) setCircle(c.circle);
      if (c.nudgeState) setNudgeState(c.nudgeState);
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
  const loadFriends = useCallback(async () => {
    if (!user?.id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await apiGet<any>("/api/social/friends");
    if (res.ok && res.data) {
      const friends = res.data.friends ?? [];
      const pendingRequests = res.data.pendingRequests ?? [];
      const outgoingRequests = res.data.outgoingRequests ?? [];
      setFriends(friends);
      setPendingRequests(pendingRequests);
      setOutgoingRequests(outgoingRequests);
      cacheSocial({ friends, pendingRequests, outgoingRequests });
    }
  }, [user?.id, cacheSocial]);

  useEffect(() => {
    loadFriends();
    const iv = setInterval(loadFriends, 10000);
    return () => clearInterval(iv);
  }, [loadFriends]);

  // ── Load activity feed + circle leaderboard ───────────────
  const loadFeed = useCallback(async () => {
    if (!user?.id) return;
    const res = await apiGet<{ feed: FeedItem[]; circle: CircleRank[] }>("/api/social/feed");
    if (res.ok && res.data) {
      const feed = res.data.feed ?? [];
      const circle = res.data.circle ?? [];
      setFeed(feed);
      setCircle(circle);
      cacheSocial({ feed, circle });
    }
  }, [user?.id, cacheSocial]);

  useEffect(() => {
    loadFeed();
    const iv = setInterval(loadFeed, 30000);
    return () => clearInterval(iv);
  }, [loadFeed]);

  // ── Load nudge budget for the day ──────────────────────────
  const loadNudgeBudget = useCallback(async () => {
    if (!user?.id) return;
    const res = await apiGet<{ remaining: number; limit: number; nudgedToday: string[] }>("/api/social/nudge");
    if (res.ok && res.data) {
      setNudgeState(res.data);
      cacheSocial({ nudgeState: res.data });
    }
  }, [user?.id, cacheSocial]);

  useEffect(() => {
    loadNudgeBudget();
    const iv = setInterval(loadNudgeBudget, 60000);
    return () => clearInterval(iv);
  }, [loadNudgeBudget]);

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
      toastError(res.error ?? "Couldn't send nudge");
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
      toastError(res.error ?? "Couldn't send challenge");
    }
  }, [challengeTarget, challengeWager, sendingChallenge]);

  // ── Load notifications for social panel ─────────────────────
  const loadSocialNotifs = useCallback(async () => {
    if (!user?.id) return;
    const res = await apiGet<{
      notifications: { id: string; type: string; title: string; message: string | null; read: boolean; action_url: string | null; created_at: string }[];
      unreadCount: number;
    }>("/api/notifications");
    if (res.ok && res.data) {
      setSocialNotifs(res.data.notifications ?? []);
      setSocialUnreadCount(res.data.unreadCount ?? 0);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSocialNotifs();
    const iv = setInterval(loadSocialNotifs, 15000);
    return () => clearInterval(iv);
  }, [loadSocialNotifs]);

  // ── Load conversation ──────────────────────────────────────
  const loadMessages = useCallback(async (friendId: string) => {
    if (!user?.id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await apiGet<any>(`/api/social/messages?friendId=${friendId}`);
    if (res.ok && res.data) {
      setMessages(res.data.messages ?? []);
      setArenaEvents(res.data.arenaEvents ?? []);
      setFriends(prev => prev.map(f => f.id === friendId ? { ...f, unreadCount: 0 } : f));
    }
  }, [user?.id]);

  useEffect(() => {
    if (selectedFriend) loadMessages(selectedFriend.id);
  }, [selectedFriend, loadMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
          setMessages(prev => [...prev, newMsg]);
          // Mark as read
          supabase.from("messages").update({ read: true }).eq("id", newMsg.id);
        }
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id, selectedFriend?.id]);

  // ── Send message ───────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!user?.id || !selectedFriend || !msgInput.trim() || sending) return;
    setSending(true);

    const res = await apiPost<{ message: Message }>("/api/social/messages", {
      receiverId: selectedFriend.id,
      content: msgInput.trim(),
    });
    if (res.ok && res.data?.message) {
      setMessages(prev => [...prev, res.data!.message]);
      setMsgInput("");
    }
    setSending(false);
  }, [user?.id, selectedFriend, msgInput, sending]);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<{ users: any[] }>(
        `/api/social/search?q=${encodeURIComponent(value.trim())}`,
      );
      setSearchResults(res.ok && res.data ? res.data.users ?? [] : []);
      setSearchLoading(false);
    }, 300);
  }, [user?.id]);

  const selectSearchResult = useCallback(async (username: string) => {
    setAddUsername(username);
    setShowDropdown(false);
    setSearchResults([]);

    if (!user?.id) return;
    setAddError("");
    setAddSuccess("");
    const res = await apiPost("/api/social/friends", { friendUsername: username });
    if (!res.ok) {
      setAddError(res.error ?? "Failed to send request");
    } else {
      setAddSuccess(`Request sent to ${username}!`);
      setAddUsername("");
      setTimeout(() => setAddSuccess(""), 3000);
    }
  }, [user?.id]);

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

  // Filtered friends
  const filteredFriends = searchQuery
    ? friends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))
    : friends;

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

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <ProtectedRoute>
      <div data-force-dark className="relative min-h-screen pt-16 pb-0 overflow-hidden" style={{ isolation: "isolate" }}>
        <div className="relative z-10 h-[calc(100vh-64px)] flex max-w-7xl mx-auto">

          {/* ═══ LEFT PANEL — Friends List ═══ */}
          <div className={`flex-shrink-0 flex flex-col border-r border-white/[0.06] sm:w-[320px] sm:flex ${selectedFriend ? "hidden" : "w-full"}`}>

            {/* Add Friend with autocomplete */}
            <div className="p-4 border-b border-white/[0.06]" ref={dropdownRef}>
              <p className="font-bebas text-lg text-cream tracking-wider mb-3">ADD FRIEND</p>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={addUsername}
                    onChange={e => handleAddUsernameChange(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addFriend()}
                    onFocus={() => { if (searchResults.length > 0 || addUsername.trim().length >= 2) setShowDropdown(true); }}
                    placeholder="Search username..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/20 focus:outline-none focus:border-electric/40 transition"
                  />
                  <button onClick={addFriend}
                    className="px-4 py-2 rounded-lg text-xs font-bold transition-all active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                      color: "#04080F",
                    }}>
                    Add
                  </button>
                </div>

                {/* Autocomplete dropdown */}
                {showDropdown && addUsername.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-lg overflow-hidden z-50"
                    style={{
                      background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}>
                    {searchLoading ? (
                      <div className="flex items-center justify-center gap-2 py-4">
                        <div className="w-4 h-4 rounded-full border-2 border-electric border-t-transparent animate-spin" />
                        <span className="text-cream/30 text-xs">Searching...</span>
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="py-4 text-center">
                        <p className="text-cream/20 text-xs">No users found</p>
                      </div>
                    ) : (
                      searchResults.map(u => {
                        const tier = getEloTier(u.arena_elo);
                        return (
                          <button
                            key={u.id}
                            onClick={() => selectSearchResult(u.username)}
                            aria-label={`${u.username} — open profile`}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                          >
                            <img src={u.avatar_url ?? ""} alt={u.username} className="w-8 h-8 rounded-full object-cover" />
                            <div className="flex-1 min-w-0">
                              <p className="text-cream text-sm font-semibold truncate">{u.username}</p>
                            </div>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1" style={{
                              color: tier.color,
                              background: `${tier.color}15`,
                            }}>
                              <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                              {tier.name}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}
              {addSuccess && <p className="text-green-400 text-xs mt-2">{addSuccess}</p>}
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/15 focus:outline-none focus:border-white/20 transition"
              />
            </div>

            {/* Tab toggle: Friends / Notifications */}
            <div className="flex border-b border-white/[0.06]">
              <button
                onClick={() => setShowNotifView(false)}
                className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${!showNotifView ? "text-cream border-b-2 border-electric" : "text-cream/30 hover:text-cream/50"}`}
              >
                Friends
              </button>
              <button
                onClick={() => { setShowNotifView(true); loadSocialNotifs(); }}
                className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors relative ${showNotifView ? "text-cream border-b-2 border-electric" : "text-cream/30 hover:text-cream/50"}`}
              >
                Notifications
                {(socialUnreadCount ?? 0) > 0 && (
                  <span className="absolute top-1.5 ml-1 min-w-[16px] h-4 rounded-full inline-flex items-center justify-center px-1 text-[9px] font-bold"
                    style={{ background: "#EF4444", color: "#fff" }}>
                    {socialUnreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* Notifications Panel */}
            {showNotifView ? (
              <div className="flex-1 overflow-y-auto">
                {socialNotifs.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-cream/20 text-sm">No notifications</p>
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
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.04] transition-colors"
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
                        {n.message && <p className="text-[10px] text-cream/25 mt-0.5 truncate">{n.message}</p>}
                        <p className="text-[9px] text-cream/15 mt-1">
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
            ) : (
            <>
            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-cream/40 text-[10px] font-bold uppercase tracking-widest mb-2">
                  Pending Requests ({pendingRequests.length})
                </p>
                <div className="space-y-2">
                  {pendingRequests.map(req => {
                    const tier = getEloTier(req.arena_elo);
                    return (
                      <div key={req.friendshipId} className="flex items-center gap-3 p-2 rounded-lg"
                        aria-label={`Friend request from ${req.username}`}
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <img src={req.avatar_url ?? ""} alt={req.username} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">{req.username}</p>
                          <p className="text-[10px] inline-flex items-center gap-1" style={{ color: tier.color }}>
                            <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                            {tier.name}
                          </p>
                        </div>
                        <button onClick={() => handleRequest(req.friendshipId, "accept")}
                          className="text-green-400 text-[10px] font-bold px-2 py-1 rounded bg-green-400/10 hover:bg-green-400/20 transition">
                          Accept
                        </button>
                        <button onClick={() => handleRequest(req.friendshipId, "decline")}
                          className="text-cream/30 px-1.5 py-1 rounded hover:text-cream/50 transition inline-flex items-center">
                          <XIcon size={12} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Outgoing Pending Requests */}
            {outgoingRequests.length > 0 && (
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-cream/40 text-[10px] font-bold uppercase tracking-widest mb-2">
                  Sent Requests ({outgoingRequests.length})
                </p>
                <div className="space-y-2">
                  {outgoingRequests.map(req => {
                    const tier = getEloTier(req.arena_elo);
                    return (
                      <div key={req.friendshipId} className="flex items-center gap-3 p-2 rounded-lg"
                        aria-label={`Outgoing friend request to ${req.username}`}
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <img src={req.avatar_url ?? ""} alt={req.username} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">{req.username}</p>
                          <p className="text-[10px] text-cream/20">Pending</p>
                        </div>
                        <button onClick={() => cancelRequest(req.friendshipId)}
                          className="text-red-400 text-[10px] font-bold px-2 py-1 rounded bg-red-400/10 hover:bg-red-400/20 transition">
                          Cancel
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Friends List */}
            <div className="flex-1 overflow-y-auto">
              {filteredFriends.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-cream/20 text-sm">
                    {searchQuery ? "No friends match your search" : "No friends yet. Add someone above!"}
                  </p>
                </div>
              )}
              {filteredFriends.map(friend => {
                const tier = getEloTier(friend.arena_elo);
                const isSelected = selectedFriend?.id === friend.id;
                return (
                  <button
                    key={friend.id}
                    onClick={() => setSelectedFriend(friend)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all duration-150 hover:bg-white/[0.04]"
                    style={isSelected ? {
                      background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(74,144,217,0.03) 100%)",
                      borderLeft: "2px solid #4A90D9",
                    } : { borderLeft: "2px solid transparent" }}
                  >
                    {/* Avatar + online dot */}
                    <div className="relative flex-shrink-0" aria-label={`${friend.username}'s avatar`}>
                      <img src={friend.avatar_url ?? ""} alt={friend.username} className="w-10 h-10 rounded-full object-cover" />
                      {friend.is_online && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-cream text-sm font-semibold truncate">{friend.username}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{
                          color: tier.color,
                          background: `${tier.color}15`,
                        }}>
                          <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                          {tier.name}
                        </span>
                      </div>
                      <p className="text-cream/25 text-[10px] mt-0.5">
                        {friend.is_online ? (
                          <span className="text-green-400/70">Online</span>
                        ) : (
                          timeAgo(friend.last_seen)
                        )}
                      </p>
                    </div>

                    {/* Unread badge */}
                    {friend.unreadCount > 0 && (
                      <div className="flex-shrink-0 min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5 font-bold text-[10px]"
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
                  <header className="mb-8">
                    <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30 mb-3">
                      circle pulse &nbsp;&middot;&nbsp; {new Date().toLocaleDateString(undefined, { weekday: "long" }).toLowerCase()}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        {
                          label: "online now",
                          value: <CountUp id="social-online" value={onlineCount} duration={400} />,
                          accent: "#22C55E",
                          pulse: onlineCount > 0,
                        },
                        {
                          label: "requests",
                          value: <CountUp id="social-requests" value={pendingRequests.length} duration={400} />,
                          accent: pendingRequests.length > 0 ? "#FFD700" : "#71717A",
                        },
                        {
                          label: "your rank",
                          value: myRank ? <>#<CountUp id="social-rank" value={myRank} duration={400} /></> : "—",
                          accent: "#4A90D9",
                        },
                        {
                          label: "nudges left",
                          value: <><CountUp id="social-nudges-left" value={nudgeState.remaining} duration={300} /><span className="text-cream/30">/{nudgeState.limit}</span></>,
                          accent: nudgeState.remaining > 0 ? "#F97316" : "#71717A",
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
                          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45">
                            {chip.label}
                          </p>
                          <p className="font-bebas text-2xl tabular-nums mt-0.5" style={{ color: chip.accent }}>
                            {chip.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </header>

                  {/* ═══ Weekly Showdown — auto-picked rival ═══ */}
                  {rival && (
                    <section
                      className="mb-8 rounded-[8px] p-5 relative overflow-hidden"
                      style={{
                        background: "linear-gradient(90deg, rgba(239, 68, 68, 0.10) 0%, rgba(12, 16, 32, 0.95) 45%, rgba(74, 144, 217, 0.10) 100%)",
                        border: "1px solid rgba(239, 68, 68, 0.22)",
                      }}
                    >
                      <div className="flex items-baseline justify-between mb-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40">
                          this week&rsquo;s showdown
                        </p>
                        <p className="font-mono text-[10px] text-cream/30">ends friday 23:59 UTC</p>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        {/* YOU */}
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-cream/70 text-xs font-mono uppercase tracking-wider mb-0.5">you</p>
                          <p className="font-bebas text-3xl text-red-400 tabular-nums leading-none">
                            <CountUp id="social-myweekly" value={myWeekly} duration={500} />
                            <span className="text-cream/30 text-sm ml-1.5">Fangs</span>
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
                            <span className="text-cream/30 text-sm ml-1.5">Fangs</span>
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
                          className="font-mono text-[10px] uppercase tracking-[0.25em] text-electric hover:text-cream transition-colors disabled:opacity-30"
                        >
                          challenge now →
                        </button>
                      </div>
                    </section>
                  )}

                  {/* ═══ Squad Goal — collective weekly target ═══ */}
                  {circle.length > 0 && (
                    <section className="mb-10">
                      <div className="flex items-baseline justify-between mb-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40">
                          squad goal &middot; {circle.length} member{circle.length === 1 ? "" : "s"}
                        </p>
                        <p className="font-bebas text-cream/70 text-sm tabular-nums">
                          <CountUp id="social-squad-progress" value={squadProgress} duration={500} />
                          <span className="text-cream/30 text-xs"> / {squadTarget}</span>
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
                      <p className="mt-2 font-serif italic text-cream/35 text-xs">
                        {squadPct >= 100
                          ? "goal crushed. circle unlocked a 50 Fang bonus."
                          : `${Math.round(squadPct)}% there — every quiz counts toward the circle total`}
                      </p>
                    </section>
                  )}

                  {/* Circle weekly leaderboard — polaroids */}
                  {circle.length > 0 && (
                    <section className="mb-10">
                      <div className="flex items-baseline justify-between mb-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">this week · Fangs</p>
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
                                aria-label={`${c.isMe ? "you" : c.username} — circle leaderboard polaroid`}
                                style={{ "--polaroid-tilt": tilts[i] } as React.CSSProperties}
                              >
                                <div className="relative w-[102px] h-[102px] mb-2 bg-[#0a1020] overflow-hidden">
                                  <img src={c.avatarUrl ?? ""} alt={c.username} className="w-[102px] h-[102px] object-cover" />
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
                                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                                    style={{
                                      background: "rgba(239, 68, 68, 0.1)",
                                      border: "1px solid rgba(239, 68, 68, 0.3)",
                                      color: "#EF4444",
                                    }}
                                    aria-label={`Challenge ${c.username}`}
                                    title="Challenge"
                                  >
                                    <Sword size={14} weight="fill" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => canNudge && setNudgeTarget({ id: c.userId, username: c.username })}
                                    disabled={!canNudge}
                                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
                                    style={{
                                      background: alreadyNudged ? "rgba(34, 197, 94, 0.1)" : "rgba(249, 115, 22, 0.1)",
                                      border: `1px solid ${alreadyNudged ? "rgba(34, 197, 94, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                                      color: alreadyNudged ? "#22C55E" : "#F97316",
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
                  <section className="relative">
                    <div className="flex items-baseline justify-between mb-5">
                      <h2 className="font-bebas text-lg text-cream tracking-[0.15em]">FEED</h2>
                      <button onClick={loadFeed} className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 hover:text-electric transition-colors">
                        refresh ↻
                      </button>
                    </div>

                    {feed.length === 0 ? (
                      <div className="py-14 text-center border-y border-white/[0.05]">
                        <PushPinSimple size={28} weight="regular" color="rgba(255,255,255,0.2)" className="mx-auto mb-3" aria-hidden="true" />
                        <p className="text-cream/40 text-sm italic font-serif mb-1">
                          board&rsquo;s empty for now
                        </p>
                        <p className="text-cream/20 text-xs">
                          {friends.length === 0 ? "add some friends and their wins show up here" : "your circle hasn't posted anything yet — be the first"}
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
                                  aria-label={`${item.friendUsername}'s avatar`}
                                  style={{ borderColor: meta.pin }}
                                >
                                  <img src={item.friendAvatarUrl ?? ""} alt={item.friendUsername} className="w-5 h-5 rounded-full object-cover" />
                                </div>

                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-cream text-sm font-semibold leading-tight">
                                      <span className="text-cream">{item.friendUsername}</span>
                                      <span className="text-cream/40 font-normal"> {item.description ?? `earned Fangs from ${meta.label}`}</span>
                                    </p>
                                    <p className="text-cream/25 text-[10px] mt-1 font-mono uppercase tracking-wider">
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

                  {friends.length > 0 && (
                    <p className="text-cream/20 text-[10px] italic font-serif text-center mt-10">
                      pick someone from the left to chat &middot; tap a post to react (soon)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {/* Back button on mobile */}
                    <button onClick={() => setSelectedFriend(null)} className="sm:hidden text-cream/40 mr-1 hover:text-cream/60 transition">
                      ←
                    </button>
                    <div className="relative" aria-label={`${selectedFriend.username}'s avatar`}>
                      <img src={selectedFriend.avatar_url ?? ""} alt={selectedFriend.username} className="w-9 h-9 rounded-full object-cover" />
                      {selectedFriend.is_online && (
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>
                    <div>
                      <p className="text-cream font-semibold text-sm">{selectedFriend.username}</p>
                      {(() => {
                        const tier = getEloTier(selectedFriend.arena_elo);
                        return (
                          <p className="text-[10px] inline-flex items-center gap-1" style={{ color: tier.color }}>
                            <tier.Icon size={12} weight="fill" color={tier.color} aria-hidden="true" />
                            {tier.name} — {selectedFriend.arena_elo} ELO
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Challenge button — opens direct-challenge modal (no /arena redirect) */}
                  <button
                    type="button"
                    onClick={() => { setChallengeTarget(selectedFriend); setChallengeWager(25); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      color: "#EF4444",
                    }}
                  >
                    <Sword size={14} weight="fill" aria-hidden="true" />
                    Challenge
                  </button>
                </div>

                {/* Messages area */}
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {timeline.length === 0 && (
                    <div className="text-center py-10">
                      <p className="text-cream/15 text-sm">No messages yet. Say hi!</p>
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
                            <p className="text-[10px] text-cream/30 uppercase tracking-widest mb-1">Arena Match</p>
                            <p className="font-bebas text-lg tracking-wider mb-1"
                              style={{ color: isDraw ? "#E67E22" : iWon ? "#22C55E" : "#EF4444" }}>
                              {isDraw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT"}
                            </p>
                            <div className="flex items-center justify-center gap-3 text-xs text-cream/40">
                              <span>{event.player1_score} — {event.player2_score}</span>
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
                        <div className="max-w-[70%] rounded-2xl px-4 py-2.5"
                          style={isMine ? {
                            background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(184,150,12,0.06) 100%)",
                            border: "1px solid rgba(255,215,0,0.15)",
                            borderBottomRightRadius: "4px",
                          } : {
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            borderBottomLeftRadius: "4px",
                          }}>
                          <p className="text-cream text-sm leading-relaxed">{msg.content}</p>
                          <p className={`text-[9px] mt-1 ${isMine ? "text-gold/40 text-right" : "text-cream/20"}`}>
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
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={msgInput}
                      onChange={e => setMsgInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-cream placeholder:text-cream/20 focus:outline-none focus:border-electric/30 transition"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!msgInput.trim() || sending}
                      className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                        color: "#04080F",
                      }}>
                      Send
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══ Nudge Modal — pick a preset, send encouragement to a friend ═══ */}
        {nudgeTarget && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center px-4"
            onClick={() => !sendingNudge && setNudgeTarget(null)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm rounded-2xl border border-orange-500/25 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center mb-5">
                <Fire size={40} weight="fill" color="#F97316" className="mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-bebas text-2xl text-cream tracking-wider leading-tight">
                  Nudge {nudgeTarget.username}
                </h2>
                <p className="font-serif italic text-cream/40 text-xs mt-2">
                  one-tap encouragement. you have {nudgeState.remaining} nudge{nudgeState.remaining === 1 ? "" : "s"} left today.
                </p>
              </div>

              <div className="space-y-2 mb-5">
                {[
                  { key: "grind",   label: "grind time — let's go",        accent: "#F97316" },
                  { key: "gotthis", label: "you got this, stay locked in", accent: "#FFD700" },
                  { key: "studyup", label: "we studying? hop on",          accent: "#4A90D9" },
                  { key: "missyou", label: "miss your grind — pull up",    accent: "#A855F7" },
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => sendNudge(p.key)}
                    disabled={sendingNudge}
                    className="w-full text-left px-4 py-3 rounded-lg transition-all active:scale-[0.98] disabled:opacity-40"
                    style={{
                      background: `${p.accent}10`,
                      border: `1px solid ${p.accent}30`,
                      color: p.accent,
                    }}
                  >
                    <span className="font-syne text-sm font-semibold">{p.label}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setNudgeTarget(null)}
                disabled={sendingNudge}
                className="w-full py-2.5 rounded-lg text-sm font-semibold border border-white/10 text-cream/60 hover:bg-white/5 transition-all disabled:opacity-40"
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
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm rounded-2xl border border-red-500/25 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center mb-5">
                <Sword size={40} weight="fill" color="#EF4444" className="mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-bebas text-2xl text-cream tracking-wider leading-tight">
                  Challenge {challengeTarget.username}?
                </h2>
                <p className="font-serif italic text-cream/40 text-xs mt-2">
                  winner takes the pot. 10 questions, 15s each.
                </p>
              </div>

              <div className="mb-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 mb-2">wager · Fangs</p>
                <div className="grid grid-cols-4 gap-2">
                  {[10, 25, 50, 100].map(w => (
                    <button
                      key={w}
                      onClick={() => setChallengeWager(w)}
                      className={`py-2 rounded-lg text-sm font-bold transition-all ${challengeWager === w ? "text-navy" : "text-cream/60 hover:text-cream"}`}
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
                  onClick={() => setChallengeTarget(null)}
                  disabled={sendingChallenge}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-white/10 text-cream/60 hover:bg-white/5 transition-all disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={sendChallenge}
                  disabled={sendingChallenge}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all active:scale-95 inline-flex items-center justify-center gap-2"
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
      </div>
    </ProtectedRoute>
  );
}
