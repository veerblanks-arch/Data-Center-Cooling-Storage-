CREATE TABLE IF NOT EXISTS cooling_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    run_id UUID NOT NULL,
    device_id VARCHAR(80) NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL,
    schema_version VARCHAR(10) NOT NULL DEFAULT '1.1',
    scenario VARCHAR(32) NOT NULL DEFAULT 'legacy',
    severity VARCHAR(12) NOT NULL DEFAULT 'info',
    failure_point VARCHAR(80),
    sensor_status VARCHAR(16) NOT NULL DEFAULT 'online',
    data_quality VARCHAR(16) NOT NULL DEFAULT 'valid',
    scenario_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    server_workload_pct NUMERIC(6,2) NOT NULL
        CHECK (server_workload_pct BETWEEN 0 AND 100),
    inlet_temperature_c NUMERIC(6,2) NOT NULL,
    outlet_temperature_c NUMERIC(6,2) NOT NULL,
    ambient_temperature_c NUMERIC(6,2) NOT NULL,
    cooling_power_kw NUMERIC(7,3) NOT NULL CHECK (cooling_power_kw >= 0),
    chiller_usage_pct NUMERIC(6,2) NOT NULL
        CHECK (chiller_usage_pct BETWEEN 0 AND 100),
    ahu_usage_pct NUMERIC(6,2) NOT NULL
        CHECK (ahu_usage_pct BETWEEN 0 AND 100),
    total_energy_cost_usd NUMERIC(8,4) NOT NULL
        CHECK (total_energy_cost_usd >= 0),
    temperature_deviation_c NUMERIC(6,2) NOT NULL
        CHECK (temperature_deviation_c >= 0),
    cooling_strategy_action VARCHAR(30) NOT NULL,
    cooling_strategy_code SMALLINT NOT NULL
        CHECK (cooling_strategy_code BETWEEN 0 AND 4),
    is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate an existing pre-scenario table in place. Defaults identify old rows
-- without pretending that their original generator recorded a scenario.
ALTER TABLE cooling_events
    ADD COLUMN IF NOT EXISTS schema_version VARCHAR(10)
        NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS scenario VARCHAR(32)
        NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS severity VARCHAR(12)
        NOT NULL DEFAULT 'info',
    ADD COLUMN IF NOT EXISTS failure_point VARCHAR(80),
    ADD COLUMN IF NOT EXISTS sensor_status VARCHAR(16)
        NOT NULL DEFAULT 'online',
    ADD COLUMN IF NOT EXISTS data_quality VARCHAR(16)
        NOT NULL DEFAULT 'valid',
    ADD COLUMN IF NOT EXISTS scenario_details JSONB
        NOT NULL DEFAULT '{}'::jsonb;

-- Old rows predate run-level tracking, so this stays nullable after migration.
ALTER TABLE cooling_events
    ADD COLUMN IF NOT EXISTS run_id UUID;

CREATE INDEX IF NOT EXISTS cooling_events_timestamp_idx
    ON cooling_events (event_timestamp DESC);

CREATE INDEX IF NOT EXISTS cooling_events_action_idx
    ON cooling_events (cooling_strategy_action);

CREATE INDEX IF NOT EXISTS cooling_events_scenario_idx
    ON cooling_events (scenario, severity);
