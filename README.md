# Data Center Cooling Project

This self-contained package contains the Data Center Cooling dashboard, MQTT/PostgreSQL middleware, machine-learning notebooks and artifacts, database resources, documentation, and Arduino edge code. Move or share the `cooling` folder as one unit; it does not rely on sibling project folders.

## Package layout

- `frontend/` — cooling dashboard HTML, JavaScript, CSS, bundled chart library, and bundled sample snapshot.
- `backend/` — event generator, MQTT subscriber, PostgreSQL analysis/export tools, dashboard bridge, and Python requirements.
- `db/` — PostgreSQL schema plus exported sample event data.
- `ai_worker/` — Colab notebooks, generated-run training data, metrics/predictions, retraining instructions, and model-collaboration prompts.
- `edge/` — Arduino DHT22 + BMP280 environmental monitor sketch and setup notes. Put project and sensor photos in `edge/images/`.
- `docs/` — project documentation, final report, model write-up, research material, datasets, and presentation location.

## Prerequisites

- Python 3. Install middleware packages from the package root: `python3 -m pip install -r backend/requirements.txt`
- A local Mosquitto broker at `localhost:1883`.
- PostgreSQL with a database named `iot_platform`, or provide a connection string through `POSTGRES_DSN` / the scripts' `--dsn` option.

## Recreate the database and insert sample data

From the `cooling` folder, recreate the table (this drops **only** `cooling_events`):

```bash
psql -d iot_platform -f db/recreate_cooling_events.sql
```

Then start the subscriber with writes enabled and generate a finite data set. This creates and inserts fresh sample events:

```bash
python3 backend/cooling_events_subscriber.py --init-db --write-db
python3 backend/cooling_events_generator.py --scenario mixed --count 200 --interval-ms 100
```

`db/sample_data/cooling_events_export.csv` and `.json` are included as previously exported sample data for inspection or dashboard import. They are not a database dump and are not loaded automatically.

## Start the event generator and subscriber

In separate terminals from this folder:

```bash
python3 backend/cooling_events_subscriber.py --init-db --write-db
python3 backend/cooling_events_generator.py --scenario mixed --interval-ms 700
```

For a no-broker JSON check instead:

```bash
python3 backend/cooling_events_generator.py --dry-run --count 3 --interval-ms 10
```

## Run the dashboard

Start the bridge in a third terminal:

```bash
python3 backend/cooling_dashboard_bridge.py
```

Open `http://127.0.0.1:8765/domain-cooling.html`. The raw event stream will populate only after the subscriber writes events to PostgreSQL. The dashboard can also import either `db/sample_data/cooling_events_export.csv` or `docs/datasets/cold_source_control_dataset.csv` locally in the browser.

The Analytics page has an optional **From / To** time filter. It recalculates the KPIs, thermal trend, risk queue, strategy chart/table, and recent-events table from the same selected events. With the bridge running, Analytics first loads the persisted `cooling_events` history and adds new streamed PostgreSQL events as they arrive. Leave both fields empty to include all available events.

## Database analysis and model work

Export the current database rows for analysis:

```bash
python3 backend/analyze_cooling_database.py --export-csv
```

Use `ai_worker/notebooks/02_train_and_save_ml_models.ipynb` in Google Colab for retraining. The project contains no generated `.pkl` files because no executed Colab model-export artifact was available when this package was assembled.

## Edge hardware

See `edge/README.md` for the Arduino wiring, libraries, and upload steps. Add real project/sensor photos to `edge/images/` before submission.
