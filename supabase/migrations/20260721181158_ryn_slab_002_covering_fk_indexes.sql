-- ============================================================================
-- APPLIED 2026-07-21 as Supabase migration 20260721181158 after local runtime proof.
-- Exact additive follow-up for Supabase performance advisor findings.
-- ============================================================================

begin;

create index strategy_lab_versions_strategy_user_idx
  on private.strategy_lab_versions (strategy_id, user_id);

create index strategy_lab_imports_experiment_strategy_user_idx
  on private.strategy_lab_imports (experiment_id, strategy_id, user_id);

create index strategy_lab_evidence_experiment_strategy_user_idx
  on private.strategy_lab_evidence_reports (experiment_id, strategy_id, user_id);

commit;
