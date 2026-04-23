"use client";

import { useMemo } from "react";
import { Brain, CheckCircle, XCircle, Lightbulb, Warning, Sparkle, Question } from "@phosphor-icons/react";

/**
 * Renders a single message in the Mastery Mode chat thread. Dispatches on
 * `kind` to the right visual treatment (plain text, teaching panel, question
 * card with pre-answered options, feedback, socratic probe, celebrate).
 *
 * Questions in history render in their *answered* state — the user's
 * selected option is highlighted, the correct one (if known) is marked.
 * Live questions (pending) are rendered via ActionArea, not here.
 */

export interface MessageShape {
  id: string;
  role: "ninny" | "user" | "system";
  kind: string;
  content: string | null;
  payload: Record<string, unknown> | null;
  pPassAfter: number | null;
  displayPctAfter: number | null;
  createdAt: string;
}

interface Props {
  message: MessageShape;
  allMessages: MessageShape[];  // used to look up the answered-state for question cards
}

export default function MasteryMessage({ message, allMessages }: Props) {
  if (message.kind === "text") return <TextBubble m={message} />;
  if (message.kind === "teach") return <TeachCard m={message} />;
  if (message.kind === "question") return <HistoricalQuestion m={message} allMessages={allMessages} />;
  if (message.kind === "answer") return null; // answer is represented inline inside the question card
  if (message.kind === "feedback") return <FeedbackBubble m={message} />;
  if (message.kind === "socratic_probe") return <SocraticProbeBubble m={message} />;
  if (message.kind === "socratic_reply") return <UserReply m={message} />;
  if (message.kind === "celebrate") return <CelebrateCard m={message} />;
  if (message.kind === "narrow") return <TextBubble m={message} />;
  return null;
}

// ── Plain Ninny text ─────────────────────────────────────────────────────────
function TextBubble({ m }: { m: MessageShape }) {
  return (
    <Row avatar="ninny">
      <div className="max-w-[520px] rounded-[10px] rounded-tl-[2px] bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-[14px] leading-relaxed text-cream/90">
        {m.content}
      </div>
    </Row>
  );
}

// ── User reply bubble ───────────────────────────────────────────────────────
function UserReply({ m }: { m: MessageShape }) {
  return (
    <Row avatar="user">
      <div className="max-w-[520px] rounded-[10px] rounded-tr-[2px] bg-gold/[0.08] border border-gold/20 px-4 py-3 text-[14px] leading-relaxed text-cream/95 ml-auto">
        {m.content}
      </div>
    </Row>
  );
}

// ── Teaching card — title, tldr, bullets, optional mnemonic + pitfall ───────
function TeachCard({ m }: { m: MessageShape }) {
  const p = m.payload as {
    title?: string; tldr?: string; bullets?: string[];
    mnemonic?: string | null; commonPitfall?: string | null;
    subtopicName?: string;
  } | null;
  if (!p) return null;

  return (
    <Row avatar="ninny">
      <div className="max-w-[560px] rounded-[12px] rounded-tl-[2px] bg-gradient-to-br from-[#A855F7]/[0.07] to-white/[0.03] border border-[#A855F7]/30 px-4 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Brain size={14} className="text-[#A855F7]" weight="bold" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-[#A855F7]">
            Teach — {p.subtopicName ?? "subtopic"}
          </span>
        </div>
        <h4 className="font-bebas text-[22px] tracking-wider text-cream leading-tight mb-1">{p.title}</h4>
        {p.tldr && <p className="text-[13px] text-cream/75 mb-3 leading-relaxed">{p.tldr}</p>}
        {Array.isArray(p.bullets) && p.bullets.length > 0 && (
          <ul className="flex flex-col gap-1.5 mb-3">
            {p.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-cream/85 leading-relaxed">
                <span className="text-[#A855F7]/60 mt-[6px] shrink-0">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        {p.mnemonic && (
          <div className="flex items-start gap-2 mb-2 rounded-[6px] bg-white/[0.03] border border-white/[0.05] px-3 py-2">
            <Lightbulb size={14} className="text-gold mt-0.5 shrink-0" weight="fill" />
            <span className="text-[12px] text-cream/80 italic">{p.mnemonic}</span>
          </div>
        )}
        {p.commonPitfall && (
          <div className="flex items-start gap-2 rounded-[6px] bg-white/[0.03] border border-white/[0.05] px-3 py-2">
            <Warning size={14} className="text-[#EF4444] mt-0.5 shrink-0" weight="fill" />
            <span className="text-[12px] text-cream/80">{p.commonPitfall}</span>
          </div>
        )}
      </div>
    </Row>
  );
}

// ── Historical question — shows the question + answer state as a single card.
//    For LIVE (unanswered) questions we render ONLY the question text; the
//    option buttons live in MasteryActionArea at the bottom of the chat, so
//    rendering them here too would duplicate them visually.
function HistoricalQuestion({ m, allMessages }: { m: MessageShape; allMessages: MessageShape[] }) {
  const p = m.payload as {
    questionId?: string; options?: string[]; difficulty?: string; subtopicName?: string;
  } | null;

  const answerMsg = useMemo(
    () => allMessages.find(
      x => x.kind === "answer"
        && (x.payload as { questionId?: string })?.questionId === p?.questionId,
    ),
    [allMessages, p?.questionId],
  );
  const feedbackMsg = useMemo(
    () => allMessages.find(
      x => x.kind === "feedback"
        && (x.payload as { questionId?: string })?.questionId === p?.questionId,
    ),
    [allMessages, p?.questionId],
  );

  if (!p) return null;
  const userIdx = (answerMsg?.payload as { selectedIndex?: number })?.selectedIndex;
  const correctIdx = (feedbackMsg?.payload as { correctIndex?: number })?.correctIndex;
  const isAnswered = typeof userIdx === "number";

  return (
    <Row avatar="ninny">
      <div className="max-w-[560px] rounded-[12px] rounded-tl-[2px] bg-white/[0.04] border border-white/[0.08] px-4 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Question size={14} className="text-cream/60" weight="bold" />
          {/* Intentionally no subtopic name — lets the user figure out where
              this question fits from the scenario itself, not a headline. */}
          <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/50">
            Question · {p.difficulty ?? "medium"}
          </span>
        </div>
        <p className={`text-[14px] text-cream/95 leading-relaxed ${isAnswered ? "mb-3" : ""}`}>
          {m.content}
        </p>
        {isAnswered && (
          <div className="flex flex-col gap-1.5">
            {(p.options ?? []).map((opt, i) => {
              const isUser = i === userIdx;
              const isCorrect = i === correctIdx;
              let cls = "border-white/[0.06] bg-white/[0.02] text-cream/70";
              if (isCorrect) cls = "border-[#22C55E]/40 bg-[#22C55E]/[0.08] text-cream";
              else if (isUser) cls = "border-[#EF4444]/40 bg-[#EF4444]/[0.08] text-cream";
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[13px] ${cls}`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider mt-0.5 text-cream/40 shrink-0">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {isCorrect && <CheckCircle size={14} className="text-[#22C55E] shrink-0 mt-0.5" weight="fill" />}
                  {isUser && !isCorrect && <XCircle size={14} className="text-[#EF4444] shrink-0 mt-0.5" weight="fill" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Row>
  );
}

// ── Feedback bubble (correct / incorrect + explanation) ─────────────────────
function FeedbackBubble({ m }: { m: MessageShape }) {
  const p = m.payload as { wasCorrect?: boolean; explanation?: string } | null;
  const wasCorrect = p?.wasCorrect;
  return (
    <Row avatar="ninny">
      <div
        className={`max-w-[560px] rounded-[10px] rounded-tl-[2px] border px-4 py-3 text-[14px] leading-relaxed ${
          wasCorrect === true
            ? "bg-[#22C55E]/[0.06] border-[#22C55E]/25 text-cream"
            : wasCorrect === false
              ? "bg-[#EF4444]/[0.05] border-[#EF4444]/20 text-cream"
              : "bg-white/[0.03] border-white/[0.06] text-cream/90"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          {wasCorrect === true && <CheckCircle size={14} className="text-[#22C55E]" weight="fill" />}
          {wasCorrect === false && <XCircle size={14} className="text-[#EF4444]" weight="fill" />}
          <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/60">
            {wasCorrect === true ? "Right" : wasCorrect === false ? "Miss" : "Ninny"}
          </span>
        </div>
        {m.content && <p className="mb-2">{m.content}</p>}
        {p?.explanation && <p className="text-[13px] text-cream/75 leading-relaxed">{p.explanation}</p>}
      </div>
    </Row>
  );
}

// ── Socratic probe (Ninny asking "why did you pick that?") ──────────────────
function SocraticProbeBubble({ m }: { m: MessageShape }) {
  return (
    <Row avatar="ninny">
      <div className="max-w-[520px] rounded-[10px] rounded-tl-[2px] bg-[#A855F7]/[0.05] border border-[#A855F7]/25 px-4 py-3 text-[14px] leading-relaxed text-cream">
        {m.content}
      </div>
    </Row>
  );
}

// ── Mastery celebration card ────────────────────────────────────────────────
function CelebrateCard({ m }: { m: MessageShape }) {
  return (
    <Row avatar="ninny">
      <div className="max-w-[560px] rounded-[12px] rounded-tl-[2px] bg-gradient-to-br from-gold/[0.12] to-white/[0.03] border border-gold/40 px-4 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkle size={14} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-gold">Mastery</span>
        </div>
        <h4 className="font-bebas text-[26px] tracking-wider text-cream leading-tight mb-1">You've got it.</h4>
        <p className="text-[13px] text-cream/80 leading-relaxed">{m.content}</p>
      </div>
    </Row>
  );
}

// ── Row wrapper with role-specific alignment + avatar slot ──────────────────
function Row({ avatar, children }: { avatar: "ninny" | "user"; children: React.ReactNode }) {
  return (
    <div className={`flex gap-3 ${avatar === "user" ? "flex-row-reverse" : ""}`}>
      <div
        className={`shrink-0 w-[28px] h-[28px] rounded-full grid place-items-center text-[10px] font-mono tracking-wider ${
          avatar === "ninny"
            ? "bg-[#A855F7]/[0.15] border border-[#A855F7]/30 text-[#A855F7]"
            : "bg-gold/[0.12] border border-gold/30 text-gold"
        }`}
      >
        {avatar === "ninny" ? "N" : "U"}
      </div>
      <div className={`flex-1 ${avatar === "user" ? "flex justify-end" : ""}`}>{children}</div>
    </div>
  );
}
