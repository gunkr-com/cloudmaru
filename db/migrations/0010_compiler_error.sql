-- Preserve the closed completion error envelope; add the local Extend compiler environment reason.
create or replace function completion_error_v1(payload jsonb) returns boolean
language sql immutable as $$
  select coalesce(completion_v1(payload) and payload - 'schemaVersion' - 'code' = '{}'::jsonb
    and payload->>'code' in ('missing-data', 'invalid-data', 'unsupported-type', 'unsupported-region',
      'unsupported-path', 'unsupported-service-tag', 'no-applicable-rule', 'policy-not-configured',
      'scope-not-collected', 'collection-partial', 'legacy-completeness-unknown', 'import-scope-unverified', 'context-limit',
      'redacted', 'unmapped-advisor-type', 'price-unavailable', 'capacity-unverified', 'forbidden',
      'not-configured', 'not-supported', 'auth-failed', 'timeout', 'throttled', 'invalid-response',
      'validation-failed', 'compiler-unavailable', 'interrupted', 'internal', 'no-data'), false)
$$;
