-- 024_posting_required_seniorities.sql
--
-- Record the seniority restrictions of the search term that fetched each
-- posting. Used after scoring to drop postings whose final (LLM-determined)
-- seniority doesn't match — the cheap regex pre-classifier returns 'any' too
-- often to gate at insert time, so we defer the decision until scoring.

ALTER TABLE job_postings
  ADD COLUMN required_seniorities TEXT;  -- JSON array of intern/junior/mid/senior/staff, or NULL = no restriction
