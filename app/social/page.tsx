"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";

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

// ── Helpers ──────────────────────────────────────────────────

const ELO_TIERS = [
  { name: "Bronze", min: 0, max: 1199, color: "#CD7F32", icon: "🥉" },
  { name: "Silver", min: 1200, max: 1399, color: "#C0C0C0", icon: "🥈" },
  { name: "Gold", min: 1400, max: 1599, color: "#FFD700", icon: "🥇" },
  { name: "Platinum", min: 1600, max: 1799, color: "#00CED1", icon: "💎" },
  { name: "Diamond", min: 1800, max: 9999, color: "#B9F2FF", icon: "💠" },
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
  useUserStats(user?.id);

  // Friends
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Memoized avatar
  const myAvatar = useMemo(() => {
    if (user?.avatar) return user.avatar;
    return `https://api.dicebear.com/7.x/adventurer/svg?seed=${user?.username ?? "player"}`;
  }, [user?.avatar, user?.username]);

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
      setFriends(res.data.friends ?? []);
      setPendingRequests(res.data.pendingRequests ?? []);
    }
  }, [user?.id]);

  useEffect(() => {
    loadFriends();
    const iv = setInterval(loadFriends, 10000);
    return () => clearInterval(iv);
  }, [loadFriends]);

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
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                          >
                            <img
                              src={u.avatar_url ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.username}`}
                              alt={u.username}
                              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-cream text-sm font-semibold truncate">{u.username}</p>
                            </div>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{
                              color: tier.color,
                              background: `${tier.color}15`,
                            }}>
                              {tier.icon} {tier.name}
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
                      <span className="text-base flex-shrink-0 mt-0.5">
                        {n.type === "friend_request" ? "👥" : n.type === "friend_accepted" ? "✅" : n.type === "arena_challenge" ? "⚔️" : n.type === "arena_result" ? "🏆" : n.type === "rank_up" ? "🥇" : "📢"}
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
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <img
                          src={req.avatar_url ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${req.username}`}
                          alt={req.username}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">{req.username}</p>
                          <p className="text-[10px]" style={{ color: tier.color }}>{tier.icon} {tier.name}</p>
                        </div>
                        <button onClick={() => handleRequest(req.friendshipId, "accept")}
                          className="text-green-400 text-[10px] font-bold px-2 py-1 rounded bg-green-400/10 hover:bg-green-400/20 transition">
                          Accept
                        </button>
                        <button onClick={() => handleRequest(req.friendshipId, "decline")}
                          className="text-cream/30 text-[10px] px-1.5 py-1 rounded hover:text-cream/50 transition">
                          ✕
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
                    <div className="relative flex-shrink-0">
                      <img
                        src={friend.avatar_url ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${friend.username}`}
                        alt={friend.username}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      {friend.is_online && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-cream text-sm font-semibold truncate">{friend.username}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{
                          color: tier.color,
                          background: `${tier.color}15`,
                        }}>
                          {tier.icon} {tier.name}
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
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <img src={cdnUrl("/logo-icon.png")} alt="Lionade" className="w-20 h-20 opacity-20 mb-6" />
                <p className="font-bebas text-2xl text-cream/20 tracking-wider mb-2">SELECT A FRIEND</p>
                <p className="text-cream/15 text-sm max-w-xs">
                  Pick someone from your friends list to start chatting
                </p>
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
                    <div className="relative">
                      <img
                        src={selectedFriend.avatar_url ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${selectedFriend.username}`}
                        alt={selectedFriend.username}
                        className="w-9 h-9 rounded-full object-cover"
                      />
                      {selectedFriend.is_online && (
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#04080F] social-online-dot" />
                      )}
                    </div>
                    <div>
                      <p className="text-cream font-semibold text-sm">{selectedFriend.username}</p>
                      <p className="text-[10px]" style={{ color: getEloTier(selectedFriend.arena_elo).color }}>
                        {getEloTier(selectedFriend.arena_elo).icon} {getEloTier(selectedFriend.arena_elo).name} — {selectedFriend.arena_elo} ELO
                      </p>
                    </div>
                  </div>

                  {/* Challenge button */}
                  <a href={`/arena`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      color: "#EF4444",
                    }}>
                    ⚔️ Challenge
                  </a>
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
      </div>
    </ProtectedRoute>
  );
}
