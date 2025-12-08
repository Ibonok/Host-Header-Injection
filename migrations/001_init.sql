CREATE TABLE IF NOT EXISTS runs (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS probes (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    tested_host_header TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    status_text TEXT,
    bytes_total INTEGER NOT NULL,
    response_time_ms INTEGER,
    snippet_b64 TEXT,
    screenshot_path TEXT,
    raw_response_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_probes_run_id ON probes(run_id);
CREATE INDEX IF NOT EXISTS idx_probes_target_host ON probes(target_url, tested_host_header);

CREATE TABLE IF NOT EXISTS aggregates (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
    matrix_json TEXT,
    status_distribution_json TEXT,
    latency_stats_json TEXT,
    diffs_json TEXT,
    summary_421_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
