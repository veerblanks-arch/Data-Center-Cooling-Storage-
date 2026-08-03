# Retraining the Cooling Models from a Generator Run

1. Generate enough varied events. A short demo is not a useful training set:

   ```bash
   python3 cooling_events_generator.py --scenario mixed --count 1000 --interval-ms 50
   ```

2. Use the CSV path printed by the generator. It is already compatible with
   the original cooling data column names. If the CSV must reflect only rows
   confirmed in PostgreSQL, instead run:

   ```bash
   python3 analyze_cooling_database.py --run-id <run-id> \
     --export-csv generated_runs/confirmed_run.csv
   ```

3. Upload that CSV to Google Drive, then open
   `notebooks/ml_pipeline/02_train_and_save_ml_models.ipynb` in Google Colab.
   In its CSV-loading cell, change `csv_path` to the uploaded CSV's Drive path
   before running all cells. The notebook retrains and saves the Linear
   Regression, K-Means, and Logistic Regression artifacts.

4. Keep a record of the `run_id`, CSV filename, scenario mix, and model metrics
   with each retrained model. Do not claim that a model was retrained merely
   because a CSV was exported.

The generator CSV includes scenario and data-quality metadata for auditing. The
existing model notebook deliberately uses only operational sensor fields as
features, so it does not leak scenario labels into model predictions.
