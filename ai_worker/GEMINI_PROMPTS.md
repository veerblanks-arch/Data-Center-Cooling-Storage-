# Gemini Prompts Required by the Assignment

Your boss explicitly requested Gemini. Use these prompts in Gemini and attach
the named files so that step is completed honestly. The implementation in this
folder is already working, so compare Gemini's response against it before
replacing anything.

## Prompt 1: Event generator

Attach:

- `../edge/data_center_environmental_sensor_logger.ino`
- `../docs/datasets/cold_source_control_dataset.csv`
- `../docs/DATA_DICTIONARY.md`

Paste:

> I am working on a data-center cooling-control problem. The attached CSV has
> 3,498 hourly rows describing server workload, inlet/outlet/ambient
> temperatures, cooling power, chiller and AHU utilization, energy cost,
> temperature deviation, and cooling strategy. The attached data dictionary
> gives every field's meaning, range, and outliers. The attached Arduino Python
> program shows the existing Paho MQTT publishing pattern.
>
> Create a Python event generator for the cooling dataset. It must:
>
> 1. Publish JSON events to Mosquitto at localhost:1883.
> 2. Use topic `devices/cooling/events`.
> 3. Generate coherent events matching the dataset's fields and ranges.
> 4. Include normal observations and occasional outliers.
> 5. Accept `--interval-ms`; default to 2000 milliseconds.
> 6. Accept `--count`, with 0 meaning run until Ctrl+C.
> 7. Print every JSON event to the console.
> 8. Use snake_case JSON names suitable for PostgreSQL.
> 9. Use Paho MQTT 2.x callback API.
> 10. Validate command-line arguments and shut down cleanly.
>
> Return a complete Python file, not pseudocode.

## Prompt 2: Database query program

Attach:

- `../db/schema.sql`
- `../docs/DATA_DICTIONARY.md`

Paste:

> Write a complete Python 3 program using psycopg2 that reads the PostgreSQL
> table `cooling_events` in database `iot_platform` and prints useful results
> for a data-center cooling-control problem.
>
> It must print:
>
> 1. Overall event count, average workload, average and maximum inlet
>    temperature, average cooling power, and total energy cost.
> 2. Event count, average inlet temperature, average power, and average cost
>    grouped by cooling strategy.
> 3. Counts of inlet temperatures above 27°C, temperature deviations above
>    6.85°C, and flagged outliers.
> 4. The ten most recent unusual events.
>
> Read the connection from `POSTGRES_DSN`, with a safe localhost default. Use
> parameterized SQL wherever values are supplied. Print clear headings and
> column names. Return a complete Python file, not pseudocode.
