"""Shared identifiers for generator runs and their dedicated PostgreSQL tables."""

from uuid import UUID


RUN_TABLE_PREFIX = "cooling_events_run_"


def normalize_run_id(value):
    """Return a canonical UUID string or raise ValueError for invalid input."""
    return str(UUID(str(value)))


def table_name_for_run(run_id):
    """Build a safe, deterministic PostgreSQL identifier for one generator run."""
    return f"{RUN_TABLE_PREFIX}{normalize_run_id(run_id).replace('-', '')}"
