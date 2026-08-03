#!/usr/bin/env python3
"""Serve the cooling dashboard and expose committed PostgreSQL events as SSE.

The bridge is the browser-safe final hop. The terminal generator and subscriber
remain the only event producers; the page does not synthesize replacement rows.
"""

import argparse
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psycopg2


DEFAULT_DSN = "dbname=iot_platform user=veer host=localhost port=5432"
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1] / "frontend"


def json_value(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "__float__") and not isinstance(value, (str, bool)):
        return float(value)
    return value


class EventReader:
    columns = (
        "id", "event_id", "device_id", "timestamp", "schema_version", "scenario",
        "severity", "failure_point", "sensor_status", "data_quality", "scenario_details",
        "server_workload_pct", "inlet_temperature_c", "outlet_temperature_c",
        "ambient_temperature_c", "cooling_power_kw", "chiller_usage_pct", "ahu_usage_pct",
        "total_energy_cost_usd", "temperature_deviation_c", "cooling_strategy_action",
        "cooling_strategy_code", "is_outlier",
    )

    def __init__(self, dsn):
        self.dsn = dsn

    def read(self, after_id=0, limit=25):
        with psycopg2.connect(self.dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT id,event_id,device_id,event_timestamp,schema_version,scenario,
                    severity,failure_point,sensor_status,data_quality,scenario_details,
                    server_workload_pct,inlet_temperature_c,outlet_temperature_c,
                    ambient_temperature_c,cooling_power_kw,chiller_usage_pct,ahu_usage_pct,
                    total_energy_cost_usd,temperature_deviation_c,cooling_strategy_action,
                    cooling_strategy_code,is_outlier FROM cooling_events
                    WHERE id > %s ORDER BY id ASC LIMIT %s""",
                    (after_id, limit),
                )
                return [self.event(row) for row in cursor.fetchall()]

    def current_id(self):
        with psycopg2.connect(self.dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COALESCE(MAX(id), 0) FROM cooling_events")
                return int(cursor.fetchone()[0])

    def event(self, row):
        event = {key: json_value(value) for key, value in zip(self.columns, row)}
        event["_db_id"] = event.pop("id")
        return event


class BridgeHandler(SimpleHTTPRequestHandler):
    reader = None
    poll_seconds = 0.5

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/api/events":
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        requested_cursor = self.headers.get("Last-Event-ID", "")
        try:
            cursor = int(requested_cursor) if requested_cursor else self.reader.current_id()
        except ValueError:
            cursor = self.reader.current_id()
        try:
            while True:
                for event in self.reader.read(cursor):
                    cursor = max(cursor, int(event["_db_id"]))
                    payload = json.dumps(event, separators=(",", ":"), default=json_value)
                    self.wfile.write(f"id: {cursor}\ndata: {payload}\n\n".encode())
                self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
                time.sleep(self.poll_seconds)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description="Serve the cooling dashboard and PostgreSQL event stream.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--poll-ms", type=int, default=500)
    parser.add_argument("--dsn", default=os.environ.get("POSTGRES_DSN", DEFAULT_DSN))
    parser.add_argument("--web-root", type=Path, default=DEFAULT_WEB_ROOT)
    args = parser.parse_args()
    if not args.web_root.is_dir():
        raise SystemExit(f"Dashboard directory does not exist: {args.web_root}")
    BridgeHandler.reader = EventReader(args.dsn)
    BridgeHandler.poll_seconds = max(0.1, args.poll_ms / 1000)
    handler = lambda *a, **kw: BridgeHandler(*a, directory=str(args.web_root), **kw)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Cooling dashboard: http://{args.host}:{args.port}/domain-cooling.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
