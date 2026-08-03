#!/usr/bin/env python3
"""Display the newest generated cooling events as a formatted table."""

import argparse
import os
import sys

import psycopg2


DEFAULT_DSN = "dbname=iot_platform user=veer host=localhost port=5432"


def positive_limit(value):
    """Reject accidental unbounded terminal output."""
    limit = int(value)
    if not 1 <= limit <= 1000:
        raise argparse.ArgumentTypeError("limit must be between 1 and 1000")
    return limit


def parse_args():
    """Read the row limit and optional PostgreSQL connection override."""
    parser = argparse.ArgumentParser(
        description="Show the newest rows stored in the cooling_events table."
    )
    parser.add_argument(
        "--limit",
        type=positive_limit,
        default=10,
        help="Number of events to display (default: 10).",
    )
    parser.add_argument(
        "--dsn",
        default=os.environ.get("POSTGRES_DSN", DEFAULT_DSN),
        help="PostgreSQL DSN (or set POSTGRES_DSN).",
    )
    return parser.parse_args()


def display_table(headings, rows):
    """Print database rows in a width-aware ASCII table."""
    if not rows:
        print("The cooling_events table does not contain any events yet.")
        return

    text_rows = [
        ["" if value is None else str(value) for value in row]
        for row in rows
    ]
    widths = [
        max(len(heading), *(len(row[index]) for row in text_rows))
        for index, heading in enumerate(headings)
    ]

    separator = "+-" + "-+-".join("-" * width for width in widths) + "-+"
    print(separator)
    print(
        "| "
        + " | ".join(
            heading.ljust(width)
            for heading, width in zip(headings, widths)
        )
        + " |"
    )
    print(separator)
    for row in text_rows:
        print(
            "| "
            + " | ".join(
                value.ljust(width)
                for value, width in zip(row, widths)
            )
            + " |"
        )
    print(separator)


def main():
    """Fetch the newest scenario-aware events and print them."""
    args = parse_args()

    try:
        with psycopg2.connect(args.dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        TO_CHAR(received_at, 'YYYY-MM-DD HH24:MI:SS') AS received,
                        scenario,
                        severity,
                        server_workload_pct AS workload_pct,
                        inlet_temperature_c AS inlet_c,
                        cooling_power_kw AS power_kw,
                        cooling_strategy_action AS strategy,
                        is_outlier AS outlier
                    FROM cooling_events
                    ORDER BY received_at DESC
                    LIMIT %s;
                    """,
                    (args.limit,),
                )
                rows = cursor.fetchall()
                headings = [column.name for column in cursor.description]
    except psycopg2.Error as error:
        print(f"Unable to read cooling_events: {error}", file=sys.stderr)
        return 1

    print(f"\nNewest {len(rows)} generated cooling event(s)")
    display_table(headings, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
