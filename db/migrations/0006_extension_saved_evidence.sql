-- Retain private, validated catalog evidence for historical Extend reads.
-- Legacy successes remain readable through strict current-catalog validation.
alter table extensions add column saved_evidence jsonb;
alter table extensions add constraint extensions_saved_evidence_v1 check (
  saved_evidence is null or (status = 'succeeded' and completion_v1(saved_evidence))
);
