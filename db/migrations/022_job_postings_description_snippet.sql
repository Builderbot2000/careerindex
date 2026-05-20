-- 022_job_postings_description_snippet.sql
-- Adds description_snippet column: a verbatim ~400-char excerpt from
-- raw_text capturing the role-summary portion (e.g. "X is hiring a Y to do Z"),
-- extracted by the affinity scoring LLM at scoring time. Used to populate
-- the role-hover tooltip on the job board / tracker without re-reading raw_text
-- (which is nulled out when a posting is archived).

ALTER TABLE job_postings ADD COLUMN description_snippet TEXT;
