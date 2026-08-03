#!/usr/bin/env python3
"""Query cooling_events, print aligned tables, and export training-ready CSV."""

import argparse
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2 import sql

from cooling_run_utils import normalize_run_id, table_name_for_run


DEFAULT_DSN = "dbname=iot_platform user=veer host=localhost port=5432"
DEFAULT_EXPORT = Path(__file__).with_name("cooling_events_export.csv")


def parse_args():
    """Read the database connection and optional CSV destination."""
    parser = argparse.ArgumentParser(
        description="Print cooling database analysis and optionally export CSV."
    )
    parser.add_argument(
        "--dsn",
        default=os.environ.get("POSTGRES_DSN", DEFAULT_DSN),
        help="PostgreSQL DSN (or set POSTGRES_DSN).",
    )
    parser.add_argument(
        "--export-csv",
        nargs="?",
        const=DEFAULT_EXPORT,
        type=Path,
        metavar="PATH",
        help=(
            "Export model-training columns to PATH after the queries. "
            "When PATH is omitted, write cooling_events_export.csv here."
        ),
    )
    parser.add_argument(
        "--run-id",
        metavar="UUID",
        help="Analyze one generator run's dedicated PostgreSQL table.",
    )
    args = parser.parse_args()
    if args.run_id is not None:
        try:
            args.run_id = normalize_run_id(args.run_id)
        except ValueError as error:
            parser.error(f"--run-id must be a UUID: {error}")
    return args


def format_table(headings, rows):
    """Return an ASCII table that stays aligned for mixed SQL value types."""
    if not rows:
        return "No matching rows."

    text_rows = [
        ["" if value is None else str(value) for value in row]
        for row in rows
    ]
    widths = [
        max(len(heading), *(len(row[index]) for row in text_rows))
        for index, heading in enumerate(headings)
    ]
    separator = "+-" + "-+-".join("-" * width for width in widths) + "-+"
    lines = [separator]
    lines.append(
        "| "
        + " | ".join(
            heading.ljust(width)
            for heading, width in zip(headings, widths)
        )
        + " |"
    )
    lines.append(separator)
    for row in text_rows:
        lines.append(
            "| "
            + " | ".join(
                value.ljust(width) for value, width in zip(row, widths)
            )
            + " |"
        )
    lines.append(separator)
    return "\n".join(lines)


def run_query(cursor, number, title, query, source_table):
    """Execute one fixed analysis query and print its complete result."""
    cursor.execute(sql.SQL(query).format(table=source_table))
    headings = [column.name for column in cursor.description]
    rows = cursor.fetchall()
    label = f"{number}. {title}"
    print(f"\n{label}")
    print("-" * len(label))
    print(format_table(headings, rows))


def export_training_csv(connection, destination, source_table):
    """Export source-compatible model fields plus scenario quality metadata."""
    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    copy_query = """
        COPY (
            SELECT
                event_timestamp AS "Timestamp",
                server_workload_pct AS "Server_Workload(%)",
                inlet_temperature_c AS "Inlet_Temperature(°C)",
                outlet_temperature_c AS "Outlet_Temperature(°C)",
                ambient_temperature_c AS "Ambient_Temperature(°C)",
                cooling_power_kw AS "Cooling_Unit_Power_Consumption(kW)",
                chiller_usage_pct AS "Chiller_Usage(%)",
                ahu_usage_pct AS "AHU_Usage(%)",
                total_energy_cost_usd AS "Total_Energy_Cost($)",
                temperature_deviation_c AS "Temperature_Deviation(°C)",
                cooling_strategy_action AS "Cooling_Strategy_Action",
                cooling_strategy_code AS "Output",
                scenario,
                severity,
                failure_point,
                sensor_status,
                data_quality,
                is_outlier,
                event_id,
                run_id
            FROM {table}
            ORDER BY event_timestamp
        ) TO STDOUT WITH CSV HEADER
    """
    copy_query = sql.SQL(copy_query).format(table=source_table)
    with destination.open("w", encoding="utf-8", newline="") as handle:
        with connection.cursor() as cursor:
            cursor.copy_expert(copy_query.as_string(connection), handle)
    print(f"\nCSV export complete: {destination}")


def main():
    """Run all cooling questions in one connection and optionally export CSV."""
    args = parse_args()
    source_table = sql.Identifier(
        table_name_for_run(args.run_id) if args.run_id else "cooling_events"
    )
    try:
        with psycopg2.connect(args.dsn) as connection:
            source_name = table_name_for_run(args.run_id) if args.run_id else "cooling_events"
            print(f"Analyzing table: {source_name}")
            with connection.cursor() as cursor:
                run_query(
                    cursor,
                    1,
                    "Overall cooling summary",
                    """
                    SELECT
                        COUNT(*) AS events,
                        ROUND(AVG(server_workload_pct), 2) AS avg_workload_pct,
                        ROUND(AVG(inlet_temperature_c), 2) AS avg_inlet_c,
                        ROUND(MAX(inlet_temperature_c), 2) AS max_inlet_c,
                        ROUND(AVG(cooling_power_kw), 3) AS avg_cooling_kw,
                        ROUND(SUM(total_energy_cost_usd), 4) AS total_cost_usd
                    FROM {table};
                    """,
                    source_table,
                )
                run_query(
                    cursor,
                    2,
                    "Performance by cooling strategy",
                    """
                    SELECT
                        cooling_strategy_action AS action,
                        COUNT(*) AS events,
                        ROUND(AVG(inlet_temperature_c), 2) AS avg_inlet_c,
                        ROUND(AVG(cooling_power_kw), 3) AS avg_power_kw,
                        ROUND(AVG(total_energy_cost_usd), 4) AS avg_cost_usd
                    FROM {table}
                    GROUP BY cooling_strategy_action
                    ORDER BY events DESC, action;
                    """,
                    source_table,
                )
                run_query(
                    cursor,
                    3,
                    "Thermal risk and data quality",
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE inlet_temperature_c > 27)
                            AS inlet_over_27c,
                        COUNT(*) FILTER (WHERE temperature_deviation_c > 6.85)
                            AS high_deviation,
                        COUNT(*) FILTER (WHERE is_outlier) AS flagged_outliers,
                        COUNT(*) FILTER (WHERE data_quality = 'suspect')
                            AS suspect_readings,
                        ROUND(
                            100.0 * COUNT(*) FILTER (WHERE is_outlier)
                            / NULLIF(COUNT(*), 0),
                            2
                        ) AS outlier_pct
                    FROM {table};
                    """,
                    source_table,
                )
                run_query(
                    cursor,
                    4,
                    "Scenario coverage",
                    """
                    SELECT
                        scenario,
                        severity,
                        COUNT(*) AS events,
                        COUNT(*) FILTER (WHERE failure_point IS NOT NULL)
                            AS failure_events,
                        ROUND(AVG(inlet_temperature_c), 2) AS avg_inlet_c
                    FROM {table}
                    GROUP BY scenario, severity
                    ORDER BY events DESC, scenario, severity;
                    """,
                    source_table,
                )
                run_query(
                    cursor,
                    5,
                    "Ten most recent unusual events",
                    """
                    SELECT
                        TO_CHAR(event_timestamp, 'YYYY-MM-DD HH24:MI:SS')
                            AS event_time,
                        scenario,
                        severity,
                        inlet_temperature_c AS inlet_c,
                        cooling_power_kw AS power_kw,
                        cooling_strategy_action AS action,
                        COALESCE(failure_point, '-') AS failure_point
                    FROM {table}
                    WHERE
                        is_outlier
                        OR inlet_temperature_c > 27
                        OR severity IN ('warning', 'critical')
                    ORDER BY event_timestamp DESC
                    LIMIT 10;
                    """,
                    source_table,
                )

            if args.export_csv is not None:
                export_training_csv(connection, args.export_csv, source_table)
    except (OSError, psycopg2.Error) as error:
        print(f"Cooling analysis failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
