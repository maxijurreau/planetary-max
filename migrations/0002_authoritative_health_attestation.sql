-- Migration: 0002_authoritative_health_attestation.sql
-- Durable node heartbeats and append-only attestation probe history.

CREATE TABLE IF NOT EXISTS node_heartbeats (
    node_id TEXT PRIMARY KEY,
    worker_environment TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('HEALTHY', 'DEGRADED', 'UNREACHABLE')),
    active_isolates INTEGER NOT NULL DEFAULT 1,
    qal_signature TEXT NOT NULL,
    last_tick_timestamp INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attestation_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    probe_type TEXT NOT NULL CHECK(probe_type IN ('WIRING_DIAGNOSTIC', 'AUTHORITATIVE_LEASE')),
    latency_ms REAL NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_tick ON node_heartbeats(last_tick_timestamp);
CREATE INDEX IF NOT EXISTS idx_attestation_node_time ON attestation_logs(node_id, timestamp);
