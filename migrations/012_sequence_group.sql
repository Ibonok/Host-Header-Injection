-- Add run_type column to differentiate standard runs from sequence-group runs
ALTER TABLE runs ADD COLUMN run_type TEXT NOT NULL DEFAULT 'standard';

-- New table for sequence-group per-request timing results
CREATE TABLE IF NOT EXISTS sequence_group_results (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    probe_id BIGINT REFERENCES probes(id) ON DELETE SET NULL,
    sequence_index INTEGER NOT NULL,
    connection_reused BOOLEAN NOT NULL DEFAULT FALSE,
    dns_time_ms INTEGER,
    tcp_connect_time_ms INTEGER,
    tls_handshake_time_ms INTEGER,
    time_to_first_byte_ms INTEGER,
    total_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sgr_run_id ON sequence_group_results(run_id);
CREATE INDEX IF NOT EXISTS idx_sgr_probe_id ON sequence_group_results(probe_id);
