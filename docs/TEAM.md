# Team & Workflow

## Team Members

| Name | Role | Git Workflow |
|------|------|-------------|
| **Sam** | Lead | Pushes directly to `main` |
| **Santy** | Contributor | Must use branches and submit PRs |
| **Ethan** | Contributor | Must use branches and submit PRs |

## Workflow Rules

### SQL Before Code
Always run Supabase migrations before any Claude Code prompts that depend on schema changes. The database must be ready before the code that uses it.

### PR Process (Santy & Ethan)
1. Create a feature branch from `main`
2. Make changes and commit
3. Push branch and open a PR against `main`
4. Wait for review before merging
5. Never push directly to `main`

### Commit Discipline
- **Commit after every change** — small, atomic commits
- **Never push** unless explicitly told to
- Never push broken builds to main
- Any Supabase schema change must include a migration file at `lib/migrations/00X_description.sql`

### Claude Code Rules
- Always read `CLAUDE_AGENT.md` before starting any task
- Be concise — don't show full file contents in responses
- Commit locally, never push unless told
