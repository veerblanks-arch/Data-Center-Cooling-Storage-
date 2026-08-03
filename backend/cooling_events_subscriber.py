#!/usr/bin/env python3
"""Read cooling events from MQTT, print them, and optionally write PostgreSQL."""

import argparse
import json
import os
import uuid
from datetime import datetime

import paho.mqtt.client as mqtt
import psycopg2
from psycopg2.extras import Json
from psycopg2 import sql

from cooling_run_utils import normalize_run_id, table_name_for_run


# PROJECT-SPECIFIC CHANGE: These action names and numeric codes come from the
# data-center cooling model. A general listener should load this mapping from a
# student configuration file instead of defining it in the listener.
ACTION_CODES = {
    "Increase Chiller": 0,
    "Reduce AHU": 1,
    "Maintain": 2,
    "Boost All": 3,
    "Eco Mode": 4,
}

# PROJECT-SPECIFIC CHANGE: Scenario metadata lets the same topic carry normal
# observations and explicit user-story tests without guessing from readings.
SCENARIOS = {
    "normal",
    "outlier",
    "cooling_failure",
    "workload_spike",
    "sensor_fault",
}
SEVERITIES = {"info", "warning", "critical"}
SENSOR_STATUSES = {"online", "degraded", "fault"}
DATA_QUALITIES = {"valid", "suspect"}

# PROJECT-SPECIFIC CHANGE: The listener now validates the cooling JSON schema
# before printing or inserting an event. These fields must be configurable for
# students whose projects publish different JSON payloads.
REQUIRED_FIELDS = {
    "schema_version",
    "event_id",
    "run_id",
    "device_id",
    "timestamp",
    "scenario",
    "severity",
    "failure_point",
    "sensor_status",
    "data_quality",
    "scenario_details",
    "server_workload_pct",
    "inlet_temperature_c",
    "outlet_temperature_c",
    "ambient_temperature_c",
    "cooling_power_kw",
    "chiller_usage_pct",
    "ahu_usage_pct",
    "total_energy_cost_usd",
    "temperature_deviation_c",
    "cooling_strategy_action",
    "cooling_strategy_code",
    "is_outlier",
}

# PROJECT-SPECIFIC CHANGE: Numeric validation is based on the cooling dataset.
# A general listener should receive its field types from configuration.
NUMERIC_FIELDS = {
    "server_workload_pct",
    "inlet_temperature_c",
    "outlet_temperature_c",
    "ambient_temperature_c",
    "cooling_power_kw",
    "chiller_usage_pct",
    "ahu_usage_pct",
    "total_energy_cost_usd",
    "temperature_deviation_c",
}
DEFAULT_DSN = "dbname=iot_platform user=veer host=localhost port=5432"


def parse_args():
    """Read connection controls while keeping localhost defaults demo-friendly."""
    # REUSABLE CHANGE: Broker, port, topic, and database settings can be passed
    # on the command line instead of being permanently hard-coded.
    parser = argparse.ArgumentParser(
        description="Print cooling MQTT events and optionally store them."
    )
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    # PROJECT-SPECIFIC CHANGE: This topic separates cooling events from the
    # original hardware telemetry stream at devices/telemetry.
    parser.add_argument("--topic", default="devices/cooling/events")
    parser.add_argument(
        "--write-db",
        action="store_true",
        help="Enable PostgreSQL writes. Without this flag, console-only mode is used.",
    )
    parser.add_argument(
        "--init-db",
        action="store_true",
        help="Create the cooling_events table if it does not exist.",
    )
    parser.add_argument(
        "--dsn",
        default=os.environ.get("POSTGRES_DSN", DEFAULT_DSN),
        help="PostgreSQL DSN (or set POSTGRES_DSN).",
    )
    return parser.parse_args()


def validate_event(data):
    """Validate the event envelope, scenario metadata, and cooling readings."""
    # PROJECT-SPECIFIC CHANGE: Reject malformed or incomplete cooling events so
    # bad JSON cannot be silently written into the PostgreSQL table.
    missing = REQUIRED_FIELDS - data.keys()
    if missing:
        raise ValueError(f"Missing fields: {', '.join(sorted(missing))}")

    for field in NUMERIC_FIELDS:
        if isinstance(data[field], bool) or not isinstance(data[field], (int, float)):
            raise ValueError(f"{field} must be numeric")

    if data["schema_version"] != "1.1":
        raise ValueError(f"Unsupported schema_version: {data['schema_version']!r}")
    try:
        uuid.UUID(data["event_id"])
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("event_id must be a valid UUID") from error
    try:
        data["run_id"] = normalize_run_id(data["run_id"])
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("run_id must be a valid UUID") from error
    if not isinstance(data["device_id"], str) or not data["device_id"].strip():
        raise ValueError("device_id must be a non-empty string")

    if data["scenario"] not in SCENARIOS:
        raise ValueError(f"Unknown scenario: {data['scenario']!r}")
    if data["severity"] not in SEVERITIES:
        raise ValueError(f"Unknown severity: {data['severity']!r}")
    if data["sensor_status"] not in SENSOR_STATUSES:
        raise ValueError(f"Unknown sensor_status: {data['sensor_status']!r}")
    if data["data_quality"] not in DATA_QUALITIES:
        raise ValueError(f"Unknown data_quality: {data['data_quality']!r}")
    if data["failure_point"] is not None and not isinstance(
        data["failure_point"], str
    ):
        raise ValueError("failure_point must be a string or null")
    if not isinstance(data["scenario_details"], dict):
        raise ValueError("scenario_details must be a JSON object")

    action = data["cooling_strategy_action"]
    if action not in ACTION_CODES:
        raise ValueError(f"Unknown cooling_strategy_action: {action!r}")
    if data["cooling_strategy_code"] != ACTION_CODES[action]:
        raise ValueError("cooling_strategy_code does not match the action")
    if not isinstance(data["is_outlier"], bool):
        raise ValueError("is_outlier must be true or false")

    timestamp = datetime.fromisoformat(data["timestamp"])
    return timestamp


def create_table(conn):
    """Create or migrate the cooling table without discarding existing events."""
    # PROJECT-SPECIFIC CHANGE: This table schema maps one-to-one to the fields
    # published by cooling_events_generator.py. Other projects need a different
    # table definition or a configurable field-to-column mapping.
    with conn.cursor() as cursor:
        cursor.execute(
            """
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
                cooling_power_kw NUMERIC(7,3) NOT NULL
                    CHECK (cooling_power_kw >= 0),
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
            ALTER TABLE cooling_events
                ADD COLUMN IF NOT EXISTS run_id UUID;
            CREATE INDEX IF NOT EXISTS cooling_events_timestamp_idx
                ON cooling_events (event_timestamp DESC);
            CREATE INDEX IF NOT EXISTS cooling_events_action_idx
                ON cooling_events (cooling_strategy_action);
            CREATE INDEX IF NOT EXISTS cooling_events_scenario_idx
                ON cooling_events (scenario, severity);
            """
        )
    conn.commit()


def write_event(conn, data, timestamp):
    """Insert one validated event and ignore duplicate QoS redeliveries."""
    # PROJECT-SPECIFIC CHANGE: Map the cooling JSON keys to cooling_events
    # columns. event_id is unique, so duplicate MQTT messages are ignored.
    with conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO cooling_events (
                event_id, run_id, device_id, event_timestamp, server_workload_pct,
                schema_version, scenario, severity, failure_point,
                sensor_status, data_quality, scenario_details,
                inlet_temperature_c, outlet_temperature_c,
                ambient_temperature_c, cooling_power_kw, chiller_usage_pct,
                ahu_usage_pct, total_energy_cost_usd,
                temperature_deviation_c, cooling_strategy_action,
                cooling_strategy_code, is_outlier
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (event_id) DO NOTHING
            """,
            (
                data["event_id"],
                data["run_id"],
                data["device_id"],
                timestamp,
                data["server_workload_pct"],
                data["schema_version"],
                data["scenario"],
                data["severity"],
                data["failure_point"],
                data["sensor_status"],
                data["data_quality"],
                Json(data["scenario_details"]),
                data["inlet_temperature_c"],
                data["outlet_temperature_c"],
                data["ambient_temperature_c"],
                data["cooling_power_kw"],
                data["chiller_usage_pct"],
                data["ahu_usage_pct"],
                data["total_energy_cost_usd"],
                data["temperature_deviation_c"],
                data["cooling_strategy_action"],
                data["cooling_strategy_code"],
                data["is_outlier"],
            ),
        )
        run_table = sql.Identifier(table_name_for_run(data["run_id"]))
        cursor.execute(
            sql.SQL("CREATE TABLE IF NOT EXISTS {} (LIKE cooling_events INCLUDING ALL)").format(run_table)
        )
        cursor.execute(
            sql.SQL("INSERT INTO {} SELECT * FROM cooling_events WHERE event_id = %s ON CONFLICT (event_id) DO NOTHING").format(run_table),
            (data["event_id"],),
        )
    conn.commit()


def print_event(data):
    """Print an operator-readable event summary before any database write."""
    # PROJECT-SPECIFIC CHANGE: Console formatting highlights values relevant to
    # cooling optimization rather than temperature/humidity/pressure sensors.
    print("\n" + "=" * 70)
    print(
        f"COOLING EVENT {data['event_id']} | "
        f"{data['timestamp']} | {data['device_id']}"
    )
    print("-" * 70)
    print(
        f"Workload: {data['server_workload_pct']:6.2f}% | "
        f"Inlet: {data['inlet_temperature_c']:5.2f} C | "
        f"Outlet: {data['outlet_temperature_c']:5.2f} C | "
        f"Ambient: {data['ambient_temperature_c']:5.2f} C"
    )
    print(
        f"Cooling power: {data['cooling_power_kw']:5.2f} kW | "
        f"Chiller: {data['chiller_usage_pct']:6.2f}% | "
        f"AHU: {data['ahu_usage_pct']:6.2f}% | "
        f"Cost: ${data['total_energy_cost_usd']:.2f}"
    )
    print(
        f"Deviation: {data['temperature_deviation_c']:.2f} C | "
        f"Action: {data['cooling_strategy_action']} "
        f"({data['cooling_strategy_code']}) | "
        f"Outlier: {data['is_outlier']}"
    )
    print(
        f"Scenario: {data['scenario']} | Severity: {data['severity']} | "
        f"Sensor: {data['sensor_status']} | Quality: {data['data_quality']} | "
        f"Failure point: {data['failure_point'] or 'none'}"
    )
    print(f"Generator run: {data['run_id']}")


def main():
    """Subscribe, validate each message, display it, and optionally store it."""
    args = parse_args()
    db_conn = None
    if args.write_db or args.init_db:
        db_conn = psycopg2.connect(args.dsn)
    if args.write_db or args.init_db:
        create_table(db_conn)
        print("PostgreSQL table cooling_events is ready.")

    mode = "console + PostgreSQL" if args.write_db else "console only"
    print(
        f"Cooling subscriber active | {mode} | "
        f"MQTT {args.broker}:{args.port} | topic={args.topic}"
    )

    def on_message(client, userdata, msg):
        try:
            # REUSABLE FLOW: Decode JSON, validate it, print it, then optionally
            # write it to PostgreSQL. Only the validation, display, and database
            # mapping functions above are specific to this cooling project.
            data = json.loads(msg.payload.decode("utf-8"))
            timestamp = validate_event(data)
            print_event(data)
            if db_conn is not None and args.write_db:
                write_event(db_conn, data, timestamp)
                print("Database write: OK")
        except Exception as exc:
            if db_conn is not None:
                db_conn.rollback()
            print(f"[REJECTED EVENT] {exc}")

    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    client.on_message = on_message
    client.connect(args.broker, args.port, 60)
    client.subscribe(args.topic, qos=1)

    try:
        client.loop_forever()
    except KeyboardInterrupt:
        print("\nSubscriber stopped.")
    finally:
        client.disconnect()
        if db_conn is not None:
            db_conn.close()


if __name__ == "__main__":
    main()
