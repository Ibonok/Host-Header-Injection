-- Additional indexes for query performance on probes table
CREATE INDEX IF NOT EXISTS idx_probes_http_status ON probes(run_id, http_status);
CREATE INDEX IF NOT EXISTS idx_probes_hit_ip_blacklist ON probes(run_id, hit_ip_blacklist);
