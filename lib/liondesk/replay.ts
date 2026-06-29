// LionDesk shift replay (Idea 36). A pure, framework-free builder that turns a
// finished shift's final State into an ordered, decision by decision timeline so
// a player can walk back through the shift one item at a time and re-read the
// lesson on each move.
//
// Everything here is derived from State that is already in scope at shift end
// (the per item runtime plus the authored ActionCard labels and teach strings),
// so there is nothing to store, nothing to hydrate, and no economy: it grants
// no Fangs and never touches localStorage or the server. The Fangs/XP a shift
// reports stay a preview that only the server can clamp and bank.
//
// No React, no DOM, no localStorage import here. That keeps the builder unit
// testable and safe to call from the client report component. engine.ts does not
// import this file, so there is no import cycle.

import type { Shift } from "./types";
import { type State, type ItemStatus, GOOD_STATUSES, isLive } from "./engine";

/** One resolved or mishandled item, as a single step in the replay timeline. */
export interface ReplayDecision {
  /** The shift item this decision belongs to. */
  itemId: string;
  /** 1 based position in the timeline, ordered the way the shift unfolded. */
  step: number;
  /** The item subject, the headline the player saw in the queue. */
  subject: string;
  /** The terminal status the item landed in. */
  status: ItemStatus;
  /** Whether the move was the correct one (a clean resolve) or a fumble. */
  correct: boolean;
  /**
   * The label of the action the player committed, or null when no fix was
   * committed (a caller hung up, the SLA ran out, or the item resolved itself
   * as part of an incident fix).
   */
  actionLabel: string | null;
  /**
   * The teach note for the move, the "why". Falls back to the correct action's
   * note when no action was committed, so the lesson always lands.
   */
  teach: string;
  /** The correct action's label, for showing the right move on a miss. Null if the item has no authored correct action. */
  correctLabel: string | null;
  /** The correct action's teach note, paired with correctLabel. */
  correctTeach: string | null;
}

/**
 * Build the ordered replay timeline from the final shift state.
 *
 * Only items that actually reached a decision are included: those resolved well
 * (any GOOD_STATUSES outcome) or mishandled. Items left open when the clock ran
 * out are not decisions, so they are skipped (the report lists those separately).
 *
 * Order is chronological by when each item landed in the queue (landedAt),
 * falling back to its scheduled arrival, then its authored order, so the walk
 * follows the shift the way it played out. Pure: no side effects, no storage.
 */
export function buildReplayTimeline(shift: Shift, state: State): ReplayDecision[] {
  const decided = shift.items.filter((i) => {
    if (!isLive(i, state.items)) return false;
    const status = state.items[i.id].status;
    return GOOD_STATUSES.includes(status) || status === "mishandled";
  });

  const ordered = decided
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const la = state.items[a.item.id].landedAt ?? a.item.arriveAfter;
      const lb = state.items[b.item.id].landedAt ?? b.item.arriveAfter;
      if (la !== lb) return la - lb;
      return a.idx - b.idx;
    })
    .map((entry) => entry.item);

  return ordered.map((item, n) => {
    const rt = state.items[item.id];
    const chosen = rt.chosenActionId ? item.actions.find((act) => act.id === rt.chosenActionId) ?? null : null;
    const right = item.actions.find((act) => act.correct) ?? null;
    // A committed action carries its own correctness; an item with no committed
    // action (an incident mass resolve, or a hangup) is judged by its outcome.
    const correct = chosen ? !!chosen.correct : GOOD_STATUSES.includes(rt.status);
    return {
      itemId: item.id,
      step: n + 1,
      subject: item.subject,
      status: rt.status,
      correct,
      actionLabel: chosen ? chosen.label : null,
      teach: (chosen && chosen.teach) || right?.teach || "",
      correctLabel: right ? right.label : null,
      correctTeach: right ? right.teach : null,
    };
  });
}
