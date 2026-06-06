-- Bluff Trivia: allow a single user to own both the truth row and their fake
-- in the same round.
--
-- Original constraint `UNIQUE (round_id, user_id)` collided when the round
-- creator (host) tried to submit a fake: the round-create endpoint inserts
-- the truth row with the creator's user_id as a FK placeholder, so the host's
-- subsequent fake insert violated the unique key and returned 500
-- "Couldn't save answer".
--
-- Replace with `UNIQUE (round_id, user_id, is_truth)` so each user can have at
-- most one truth row AND at most one fake row per round. All other invariants
-- (one fake per user per round, one truth per round) remain enforced.

DO $$
DECLARE
  cn text;
BEGIN
  -- Drop whatever name the original inline UNIQUE got auto-assigned.
  FOR cn IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'bluff_answers'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 2
  LOOP
    EXECUTE format('ALTER TABLE bluff_answers DROP CONSTRAINT %I', cn);
  END LOOP;
END $$;

ALTER TABLE bluff_answers
  DROP CONSTRAINT IF EXISTS bluff_answers_round_user_truth_key;

ALTER TABLE bluff_answers
  ADD CONSTRAINT bluff_answers_round_user_truth_key
  UNIQUE (round_id, user_id, is_truth);
