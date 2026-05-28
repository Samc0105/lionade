# Lionade Party — Realtime Architecture

**Status:** design doc, pre-implementation
**Author:** dev-realtime-web
**Date:** 2026-05-26
**Scope:** Web only (V1). iOS port deferred per the locked Party V1 spec.
**Implementer:** admin (web orchestrator) — this doc is your blueprint.

This document specifies the Supabase Realtime topology, payload shapes, and lifecycle rules for Lionade Party V1, which ships two games on a shared room substrate:

1. **Sketchy Subjects** — subject-pictionary, stroke-sync heavy (the bandwidth-sensitive case).
2. **Bluff Trivia** — phase-based broadcast (write → vote → reveal), low bandwidth.

The shared substrate is `party_rooms` (lobby/playing/ended) plus per-game tables. Realtime is layered on top: one **room channel** plus one **game sub-channel** per active game. Strokes are broadcast over a sub-channel so the lobby channel stays quiet.

The design intentionally mirrors Arena V2's "Postgres-changes for state transitions + REST for authoritative writes" pattern but adds Supabase **broadcast** for the high-frequency stroke stream (Postgres-changes is the wrong tool for 30Hz events).

---

## 1. Channel topology

Two channel types per room. Both share the room code as a stable, unique identifier.

```
party-room-${code}                 ← lobby + room-level state
  ├─ presence:           player join/leave, drawer designation, host
  ├─ postgres_changes:   party_rooms (status/current_game updates)
  ├─ postgres_changes:   party_room_players (score updates)
  └─ broadcast:          "game-start", "game-end", "kick", "chat-lobby"

party-room-${code}-sketch          ← only mounted on /compete/party/sketch
  ├─ broadcast: stroke-start | stroke-points | stroke-end | undo | clear
  ├─ broadcast: guess | guess-outcome | round-start | round-end | factoid
  └─ postgres_changes: sketch_rounds (round phase transitions)

party-room-${code}-bluff           ← only mounted on /compete/party/bluff
  ├─ broadcast: phase-write | phase-vote | phase-reveal | round-start | round-end
  └─ postgres_changes: bluff_rounds (server-side phase advancement)
```

### Why split room from game?

- **Bandwidth isolation.** A 6-player sketch round emits ~30Hz of stroke batches. If those rode on the room channel, the lobby UI (idle in the background) would still be receiving them. Splitting means the bell icon, presence, and score-update consumers don't pay the cost.
- **Lifecycle separation.** Players can leave the sketch game back to the lobby without dropping their room membership. Sub-channel unmounts; room channel stays subscribed.
- **Per-game RLS / validation surface.** When we add custom server-side `realtime.broadcast_changes` policies later, sub-channel scope is the natural unit.

### Channel naming rules

Per the realtime hard-rules: `<feature>-<resource-id>` pattern, stable, unique. Examples:

| Good                              | Bad                       | Why bad                                    |
|-----------------------------------|---------------------------|---------------------------------------------|
| `party-room-ABCD12`               | `party`                   | Collides across rooms                       |
| `party-room-ABCD12-sketch`        | `party-sketch-room-ABCD12`| Inconsistent ordering breaks grepping       |
| `party-room-ABCD12-sketch`        | `party-room-ABCD12-game`  | Game type belongs in the name for clarity   |

Codes are 6-character alphanumeric (per locked spec). Uppercase canonical. Always trim + uppercase the user-entered code on the client before subscribing — otherwise `abcd12` and `ABCD12` end up on different channels.

---

## 2. Stroke broadcast pattern

This is the bandwidth-sensitive bit. Get this wrong and Party rooms eat the Supabase free-tier message quota in a weekend.

### Pipeline (drawer side)

```
pointermove event
    │
    ▼
buffer point into pendingPoints[]
    │
    ▼  (every 33ms via requestAnimationFrame-throttled flush)
emit one broadcast batch if pendingPoints.length > 0
    │
    ▼
clear buffer; repeat
```

### Payload shapes

All coordinates normalized **0–1000** integers (not 0–1 floats — integers are smaller on the wire and avoid float-formatting noise). Receivers multiply by `canvasWidth / 1000` and `canvasHeight / 1000`.

```ts
// Sent at pointerdown — receivers begin a new path.
type StrokeStartEvent = {
  type: 'stroke-start';
  stroke_num: number;       // monotonic per round, scoped to drawer
  color: string;            // hex, one of the 8 palette colors
  size: number;             // 1 | 2 | 3 (small/med/large; eraser = special color)
  is_eraser: boolean;
};

// Sent every ~33ms with a batch of points collected since last flush.
type StrokePointsEvent = {
  type: 'stroke-points';
  stroke_num: number;
  points: Array<[number, number]>;   // [[x,y], [x,y], ...] normalized 0-1000
};

// Sent at pointerup — receivers close the path.
type StrokeEndEvent = {
  type: 'stroke-end';
  stroke_num: number;
};

// Sent when drawer hits undo. Receivers pop the matching stroke.
type UndoEvent = {
  type: 'undo';
  stroke_num: number;       // the stroke to remove
};

// Sent when drawer hits clear (full canvas wipe).
type ClearEvent = {
  type: 'clear';
};
```

### Why batches, not per-point events?

A naive `emit on every pointermove` gives 120-240Hz on a desktop trackpad. That's 6-12x our 30Hz target and burns the message quota. Batching every 33ms at 5-15 points per batch gets us ~30 messages/sec/drawer with minimal visual lag (one frame at 30fps).

### Throttle on the client, not the channel

```ts
// Pseudocode for the drawer's flush loop.
let pending: Array<[number, number]> = [];
let lastFlush = 0;
const FLUSH_INTERVAL_MS = 33;

function onPointerMove(x, y) {
  pending.push([normalize(x), normalize(y)]);
}

function flushLoop(ts: number) {
  if (pending.length > 0 && ts - lastFlush >= FLUSH_INTERVAL_MS) {
    channel.send({
      type: 'broadcast',
      event: 'stroke',
      payload: {
        type: 'stroke-points',
        stroke_num: currentStrokeNum,
        points: pending,
      },
    });
    pending = [];
    lastFlush = ts;
  }
  requestAnimationFrame(flushLoop);
}
requestAnimationFrame(flushLoop);
```

Throttling at the channel level (e.g. lodash.throttle on `channel.send`) would still queue empty calls and waste CPU. Gate on `pending.length > 0` instead.

### Receiver side

Receivers maintain a `Map<stroke_num, Stroke>` for the active round. On `stroke-start` they create an entry; on `stroke-points` they append; on `stroke-end` they mark complete (but keep the entry so undo can target it). On `undo` they delete the entry and rerender. On `clear` they drop the whole map.

Rendering is incremental: each new `stroke-points` batch draws line segments from the last point of that stroke to each new point. Do **not** rerender the whole canvas on every batch — that's the n²-explosion path.

### Server-side persistence — client-on-end is the right call for V1

The question in the brief: client-side persist after each stroke ends (simpler) vs server-side aggregation (less network).

**Recommendation: client persists on `stroke-end`.**

- After the drawer's `stroke-end` event fires locally, the drawer's client POSTs `/api/party/sketch/strokes` with the completed stroke (color, size, points array, stroke_num).
- The route writes to `sketch_strokes` and returns 200. Drawer ignores response except for failure retry.
- This is **one DB write per stroke**, not per batch. Realistic stroke counts per 90-second round: 50–200. Totally fine for Postgres.
- Reasoning: the round's source-of-truth canvas is the **drawer's** local canvas. The broadcast is for showing the drawing to other players live; persistence is for late-joiners. The drawer already has the completed stroke geometry in memory the moment `stroke-end` fires — no point routing through the server to reconstruct what the drawer already knows.
- The "server-side aggregation" alternative (Edge Function debouncing live broadcasts into rows every 500ms) is more code and harder to reason about, and it only saves bandwidth if there are zero late-joiners — which is the case we're optimizing for. So it's strictly worse.

**Failure mode to handle:** the persist POST fails (network blip). The drawer client should queue failed persists in memory and retry on next `stroke-end`. If the round ends with failed persists still queued, the drawer attempts one final flush before navigating away. Stroke loss for late joiners is acceptable; stroke loss for live receivers is not, but live receivers already got the broadcast, so this is naturally tolerable.

**Edge case:** the drawer disconnects before persisting any strokes. The late-joiner sees an empty canvas. Acceptable — late-joiners are a degraded experience anyway.

---

## 3. Late-joiner stroke replay

When a player joins a room mid-sketch-round (or refreshes their browser):

```
1. fetch GET /api/party/sketch/rounds/[id]/strokes
   → returns persisted strokes ordered by stroke_num
2. begin local "replaying" state: replay = true, buffer = []
3. subscribe to party-room-${code}-sketch
4. for each strokeFromHistory: render to canvas (no animation, instant)
5. while replay = true and broadcast events arrive: push to buffer
6. once history rendered: drain buffer, applying each event in order
7. set replay = false; continue with live events normally
```

### Why buffer instead of dropping?

If a `stroke-points` event for `stroke_num: 47` arrives during the replay of strokes 1-30, dropping it means the live drawing skips a chunk. Buffering and applying after replay catches us up correctly.

### What about dedup?

Late-joiner fetches strokes 1–46 from the API. They subscribe to the channel. The drawer might be mid-stroke on `stroke_num: 47` when they subscribe. Possible duplicate scenarios:

- **History contains stroke 47 (drawer just finished it)** and `stroke-end` for 47 arrives via broadcast. The receiver already has 47 from history. The `stroke-end` is a no-op (the stroke is already complete in their map). Good.
- **History contains stroke 47 partially** — impossible, because persist happens on `stroke-end`. A stroke is either fully persisted or not in history at all.
- **History doesn't contain 47, and `stroke-points` for 47 arrives during replay.** Buffer it. After replay, apply it. We start mid-stroke; that's fine, the user just sees the line continue from wherever the buffered batch starts.

### Code shape

```ts
const [replayState, setReplayState] = useState<'fetching' | 'replaying' | 'live'>('fetching');
const bufferRef = useRef<BroadcastEvent[]>([]);

useEffect(() => {
  if (!roundId) return;
  let cancelled = false;

  (async () => {
    const { data } = await apiGet(`/api/party/sketch/rounds/${roundId}/strokes`);
    if (cancelled) return;
    renderStrokesToCanvas(data.strokes);   // synchronous draw
    // Drain anything that arrived while we were rendering.
    const buffered = bufferRef.current.splice(0);
    buffered.forEach(applyEventToCanvas);
    setReplayState('live');
  })();

  return () => { cancelled = true; };
}, [roundId]);

useEffect(() => {
  const channel = supabase.channel(`party-room-${code}-sketch`);
  channel.on('broadcast', { event: 'stroke' }, ({ payload }) => {
    if (replayState !== 'live') {
      bufferRef.current.push(payload);
    } else {
      applyEventToCanvas(payload);
    }
  });
  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}, [code, replayState]);
```

Note: `replayState` is a dependency on the live-subscription effect so the handler closure has the right value. Alternatively, use a `replayStateRef.current` to avoid re-subscribing.

---

## 4. AppState / tab-visibility handling

Web has `document.visibilitychange` and `document.visibilityState`. Use both.

### Drawer side

When the drawer's tab goes hidden:
- Stop the rAF flush loop. There's nothing to flush — they can't draw if they can't see the canvas.
- Send a `{ type: 'drawer-paused' }` broadcast so receivers can render a "drawer is away" indicator. (Optional V1 — but it's cheap and the UX win is real.)
- Do NOT unsubscribe the channel. Visibility-hidden doesn't kill WebSockets on web reliably; relying on re-subscribe-on-visible is more fragile than keeping the socket alive.

When the drawer's tab returns visible:
- Resume the rAF flush loop.
- Send `{ type: 'drawer-resumed' }`.
- No catch-up needed: while hidden, no strokes were generated.

### Receiver side

When a receiver's tab goes hidden:
- The canvas is offscreen; renders are wasted. Set a `paused = true` flag that gates rendering, but keep buffering incoming events into a ring buffer (or just into the same stroke map — the rendering is the expensive part, not the bookkeeping).

When a receiver's tab returns visible:
- Render the full current canvas state from the in-memory stroke map.
- Then re-fetch `/api/party/sketch/rounds/[id]/strokes` as a paranoia-check **only if** the channel reports a recent `SUBSCRIPTION_ERROR` or the WebSocket was closed (browsers will sometimes kill long-idle WS in background tabs after ~5-10min on locked screens / mobile Safari). Set a heuristic: if last successful broadcast was >60s ago, do the resync fetch.

### Heuristic for "did we drop the channel?"

Track `lastBroadcastAt: number` on the channel handler. On visibility-regained:

```ts
const staleness = Date.now() - lastBroadcastAt;
if (staleness > 60_000) {
  // Probably dropped. Resync.
  await refetchStrokes();
}
// Otherwise trust the live state.
```

### iOS port note (deferred — flag for `ios-dev-realtime`)

On iOS the AppState lifecycle is much harsher. `AppState.addEventListener('change', ...)` with `active`/`background`/`inactive` is the analog of `visibilitychange`. Background WebSockets are killed by iOS after ~30s reliably. The iOS port will need:
- On `active`: resubscribe channel AND refetch strokes (always, not just heuristically).
- On `background`: explicitly unsubscribe and clear the stroke map (or freeze it).
- Native WebSocket lifecycle is fundamentally different from web; do NOT copy the heuristic above to iOS verbatim.

For V1 web-only scope, the web design above is sufficient.

---

## 5. Guess broadcast

Guesses are NOT stroke-level. They live as their own broadcast events on the **same** sketch sub-channel (separate event name).

### Flow

```
Guesser types in chat input → presses Enter
    │
    ▼
POST /api/party/sketch/guess { roundId, guess }
    │
    ▼ (server)
1. Validate user is in room, is not the drawer.
2. Check guess against round.target_word:
   - exact match (case-insensitive, trimmed) → correct
   - Levenshtein ≤ 2 → close
   - else → wrong
3. If correct:
   - INSERT into sketch_guesses (first-correct check via unique constraint
     on (round_id, user_id) — see race conditions §8).
   - Compute points (1st/2nd/3rd/4th+ tier).
   - UPDATE party_room_players.score
4. Broadcast on party-room-${code}-sketch:
   { type: 'guess-outcome',
     user_id,
     username,
     was_correct,
     was_close,
     points_earned,
     guess_text_shown }
5. Return outcome to the guesser (HTTP response).
```

### `guess_text_shown` field — what's broadcast

| Outcome   | `guess_text_shown` value                                       |
|-----------|----------------------------------------------------------------|
| correct   | `null` (UI shows "Alice guessed it!" — never the target word)  |
| close     | the raw guess (so others see "Alice: mitchondira" — encourages) |
| wrong     | the raw guess (chat-style)                                     |

Showing the target word in a broadcast would let any non-drawer client snoop it via DevTools, so the server simply omits the word on correct guesses.

### Drawer client filters chat

The drawer's UI shows a "Chat hidden during your turn" placeholder. The drawer's broadcast handler still receives `guess-outcome` events but the renderer for the drawer's screen filters them out. Specifically:

```ts
channel.on('broadcast', { event: 'guess-outcome' }, ({ payload }) => {
  if (isDrawer) {
    // Drawer sees only a count: "3 players have guessed"
    setGuessCount(c => c + (payload.was_correct ? 1 : 0));
    return;
  }
  setChatLog(log => [...log, payload]);
});
```

The drawer DOES see `was_correct: true` events update a "X / N guessed" indicator — they need to know when the round is heading toward completion.

### Why broadcast wrong guesses too?

Per the spec: chat shows everyone's attempts. Watching a friend type "potatoe" while drawing a mitochondrion is half the fun. Server still validates them but lets them ride.

---

## 6. Bluff Trivia channel pattern

Bluff is phase-based; no high-frequency events. Realtime is used for phase transitions only.

### Phases

```
phase: 'idle'          ← lobby; no broadcast
       │
       ▼ host clicks "start round"
phase: 'write' (45s)   ← players type fake answers
       │              ← server holds answers; NO broadcast of individual writes
       ▼ timer ends OR all submitted
phase: 'vote' (30s)    ← server broadcasts shuffled-answer-list
       │              ← players click their vote; acked privately
       ▼ timer ends OR all voted
phase: 'reveal'        ← server broadcasts truth + scoring deltas + winner-of-round
       │
       ▼ host clicks "next round" (or auto after 8s)
phase: 'write' (next round)  OR  game-end
```

### Server-authoritative advancement

The server (via a scheduled job, an Edge Function on a timer, or simply a Next.js API route polled by the host's client) is the only thing that flips `bluff_rounds.phase`. Clients never advance phases themselves.

Why: prevents a malicious client from claiming "phase = reveal" early and reading the truth.

### Phase-transition payloads

```ts
type PhaseWriteEvent = {
  type: 'phase-write';
  round_id: string;
  question: string;          // the trivia question (shown to everyone)
  ends_at: string;           // ISO timestamp for 45s timer
};

type PhaseVoteEvent = {
  type: 'phase-vote';
  round_id: string;
  shuffled_answers: Array<{ id: string; text: string }>;
                              // 1 real + N fakes, server-shuffled
                              // text only — no author_id, no is_truth
  ends_at: string;
};

type PhaseRevealEvent = {
  type: 'phase-reveal';
  round_id: string;
  truth_answer_id: string;
  author_map: Record<string, string | null>;  // answer_id -> author_user_id (null = truth)
  voted_by: Record<string, string[]>;          // answer_id -> [voter_user_ids]
  score_deltas: Record<string, number>;        // user_id -> delta this round
};
```

### Anti-spoiler rules

- During `write` phase: **server NEVER broadcasts what individual players wrote.** Submissions go via `POST /api/party/bluff/submit-fake` and the response is just `{ ok: true }`. The shuffled list is held server-side until `phase-vote` fires.
- During `vote` phase: each vote goes via `POST /api/party/bluff/vote`. Server stores it. NO broadcast of "Alice voted for #3" — that would tip off other players. Only the final tally appears in `phase-reveal`.
- The `voted_by` map in reveal is the ONLY time vote attribution becomes public.

### Server validation of fakes

Per spec: server fuzzy-matches submitted fakes against the real answer (case-insensitive, simple normalization). If a fake is too close to the truth, server rejects it with `{ ok: false, reason: 'too-close-to-truth' }` and the client prompts the player to write something else. Time pressure is the player's problem; the server doesn't extend the timer.

---

## 7. Channel lifecycle

### Subscribe / unsubscribe

```ts
// Standard pattern. Mirror this exactly in every Party component.
useEffect(() => {
  if (!code) return;

  const channel = supabase.channel(`party-room-${code}-sketch`, {
    config: {
      broadcast: { self: false },   // don't echo our own broadcasts back
      presence: { key: userId },    // only if presence is needed
    },
  });

  channel
    .on('broadcast', { event: 'stroke' }, handleStroke)
    .on('broadcast', { event: 'guess-outcome' }, handleGuess)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sketch_rounds',
      filter: `room_id=eq.${roomId}`,
    }, handleRoundChange)
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        setConnState('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnState('error');
        // Reconnect handled by the visibility-regained heuristic in §4.
      }
    });

  return () => {
    supabase.removeChannel(channel);   // ← MANDATORY cleanup
  };
}, [code, roomId, userId]);
```

### Cleanup is the #1 risk

Every realtime hard-rule applies here. The most common bug is forgetting to unsubscribe when the user navigates from `/compete/party/sketch` back to `/compete/party` (lobby). The sketch sub-channel must die on that navigation. The room channel survives.

### Reconnect strategy

Supabase's `RealtimeClient` auto-reconnects on socket-level errors with backoff. We do NOT need to manually retry on `CHANNEL_ERROR` for the underlying socket — that's the SDK's job. We DO need to:

1. Show a "reconnecting…" UI hint when status flips to `CHANNEL_ERROR`.
2. Re-fetch authoritative state (strokes, round phase, scores) when status returns to `SUBSCRIBED` AND we previously saw an error. This is the same logic as the visibility-regained resync in §4.
3. Reset the local `replayState` to `'fetching'` for sketch if we lose the channel mid-round.

### Lazy server-side cleanup

Rooms aren't cleaned up by clients. A cron (deferred to post-launch) closes rooms where:
- `status = 'ended'`, OR
- `status != 'ended'` and no broadcast / no player join in 30 minutes.

Realtime channels are ephemeral; they exist as long as at least one client is subscribed. When the last client leaves, the channel evaporates on Supabase's side. So "channel cleanup" is really "DB row cleanup" — out of scope for this doc but flagged.

---

## 8. Race conditions to call out

### 8a. Two players guess the target word within 50ms

**Server is authoritative.** The unique constraint on `sketch_guesses (round_id, was_correct, position)` (or equivalent — see schema work) means the database serializes the inserts. Whichever transaction commits first wins position 1; the other gets position 2.

Implementation detail in the route: after attempting INSERT, immediately SELECT the row back to learn which position was assigned. Then broadcast `guess-outcome` with the assigned position and the corresponding tier (1000 / 600 / 400 / 200).

The "loser" of the race doesn't get an error — they get `was_correct: true, position: 2, points_earned: 600`. From their perspective they guessed correctly; they just came second.

**Edge case:** the unique constraint should NOT be on `(round_id, user_id)` alone — that would block a player from re-trying after a wrong guess. The right constraint is `UNIQUE (round_id, user_id) WHERE was_correct = true` (partial unique index) so a user can have many wrong guesses but only one correct entry per round.

### 8b. Drawer disconnects mid-round

Server has a **60-second drawer-grace timer.** On `presence.leave` for the drawer:
- Server starts a 60s timer.
- If drawer returns (`presence.join` from same user_id) within 60s: cancel timer, broadcast `{ type: 'drawer-resumed' }`, resume.
- If timer expires: server marks the round as auto-ended (with whatever strokes were persisted), broadcasts `{ type: 'round-end', reason: 'drawer-left' }`, awards no drawer points, and advances rotation to the next drawer.

The 60s grace covers normal flakiness (Wi-Fi blip, tab refresh). Beyond that, the room shouldn't be held hostage.

### 8c. Late joiner sees stroke history while live stroke is being broadcast

Covered in §3. Buffer live events during replay; drain on replay-complete.

### 8d. Guess broadcast arrives BEFORE the guess's own HTTP response returns

The guesser POSTs `/api/party/sketch/guess`. The server INSERTs, broadcasts, returns 200. **The broadcast often arrives at the guesser's client before the HTTP response.** This is a feature, not a bug — the broadcast handler already updates the local chat log with `payload.username`, and when the HTTP response arrives the client has nothing new to do. So:

- HTTP response handler: just check `{ ok }` for error display; do NOT mutate chat log.
- Broadcast handler: source of truth for chat log mutations, including the guesser's own message.
- The `broadcast: { self: false }` config means the guesser does NOT receive their own broadcast. Adjust: set `self: true` for sketch sub-channels, or have the guess HTTP handler optimistically append to chat log immediately.

**Recommendation:** `self: true` for the sketch sub-channel so the guesser sees their own message in chat via the same broadcast pipeline as everyone else (single source of truth for chat ordering). Strokes don't need this (drawer doesn't need to receive their own strokes back — they're already rendering locally).

This means the channel config differs by event type — fine, we just don't dedupe. For strokes, the drawer never receives them anyway; for guesses, they do. Both work because chat events are low-frequency.

### 8e. Phase transition arrives while previous-phase UI is still rendering

For Bluff Trivia: a player who's slow to render the `phase-vote` UI (because they were in a different tab) might get `phase-reveal` before they've finished setting up the vote view. Handler: latest phase wins. The phase state machine ignores out-of-order events strictly by `phase_seq` (a monotonic counter included in each phase payload):

```ts
type PhaseEvent = { ...; phase_seq: number };

const lastPhaseSeqRef = useRef(0);
channel.on('broadcast', { event: 'phase' }, ({ payload }) => {
  if (payload.phase_seq <= lastPhaseSeqRef.current) return;
  lastPhaseSeqRef.current = payload.phase_seq;
  applyPhase(payload);
});
```

---

## 9. Bandwidth budget

Per the brief, with refinements:

| Quantity                       | Value                  |
|--------------------------------|------------------------|
| Stroke batch size              | ~50–80 bytes (5–15 points + metadata) |
| Batch rate                     | 30 Hz (every 33ms)     |
| Per-drawer outbound            | ~1.5–2.5 KB/sec        |
| Receivers per drawer (max 8 players) | 7              |
| Per-room realtime traffic      | ~10–17 KB/sec sustained during a draw round |
| Off-stroke periods (between rounds, lobby) | ~0           |

### Supabase free-tier check

Supabase Realtime free tier (as of 2026-05): 200 concurrent connections, 2M messages/month. One sketch round (90s of drawing, ~30Hz) is ~2,700 broadcasts. Per round across all receivers, the consumed-message count is one (the broadcaster) — Supabase counts outbound from the server, not fanout deliveries. So 2,700 messages per drawer per round.

A 6-round game with rotating drawers = ~16,000 messages. 100 games/day = 1.6M messages/day. We'd blow the free-tier monthly limit in ~37 days at that scale. **This is the canary** — once Party hits sustained daily play, we move to Supabase Pro ($25/mo, 5M messages) and then scale-tier from there.

For low-DAU launch (first month, expected <50 games/day), we're comfortably under.

### Flag for `dev-performance` later

At 50+ concurrent rooms:
- ~500KB/sec aggregate broadcast outbound.
- Supabase handles fine; client-side, each room is independent and bandwidth-isolated by channel scoping.
- Monitor: Supabase project dashboard's Realtime metrics panel. Set an alert at 70% of monthly message quota.

### What if we hit the wall?

Cheap optimizations before re-architecting:
1. Drop stroke batch rate from 30Hz to 20Hz — barely visible to users, 33% bandwidth savings.
2. Quantize coordinates to 10-unit increments (0-100 effective instead of 0-1000) — smaller payloads, slight loss of smoothness on huge canvases. Acceptable for desktop, may be visible on tablet.
3. Skip persisting strokes <5 points (probably accidental clicks).

If we hit a wall AFTER those, consider a custom Edge Function brokering strokes via a more efficient binary protocol. That's a months-out problem.

---

## 10. Security

The realtime channel is NOT a security boundary. Anyone with a Supabase anon key and the room code can subscribe. Therefore, **all sensitive validation happens server-side, then is broadcast as already-validated outcomes.**

### Stroke validation

The drawer's stroke broadcasts come from the client. A malicious user could spoof "I'm the drawer" and emit strokes from a non-drawer account. To prevent:

- **Persist endpoint validates drawer identity.** `POST /api/party/sketch/strokes` checks `auth.uid() = sketch_rounds.drawer_id` for the current round. Non-drawers get 403.
- **Broadcast events from non-drawers are not validated server-side** because broadcasts skip the server entirely (peer-to-peer through Supabase). The receiver-side defense: receivers track who the current drawer is (from `sketch_rounds.drawer_id` fetched on round start) and **ignore stroke events from any other user_id**. The broadcast payload includes `user_id`:

```ts
channel.on('broadcast', { event: 'stroke' }, ({ payload }) => {
  if (payload.user_id !== currentDrawerId) {
    return;   // silently drop — drawer-spoofing attempt
  }
  applyEventToCanvas(payload);
});
```

Supabase broadcasts include the sender's auth payload via the `meta` field (depending on SDK version) — verify the user_id in the meta matches what's in the payload to prevent payload forgery. If meta isn't available reliably, this defense is "best-effort" — a malicious drawer could spam strokes pretending to be the actual drawer, but the worst outcome is graffiti on the canvas, not data theft.

### Room membership

Every server-side route (`/api/party/*`) must check `party_room_players.user_id = auth.uid() AND room_id = $1`. Anyone subscribed to a channel they're not a room member of will:
- Receive broadcasts (Supabase doesn't gate broadcast distribution by RLS by default).
- Be unable to submit guesses, strokes, votes (server routes reject).

**Mitigation:** the room code is a 6-char obscurity layer. We don't broadcast room codes anywhere public; you have to be invited. For higher security we could move to Supabase's new private-channel + RLS-broadcast feature (`realtime.send` with RLS policies) — flagged as a V2 hardening if we see code-guessing attacks.

### Guess validation

- Server normalizes guess: lowercase, trim, strip punctuation.
- Server normalizes target word identically.
- Levenshtein distance computed server-side; `<= 2 AND distance > 0` = close, `0` = correct.
- Client receives only the outcome flags + own raw guess text. Target word is never sent to clients during round.

### Bluff trivia anti-cheat

- Fake answers validated server-side against truth (case-insensitive fuzzy). Truth-as-fake submissions rejected.
- Vote attribution withheld until reveal phase.
- The trivia question's correct answer is held server-side until `phase-reveal` broadcast — never present in `phase-vote` payload.

### Console logging

Production realtime handlers must have **no `console.log` statements.** They fire often; logs flood the browser console and leak data into customer-support screenshares. Use a `DEBUG_PARTY_REALTIME` env flag at build time if needed:

```ts
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_PARTY_REALTIME === '1';
if (DEBUG) console.log('[party-rt] stroke', payload);
```

---

## Quick reference cheat sheet (for the implementer)

### Channels to create

| Channel name                          | Mount when                             | Unmount when                          |
|---------------------------------------|----------------------------------------|---------------------------------------|
| `party-room-${code}`                  | User enters any `/compete/party/*` route | User leaves all party routes (back to /compete) |
| `party-room-${code}-sketch`           | `/compete/party/sketch` mounts         | User navigates away from sketch       |
| `party-room-${code}-bluff`            | `/compete/party/bluff` mounts          | User navigates away from bluff        |

### Tables to add to `supabase_realtime` publication

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE party_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE party_room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE sketch_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE bluff_rounds;
-- NOT sketch_strokes (too high-frequency; we use broadcast instead)
-- NOT sketch_guesses (broadcast handles it)
-- NOT bluff_answers (privacy — server only)
-- NOT bluff_votes (privacy — server only)
```

### Broadcast event names

| Channel              | Event name      | Direction               | Frequency       |
|----------------------|-----------------|-------------------------|-----------------|
| sketch sub-channel   | `stroke`        | drawer → receivers      | 30 Hz during draw |
| sketch sub-channel   | `undo`          | drawer → receivers      | per-undo        |
| sketch sub-channel   | `clear`         | drawer → receivers      | per-clear       |
| sketch sub-channel   | `guess-outcome` | server → all            | per-guess       |
| sketch sub-channel   | `round-start`   | server → all            | once per round  |
| sketch sub-channel   | `round-end`     | server → all            | once per round  |
| sketch sub-channel   | `factoid`       | server → all            | once after round |
| bluff sub-channel    | `phase`         | server → all            | 3-4 per round   |
| room channel         | `game-start`    | server → all            | once per game   |
| room channel         | `game-end`      | server → all            | once per game   |
| room channel         | `chat-lobby`    | client → all            | per-message     |

### Channel config

```ts
supabase.channel(`party-room-${code}-sketch`, {
  config: {
    broadcast: { self: true, ack: false },  // self: true for chat; false for strokes (handled in code)
    presence: { key: userId },               // room channel only
  },
})
```

For strokes specifically, since `broadcast.self` is a per-channel config and we don't want the drawer to receive their own strokes back, the drawer's client should locally filter `payload.user_id === self.userId` and bail before applying.

### Critical implementation gotchas

1. **Always `removeChannel` on unmount.** Test by navigating in and out of `/sketch` 10 times and watching memory + the Supabase project's realtime panel for orphaned channels.
2. **Server-side filter `postgres_changes` by `room_id`.** Without `filter: 'room_id=eq.${roomId}'`, every client gets every room's update. Same RLS-doesn't-help-Realtime issue as elsewhere.
3. **Stroke num is monotonic per drawer per round.** Reset to 0 on round start. Late joiners use this to dedupe.
4. **Coordinate normalization is 0-1000 integers, not floats.** Saves bytes, avoids float precision drift.
5. **Drawer cannot see chat.** This is enforced client-side only — server still broadcasts, drawer's UI filters. Don't ship a separate "drawer channel" — adds complexity and the cheat protection is the same either way.
6. **Phase events carry a monotonic `phase_seq`.** Out-of-order delivery is rare but possible; the handler must check `phase_seq > lastSeen` before applying.
7. **The unique-correct-guess constraint is partial:** `WHERE was_correct = true`. Otherwise players can't try again after a wrong guess.
8. **Drawer-grace is 60s.** Server-side timer. Don't put this on the client.
9. **No `console.log` in production handlers.** Use a build-time `DEBUG_PARTY_REALTIME` env if you need observability.
10. **Persist strokes on `stroke-end`, from the drawer's client.** Not a server-side debouncer. Simpler, fast enough, correct.

### Files the implementer will likely touch

- `app/compete/party/page.tsx` (lobby — room channel subscription)
- `app/compete/party/sketch/page.tsx` (sketch screen — sketch sub-channel)
- `app/compete/party/bluff/page.tsx` (bluff screen — bluff sub-channel)
- `lib/realtime/party.ts` (new — central wrapper for channel construction, recommended)
- `app/api/party/sketch/strokes/route.ts` (POST = persist, GET = late-joiner replay)
- `app/api/party/sketch/guess/route.ts`
- `app/api/party/bluff/submit-fake/route.ts`
- `app/api/party/bluff/vote/route.ts`
- `app/api/party/bluff/advance-phase/route.ts` (server-authoritative)
- `lib/migrations/0XX_party_tables.sql` (add the publication ALTERs)

### Realtime review report shape (for code review)

When admin submits the implementation for review, the realtime portion will be reviewed against:

```
## Realtime review — party-room channels

Channel name: party-room-${code} / party-room-${code}-sketch / -bluff   ← good
Filter: server-side (postgres_changes filtered by room_id)               ← good if implemented
Cleanup: present in every useEffect                                       ← BLOCKER if missing
Tab-visibility re-sub: heuristic-based (60s staleness threshold)          ← needed
Optimistic-UI rollback: N/A for strokes (broadcast IS the optimism);
                        present for guesses (chat shows immediately)      ← needed
De-dup with cache: stroke_num monotonic + phase_seq monotonic             ← needed
```

---

End of design doc.
