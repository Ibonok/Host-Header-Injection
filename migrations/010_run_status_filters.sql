-- Add status filter storage for directory-path runs
ALTER TABLE runs ADD COLUMN status_filters_json TEXT;
