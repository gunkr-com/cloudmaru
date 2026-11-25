-- Freeze validated rule/Advisor source metadata and integrity evidence for historical Assess results.
alter table assessments add column saved_evidence jsonb;
alter table assessments add constraint assessments_saved_evidence_v1 check (
  saved_evidence is null or (status = 'succeeded' and completion_v1(saved_evidence))
);
