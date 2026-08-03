#!/usr/bin/env python3
"""Generate scenario-aware data-center cooling events and publish them to MQTT.

The historical CSV supplies coherent baseline observations. Named scenarios then
leave those readings alone or apply a small, documented mutation so the rest of
the pipeline can test normal traffic, statistical outliers, equipment failures,
workload spikes, and bad sensor data.
"""

import argparse
import csv
import json
import random
import time
import uuid
from datetime import datetime
from pathlib import Path

import paho.mqtt.client as mqtt

from cooling_run_utils import normalize_run_id


DEFAULT_DATASET = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "datasets"
    / "cold_source_control_dataset.csv"
)
SCHEMA_VERSION = "1.1"
ACTION_CODES = {
    "Increase Chiller": 0,
    "Reduce AHU": 1,
    "Maintain": 2,
    "Boost All": 3,
    "Eco Mode": 4,
}
SCENARIOS = (
    "normal",
    "outlier",
    "cooling_failure",
    "workload_spike",
    "sensor_fault",
)
TRAINING_HEADERS = (
    "Timestamp",
    "Server_Workload(%)",
    "Inlet_Temperature(°C)",
    "Outlet_Temperature(°C)",
    "Ambient_Temperature(°C)",
    "Cooling_Unit_Power_Consumption(kW)",
    "Chiller_Usage(%)",
    "AHU_Usage(%)",
    "Total_Energy_Cost($)",
    "Temperature_Deviation(°C)",
    "Cooling_Strategy_Action",
    "Output",
    "scenario",
    "severity",
    "failure_point",
    "sensor_status",
    "data_quality",
    "is_outlier",
    "event_id",
    "run_id",
)


def parse_args():
    """Parse and validate all runtime controls for repeatable demonstrations."""
    parser = argparse.ArgumentParser(
        description="Generate scenario-aware cooling events and publish them to MQTT."
    )
    parser.add_argument(
        "--interval-ms",
        type=int,
        default=2000,
        help="Milliseconds between events (default: 2000).",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=0,
        help="Number of events to publish; 0 runs until Ctrl+C (default: 0).",
    )
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--topic", default="devices/cooling/events")
    parser.add_argument(
        "--dataset",
        "--input-csv",
        dest="dataset",
        type=Path,
        default=DEFAULT_DATASET,
        help=(
            "Baseline CSV to sample. Dashboard-generated cooling CSV exports "
            "are supported; --input-csv is an equivalent clearer alias."
        ),
    )
    parser.add_argument("--device-id", default="dc_cooling_simulator_01")
    parser.add_argument(
        "--scenario",
        choices=("mixed",) + SCENARIOS,
        default="mixed",
        help=(
            "Scenario to generate. 'mixed' produces mostly normal events with "
            "occasional edge cases (default: mixed)."
        ),
    )
    parser.add_argument(
        "--outlier-rate",
        type=float,
        default=0.05,
        help="Outlier probability in mixed mode (default: 0.05).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        help="Optional random seed for a repeatable test run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print events without connecting to MQTT.",
    )
    parser.add_argument(
        "--run-id",
        help="UUID shared by every event in this generator launch (auto-generated when omitted).",
    )
    parser.add_argument(
        "--csv-output",
        type=Path,
        help="Training CSV destination for this generator run (a run-specific file is created by default).",
    )
    parser.add_argument(
        "--no-csv",
        action="store_true",
        help="Do not write the per-run training CSV.",
    )
    args = parser.parse_args()

    if args.interval_ms < 1:
        parser.error("--interval-ms must be at least 1")
    if args.count < 0:
        parser.error("--count cannot be negative")
    if not 0 <= args.outlier_rate <= 1:
        parser.error("--outlier-rate must be between 0 and 1")
    if args.no_csv and args.csv_output is not None:
        parser.error("--no-csv cannot be combined with --csv-output")
    if args.run_id is not None:
        try:
            args.run_id = normalize_run_id(args.run_id)
        except ValueError:
            parser.error("--run-id must be a valid UUID")
    return args


def is_outlier(row):
    """Apply the IQR tail thresholds documented in DATA_DICTIONARY.md."""
    return (
        float(row["Inlet_Temperature(°C)"]) < 15.371
        or float(row["Inlet_Temperature(°C)"]) > 27.714
        or float(row["Outlet_Temperature(°C)"]) < 18.565
        or float(row["Outlet_Temperature(°C)"]) > 34.391
        or float(row["Ambient_Temperature(°C)"]) > 31.826
        or float(row["AHU_Usage(%)"]) > 65.571
        or float(row["Total_Energy_Cost($)"]) > 0.145
        or float(row["Temperature_Deviation(°C)"]) > 6.850
    )


def load_rows(dataset_path):
    """Load the source data once and build pools used by named scenarios."""
    with dataset_path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"Dataset contains no rows: {dataset_path}")

    normal_rows = [row for row in rows if not is_outlier(row)]
    outlier_rows = [row for row in rows if is_outlier(row)]
    high_workload_rows = [
        row
        for row in rows
        if float(row["Server_Workload(%)"]) >= 85 and not is_outlier(row)
    ]
    if not normal_rows or not outlier_rows or not high_workload_rows:
        raise ValueError("Dataset does not contain every required scenario pool")
    return {
        "all": rows,
        "normal": normal_rows,
        "outlier": outlier_rows,
        "high_workload": high_workload_rows,
    }


def as_float(row, key):
    """Convert a CSV numeric string to the two-decimal event representation."""
    return round(float(row[key]), 2)


def choose_scenario(requested, outlier_rate, randomizer):
    """Choose an edge case in mixed mode while keeping normal traffic dominant."""
    if requested != "mixed":
        return requested

    if randomizer.random() < outlier_rate:
        return "outlier"

    # These probabilities apply only after the outlier check. They make failure
    # cases visible during a demo without overwhelming the normal stream.
    roll = randomizer.random()
    if roll < 0.04:
        return "cooling_failure"
    if roll < 0.10:
        return "workload_spike"
    if roll < 0.12:
        return "sensor_fault"
    return "normal"


def select_row(pools, scenario, randomizer):
    """Select a baseline row suited to the requested scenario."""
    if scenario == "outlier":
        source = pools["outlier"]
    elif scenario in {"cooling_failure", "workload_spike"}:
        source = pools["high_workload"]
    else:
        source = pools["normal"]
    return randomizer.choice(source)


def build_base_event(row, device_id):
    """Map one validated dataset row to the stable JSON and database names."""
    action = row["Cooling_Strategy_Action"]
    expected_code = ACTION_CODES[action]
    dataset_code = int(row["Output"])
    if dataset_code != expected_code:
        raise ValueError(
            f"Action/code mismatch: {action!r} should be {expected_code}, "
            f"not {dataset_code}"
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "event_id": str(uuid.uuid4()),
        "device_id": device_id,
        "timestamp": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "server_workload_pct": as_float(row, "Server_Workload(%)"),
        "inlet_temperature_c": as_float(row, "Inlet_Temperature(°C)"),
        "outlet_temperature_c": as_float(row, "Outlet_Temperature(°C)"),
        "ambient_temperature_c": as_float(row, "Ambient_Temperature(°C)"),
        "cooling_power_kw": as_float(row, "Cooling_Unit_Power_Consumption(kW)"),
        "chiller_usage_pct": as_float(row, "Chiller_Usage(%)"),
        "ahu_usage_pct": as_float(row, "AHU_Usage(%)"),
        "total_energy_cost_usd": as_float(row, "Total_Energy_Cost($)"),
        "temperature_deviation_c": as_float(row, "Temperature_Deviation(°C)"),
        "cooling_strategy_action": action,
        "cooling_strategy_code": dataset_code,
        "is_outlier": is_outlier(row),
    }


def apply_scenario(event, scenario, randomizer):
    """Add scenario metadata and mutate only the readings needed by that story."""
    event.update(
        {
            "scenario": scenario,
            "severity": "info",
            "failure_point": None,
            "sensor_status": "online",
            "data_quality": "valid",
            "scenario_details": {
                "user_story": "steady_state_operation",
                "expected_response": "store_and_monitor",
            },
        }
    )

    if scenario == "outlier":
        event["severity"] = "warning"
        event["is_outlier"] = True
        event["scenario_details"] = {
            "user_story": "statistical_tail_observation",
            "expected_response": "flag_for_review",
        }
    elif scenario == "workload_spike":
        event["server_workload_pct"] = round(randomizer.uniform(94, 100), 2)
        event["inlet_temperature_c"] = round(randomizer.uniform(24.5, 27.4), 2)
        event["outlet_temperature_c"] = round(
            event["inlet_temperature_c"] + randomizer.uniform(4.5, 7.0), 2
        )
        event["cooling_power_kw"] = round(randomizer.uniform(0.90, 1.11), 2)
        event["chiller_usage_pct"] = round(randomizer.uniform(85, 100), 2)
        event["ahu_usage_pct"] = round(randomizer.uniform(58, 70), 2)
        event["total_energy_cost_usd"] = round(
            event["cooling_power_kw"] * 0.10, 2
        )
        event["cooling_strategy_action"] = "Boost All"
        event["cooling_strategy_code"] = ACTION_CODES["Boost All"]
        event["severity"] = "warning"
        event["is_outlier"] = True
        event["scenario_details"] = {
            "user_story": "sudden_compute_demand",
            "expected_response": "increase_cooling_capacity",
        }
    elif scenario == "cooling_failure":
        event["server_workload_pct"] = round(randomizer.uniform(82, 100), 2)
        event["inlet_temperature_c"] = round(randomizer.uniform(28, 31), 2)
        event["outlet_temperature_c"] = round(
            event["inlet_temperature_c"] + randomizer.uniform(6, 9), 2
        )
        event["cooling_power_kw"] = round(randomizer.uniform(0.30, 0.45), 2)
        event["chiller_usage_pct"] = round(randomizer.uniform(10, 25), 2)
        event["ahu_usage_pct"] = round(randomizer.uniform(25, 40), 2)
        event["total_energy_cost_usd"] = round(
            event["cooling_power_kw"] * 0.12, 2
        )
        event["cooling_strategy_action"] = "Increase Chiller"
        event["cooling_strategy_code"] = ACTION_CODES["Increase Chiller"]
        event["severity"] = "critical"
        event["failure_point"] = "chiller_loop"
        event["sensor_status"] = "degraded"
        event["is_outlier"] = True
        event["scenario_details"] = {
            "user_story": "chiller_output_loss",
            "expected_response": "raise_alert_and_fail_over",
        }
    elif scenario == "sensor_fault":
        # A 99.99 C inlet reading is deliberately implausible. Downstream code
        # can prove it distinguishes equipment heat from a bad measurement.
        event["inlet_temperature_c"] = 99.99
        event["severity"] = "critical"
        event["failure_point"] = "inlet_temperature_sensor"
        event["sensor_status"] = "fault"
        event["data_quality"] = "suspect"
        event["is_outlier"] = True
        event["scenario_details"] = {
            "user_story": "implausible_sensor_reading",
            "fault_mode": "range_violation",
            "expected_response": "quarantine_reading_and_alert",
        }
    return event


def build_event(row, device_id, scenario, randomizer):
    """Build one complete event for MQTT, validation, storage, and UI use."""
    return apply_scenario(build_base_event(row, device_id), scenario, randomizer)


def training_row(event):
    """Map one event to the source-compatible CSV used for model retraining."""
    return (
        event["timestamp"], event["server_workload_pct"], event["inlet_temperature_c"],
        event["outlet_temperature_c"], event["ambient_temperature_c"],
        event["cooling_power_kw"], event["chiller_usage_pct"], event["ahu_usage_pct"],
        event["total_energy_cost_usd"], event["temperature_deviation_c"],
        event["cooling_strategy_action"], event["cooling_strategy_code"],
        event["scenario"], event["severity"], event["failure_point"],
        event["sensor_status"], event["data_quality"], event["is_outlier"],
        event["event_id"], event["run_id"],
    )


def main():
    """Generate events until the requested count is reached or the user stops."""
    args = parse_args()
    randomizer = random.Random(args.seed)
    pools = load_rows(args.dataset)
    run_id = args.run_id or str(uuid.uuid4())
    csv_path = args.csv_output or (
        Path(__file__).with_name("generated_runs")
        / f"cooling_training_run_{run_id}.csv"
    )
    csv_handle = None
    csv_writer = None
    if not args.no_csv:
        csv_path = csv_path.expanduser().resolve()
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        csv_handle = csv_path.open("w", encoding="utf-8", newline="")
        csv_writer = csv.writer(csv_handle)
        csv_writer.writerow(TRAINING_HEADERS)

    client = None
    if not args.dry_run:
        client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        client.connect(args.broker, args.port, 60)
        client.loop_start()

    mode = "DRY RUN" if args.dry_run else f"MQTT {args.broker}:{args.port}"
    print(
        f"Cooling generator active | {mode} | topic={args.topic} | "
        f"scenario={args.scenario} | interval={args.interval_ms} ms | run_id={run_id}"
    )
    if csv_path is not None and not args.no_csv:
        print(f"Training CSV: {csv_path}")

    published = 0
    try:
        while args.count == 0 or published < args.count:
            scenario = choose_scenario(
                args.scenario, args.outlier_rate, randomizer
            )
            row = select_row(pools, scenario, randomizer)
            event = build_event(row, args.device_id, scenario, randomizer)
            event["run_id"] = run_id
            payload = json.dumps(event, separators=(",", ":"))

            if client is not None:
                result = client.publish(args.topic, payload, qos=1)
                result.wait_for_publish()
                if result.rc != mqtt.MQTT_ERR_SUCCESS:
                    raise RuntimeError(f"MQTT publish failed with code {result.rc}")

            published += 1
            if csv_writer is not None:
                csv_writer.writerow(training_row(event))
                csv_handle.flush()
            print(json.dumps(event, indent=2))
            if args.count == 0 or published < args.count:
                time.sleep(args.interval_ms / 1000)
    except KeyboardInterrupt:
        print("\nGenerator stopped.")
    finally:
        if client is not None:
            client.loop_stop()
            client.disconnect()
        if csv_handle is not None:
            csv_handle.close()


if __name__ == "__main__":
    main()
