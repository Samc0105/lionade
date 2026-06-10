// POST /api/party/pokerface/rounds/[id]/open-vote — end the Interrogation beat
// and open the vote (advance phase 'interrogate' -> 'vote').
//
// Body: {}
//
// In the live flow this is the "read the fact out loud" beat: the presenter
// reads their fact to the room (their TRUE/LIE pick stays secret), then taps
// "I've read it" to open calling for everyone. This route is that advance. It
// may be fired by the PRESENTER (the primary "I've read it" path, 2026-06-10
// round-UX rebuild), the HOST, or the INTERROGATOR (computed server-side, same
// rule the GET route reports — kept as the legacy/backstop authorizer), plus a
// client timer fires it as a backstop so the beat can never stall. Resetting
// presented_at = now starts the vote window fresh.
//
// Secret-safe: this only flips the public phase; no secret column is read or
// returned. Race-guarded on phase='interrogate' so concurrent fires no-op.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("id, room_id, presenter_user_id, phase")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Already advanced (or not in the interrogation) → no-op so a timer/host race
  // is harmless.
  if (round.phase !== "interrogate") {
    return NextResponse.json({ ok: true, phase: round.phase, already: true });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("host_user_id")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // The interrogator = the active player seated right after the presenter
  // (joined_at order, wrapping). Same rule the GET route reports to clients.
  const { data: activePlayers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, joined_at")
    .eq("room_id", round.room_id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  const seats = (activePlayers ?? []).map((p) => p.user_id);
  const presenterIdx = seats.indexOf(round.presenter_user_id);
  const interrogatorId = seats.length >= 2 && presenterIdx !== -1
    ? seats[(presenterIdx + 1) % seats.length]
    : null;

  // Presenter ("I've read it"), host, or interrogator (legacy backstop) may
  // advance. Secret-safe either way: this only flips the public phase.
  if (
    userId !== room.host_user_id &&
    userId !== interrogatorId &&
    userId !== round.presenter_user_id
  ) {
    return NextResponse.json(
      { error: "Only the presenter, the host, or the interrogator can open the vote" },
      { status: 403 },
    );
  }

  const { data: claimed } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .update({ phase: "vote", presented_at: new Date().toISOString() })
    .eq("id", round.id)
    .eq("phase", "interrogate")  // race guard
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json({ ok: true, phase: "vote", already: true });
  }

  return NextResponse.json({ ok: true, phase: "vote" });
}
