# Scripts

## auto-generate-questions.ts

Automatically generates quiz questions using Claude Haiku and seeds them into Supabase. Runs hourly via GitHub Actions.

### How it works

1. Checks Supabase for existing question counts per subject/topic/difficulty
2. For any combo below `TARGET_COUNT` (default: 100), calls Claude Haiku to generate missing questions
3. Validates the JSON output (4 options, correct answer matches, all fields present)
4. Saves generated questions to `questions/<subject>/<topic>/` as JSON
5. Upserts into the Supabase `questions` table with deterministic UUIDs (idempotent)

### Adding new subjects to the priority list

Edit the `PRIORITY_COMBOS` array in `auto-generate-questions.ts`:

```ts
const PRIORITY_COMBOS = [
  // Existing
  { subject: "Science", topic: "astronomy", difficulty: "beginner" },
  { subject: "Science", topic: "astronomy", difficulty: "intermediate" },
  { subject: "Science", topic: "astronomy", difficulty: "advanced" },

  // Add new combos here:
  { subject: "Science", topic: "geology", difficulty: "beginner" },
  { subject: "Math", topic: "calculus", difficulty: "advanced" },
  { subject: "Coding", topic: "python", difficulty: "beginner" },
];
```

The `subject` value must match what the app expects (e.g. "Science", "Math", "Coding"). The `topic` is freeform. The `difficulty` must be one of: `beginner`, `intermediate`, `advanced`.

### Running locally

```bash
# Requires ANTHROPIC_API_KEY in .env.local (or exported)
npx tsx scripts/auto-generate-questions.ts
```

### Config

| Constant | Default | Description |
|---|---|---|
| `TARGET_COUNT` | 100 | Questions per subject/topic/difficulty combo |
| `MAX_COMBOS_PER_RUN` | 3 | Max combos processed per run (cost control) |
| `QUESTIONS_PER_REQUEST` | 20 | Questions requested per Claude API call |
| `BATCH_SIZE` | 50 | Supabase upsert batch size |

### Required GitHub Secrets

- `ANTHROPIC_API_KEY` — Anthropic API key for Claude Haiku
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (not the anon key)
