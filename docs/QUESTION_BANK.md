# Question Bank

## Directory Structure

```
questions/
  math/
    math-{difficulty}-{topic}{number}.json
  science/
    {topic}-{difficulty}{number}.json
```

## Subjects Seeded

### Math
| Topic | Beginner | Intermediate | Advanced |
|-------|----------|-------------|----------|
| Algebra | 4 files | 4 files | 4 files |
| Geometry | 4 files | 4 files | 4 files |
| Calculus | 1 file | 1 file | 1 file |
| Statistics | 1 file | 1 file | 1 file |
| Trigonometry | 1 file | 1 file | 1 file |

### Science
| Topic | Beginner | Intermediate | Advanced |
|-------|----------|-------------|----------|
| Biology | 1 file | 1 file | 1 file |
| Chemistry | 1 file | 1 file | 1 file |
| Physics | 1 file | 1 file | 1 file |
| Earth Science | 1 file | 1 file | 1 file |
| Astronomy | 1 file | 1 file | 1 file |

## File Naming Convention

- **Math:** `math-beginner-algebra1.json`, `math-intermediate-geometry2.json`, `math-advanced-calculus1.json`
- **Science:** `biology-beginner1.json`, `chemistry-advanced1.json`, `earth-science-intermediate1.json`

## Seed Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/seed-questions.ts` | `npx tsx scripts/seed-questions.ts` | Seeds ALL questions from `questions/` into Supabase |
| `scripts/seed-science.ts` | `npx tsx scripts/seed-science.ts` | Seeds science questions only (skips astronomy) |
| `scripts/auto-generate-questions.ts` | `npx tsx scripts/auto-generate-questions.ts` | Auto-generates question JSON files |

- All scripts read credentials from `.env.local`
- Batch-insert in groups of 50
- Use deterministic UUIDs (hash-based) to avoid duplicates on re-run

## GitHub Actions Pipeline

- **Auto question generation** pipeline added 2026-03-17
- Automatically generates and seeds new questions on schedule
- See `.github/workflows/` for pipeline configuration
