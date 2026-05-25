-- 023_structured_hard_reqs.sql
--
-- Move from LLM-classified hard_reqs_class to LLM-extracted structured hard
-- requirements that are evaluated deterministically in application code.
--
-- New column: hard_reqs_struct stores the full structured JSON emitted by the
-- scoring LLM (yoe_min, tech_stack_required, languages_required, …). The
-- existing hard_reqs_class column is kept but its value is now derived in code
-- from the structured data rather than chosen by the model.
--
-- All prior affinity results are cleared so they re-score under the new logic.

ALTER TABLE job_postings ADD COLUMN hard_reqs_struct TEXT;  -- JSON, see core/jobs/scorer.ts

UPDATE job_postings
SET affinity_score      = NULL,
    affinity_scored_at  = NULL,
    affinity_reasoning  = NULL,
    description_snippet = NULL,
    hard_reqs_class     = NULL,
    nice_to_haves_class = NULL,
    hard_reqs_struct    = NULL;
