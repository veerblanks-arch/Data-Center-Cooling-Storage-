# Monday IoT Assignment Handoff

## Completion status

1. **Original simulator check: passed.**
   - Mosquitto was listening on port 1883.
   - PostgreSQL was listening on port 5432.
   - The original Arduino/ESP32 simulator published both event types.
   - The original subscriber printed both event types.
   - PostgreSQL writes to `telemetry_logs` returned `True`.
   - VictoriaMetrics was unavailable on port 8428, but it is described as a
     future component in the supplied instructions and is not required by this
     assignment.

2. **Dataset description and dictionary: complete.**
   - See `DATA_DICTIONARY.md`.
   - Verified 3,498 rows, 12 fields, no missing values, and no duplicate rows.
   - Exact ranges, action counts, and representative outliers are included.

3. **New cooling event generator: complete.**
   - See `cooling_events_generator.py`.
   - Events use JSON and preserve real combinations sampled from the CSV.

4. **Millisecond frequency flag: complete.**
   - `--interval-ms` defaults to 2000.

5. **MQTT to console: passed.**
   - Topic: `devices/cooling/events`.
   - A console-only test received and printed two events successfully.

6. **PostgreSQL write: passed.**
   - The separate `cooling_events` table matches every JSON field.
   - Twelve test events were stored successfully.
   - Three of the test events were flagged as outliers.

7. **Database query program: passed.**
   - See `analyze_cooling_database.py`.
   - Overall summary, strategy comparison, thermal-risk counts, and recent
     unusual events all printed successfully.

## Wednesday scenario and UI update

1. **Named generator scenarios: complete.**
   - `normal`, `outlier`, `workload_spike`, `cooling_failure`, and
     `sensor_fault` can be selected with `--scenario`.
   - `mixed` remains the default and keeps normal traffic dominant.

2. **JSON and PostgreSQL scenario schema: complete.**
   - Schema 1.1 adds severity, failure point, sensor status, data quality, and a
     flexible JSON details object.
   - The SQL migration preserved the existing 623 rows as `legacy` events.

3. **Formatted analysis and CSV export: complete.**
   - Analysis results use aligned terminal tables.
   - `--export-csv` writes source-compatible model fields plus scenario and
     quality metadata for Colab retraining.

4. **Cooling dashboard plugin: complete.**
   - See `../frontend/domain-cooling.html`.
   - Cooling-specific presentation and behavior live in `cooling.css` and
     `cooling.js`.
   - The Raw Event Stream receives terminal generator events after MQTT,
     subscriber validation, and PostgreSQL persistence. It keeps a session
     buffer and supports 19-column CSV export; the exported CSV was
     successfully fed back through the dashboard importer.
   - The Scenario Coverage chart is connected to that live listener buffer and
     resets when the browser session buffer is cleared.
   - The Recent Listener Events table shows the newest eight buffered events
     and updates whenever a new PostgreSQL event reaches the bridge.
   - `index.html` and `shared.css` remain byte-for-byte copies of the attachment.

## Demonstration commands

```bash
cd cooling
```

Console-only subscriber:

```bash
python3 backend/cooling_events_subscriber.py
```

Generator in another terminal:

```bash
python3 backend/cooling_events_generator.py --interval-ms 2000
```

Database-enabled subscriber:

```bash
python3 backend/cooling_events_subscriber.py --init-db --write-db
```

Database analysis:

```bash
python3 backend/analyze_cooling_database.py
```

Database analysis plus Colab-ready CSV export:

```bash
python3 backend/analyze_cooling_database.py --export-csv
```

One repeatable failure test:

```bash
python3 backend/cooling_events_generator.py --scenario cooling_failure --count 3 --seed 22
```

## Important design decision

The existing `telemetry_logs` table is for temperature, humidity, and pressure
sensor readings. Cooling-control events contain a different schema. A separate
`cooling_events` table was therefore created so the original working pipeline
remains intact and the new JSON maps cleanly to relational columns.
