/* File-friendly mirror of cooling-dashboard-data.json.
 * A script wrapper works when the boss opens index.html with file://, where
 * browsers often block fetch() requests for adjacent JSON files.
 */
window.COOLING_DASHBOARD_DATA =
{
  "meta": {
    "dashboard_schema": "1.0",
    "event_schema": "1.1",
    "generated_at": "2026-07-22T10:38:00-07:00",
    "source_file": "cooling_events_export.csv",
    "source_rows": 623,
    "source_range": "Jul 20, 2026 10:12 AM–Jul 21, 2026 11:18 AM PDT",
    "mqtt_topic": "devices/cooling/events"
  },
  "components": {
    "kpis": {
      "items": [
        {"id": "avg-inlet", "label": "Average inlet temperature", "value": 21.56, "unit": "°C", "note": "1 reading exceeded the 27°C watch threshold", "tone": "safe", "color": "#38bdf8"},
        {"id": "avg-power", "label": "Average cooling power", "value": 0.764, "unit": "kW", "note": "Observed range: 0.37–1.10 kW", "tone": "info", "color": "#a78bfa"},
        {"id": "outliers", "label": "Flagged outliers", "value": 31, "unit": "events", "note": "4.98% of the current database export", "tone": "warning", "color": "#fbbf24"},
        {"id": "total-cost", "label": "Recorded energy cost", "value": 54.76, "unit": "USD", "note": "Sum across 623 stored observations", "tone": "info", "color": "#34d399"}
      ]
    },
    "temperature_trend": {
      "labels": ["Jul 20 14:01", "Jul 20 14:01", "Jul 20 14:01", "Jul 20 14:02", "Jul 21 10:19", "Jul 21 10:19", "Jul 21 10:20", "Jul 21 10:20", "Jul 21 11:17", "Jul 21 11:18", "Jul 21 11:18", "Jul 21 11:18"],
      "inlet_c": [21.24, 21.76, 21.62, 21.33, 21.82, 21.38, 21.12, 21.44, 21.55, 22.16, 21.72, 21.58],
      "outlet_c": [25.5, 27.24, 26.61, 26.66, 26.77, 26.34, 25.58, 25.84, 26.64, 27.06, 26.58, 26.61],
      "inlet_watch_c": 27
    },
    "strategy_performance": {
      "items": [
        {"strategy": "Boost All", "events": 146, "avg_inlet_c": 21.59, "avg_power_kw": 0.762, "avg_cost_usd": 0.0847},
        {"strategy": "Eco Mode", "events": 115, "avg_inlet_c": 21.57, "avg_power_kw": 0.756, "avg_cost_usd": 0.091},
        {"strategy": "Increase Chiller", "events": 134, "avg_inlet_c": 21.78, "avg_power_kw": 0.787, "avg_cost_usd": 0.0886},
        {"strategy": "Maintain", "events": 117, "avg_inlet_c": 21.42, "avg_power_kw": 0.75, "avg_cost_usd": 0.0868},
        {"strategy": "Reduce AHU", "events": 111, "avg_inlet_c": 21.39, "avg_power_kw": 0.765, "avg_cost_usd": 0.0892}
      ]
    },
    "alerts": {
      "items": [
        {"severity": "warning", "title": "High ambient deviation", "message": "Temperature deviation reached 7.41°C while workload was 64.66%.", "timestamp": "2026-07-21 11:18:14 PDT", "event_id": "8b73cb42-1ca0-4589-9b6d-9ef27516f9bf"},
        {"severity": "warning", "title": "Inlet threshold exceeded", "message": "Inlet temperature reached 27.97°C while workload was 100%.", "timestamp": "2026-07-21 11:18:08 PDT", "event_id": "3a9ece7f-684e-4868-95a3-5a05afa47e5b"},
        {"severity": "warning", "title": "High interval energy cost", "message": "Energy cost reached $0.15 with 100% workload and 1.01 kW cooling power.", "timestamp": "2026-07-21 11:18:08 PDT", "event_id": "e9e6f054-28bc-4327-9f9b-3a2e36bef457"}
      ]
    },
    "scenario_coverage": {"items": [{"scenario": "legacy export", "events": 623, "color": "#64748b"}]},
    "recent_events": {
      "items": [
        {"timestamp": "11:18:14.999", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 52.71, "inlet_temperature_c": 20.4, "outlet_temperature_c": 27.91, "cooling_power_kw": 0.76, "cooling_strategy_action": "Boost All", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.893", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 64.66, "inlet_temperature_c": 21.51, "outlet_temperature_c": 26.59, "cooling_power_kw": 0.92, "cooling_strategy_action": "Reduce AHU", "is_outlier": true, "scenario": "legacy"},
        {"timestamp": "11:18:14.786", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 73.23, "inlet_temperature_c": 22.83, "outlet_temperature_c": 25.53, "cooling_power_kw": 0.84, "cooling_strategy_action": "Eco Mode", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.680", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 49.69, "inlet_temperature_c": 20.48, "outlet_temperature_c": 29.24, "cooling_power_kw": 0.69, "cooling_strategy_action": "Reduce AHU", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.576", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 72.5, "inlet_temperature_c": 22.16, "outlet_temperature_c": 28.16, "cooling_power_kw": 0.89, "cooling_strategy_action": "Increase Chiller", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.471", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 59.72, "inlet_temperature_c": 23.19, "outlet_temperature_c": 32.18, "cooling_power_kw": 0.79, "cooling_strategy_action": "Increase Chiller", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.365", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 57.98, "inlet_temperature_c": 21.98, "outlet_temperature_c": 25.56, "cooling_power_kw": 0.74, "cooling_strategy_action": "Eco Mode", "is_outlier": false, "scenario": "legacy"},
        {"timestamp": "11:18:14.258", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 94.44, "inlet_temperature_c": 24.11, "outlet_temperature_c": 28.14, "cooling_power_kw": 0.99, "cooling_strategy_action": "Increase Chiller", "is_outlier": false, "scenario": "legacy"}
      ]
    }
  },
  "scenario_catalog": [
    {"name": "normal", "label": "Normal", "severity": "info", "description": "A coherent non-outlier row from the historical cooling dataset.", "expected_response": "Store and monitor without an alert."},
    {"name": "outlier", "label": "Outlier", "severity": "warning", "description": "A real statistical tail selected with the documented IQR rules.", "expected_response": "Store the event and flag it for review."},
    {"name": "workload_spike", "label": "Workload spike", "severity": "warning", "description": "Compute demand rises to 94–100% and cooling demand follows.", "expected_response": "Increase cooling capacity and watch the inlet trend."},
    {"name": "cooling_failure", "label": "Cooling failure", "severity": "critical", "description": "The chiller loop loses output while workload and temperatures remain high.", "expected_response": "Raise a critical alert and initiate failover."},
    {"name": "sensor_fault", "label": "Sensor fault", "severity": "critical", "description": "The inlet sensor emits an implausible 99.99°C range violation.", "expected_response": "Quarantine the reading and alert on data quality."}
  ],
  "event_schema_example": {
    "schema_version": "1.1", "event_id": "00000000-0000-4000-8000-000000000004", "device_id": "dc_cooling_simulator_01", "timestamp": "2026-07-22T10:35:00.000-07:00", "scenario": "cooling_failure", "severity": "critical", "failure_point": "chiller_loop", "sensor_status": "degraded", "data_quality": "valid", "scenario_details": {"user_story": "chiller_output_loss", "expected_response": "raise_alert_and_fail_over"}, "server_workload_pct": 94.2, "inlet_temperature_c": 29.4, "outlet_temperature_c": 36.7, "ambient_temperature_c": 30.1, "cooling_power_kw": 0.39, "chiller_usage_pct": 18.4, "ahu_usage_pct": 33.8, "total_energy_cost_usd": 0.05, "temperature_deviation_c": 6.1, "cooling_strategy_action": "Increase Chiller", "cooling_strategy_code": 0, "is_outlier": true
  },
  "replay_events": [
    {"timestamp": "2026-07-21T11:18:14.999-07:00", "scenario": "legacy", "severity": "info", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 52.71, "inlet_temperature_c": 20.4, "outlet_temperature_c": 27.91, "cooling_power_kw": 0.76, "cooling_strategy_action": "Boost All", "is_outlier": false},
    {"timestamp": "2026-07-21T11:18:14.893-07:00", "scenario": "legacy", "severity": "warning", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 64.66, "inlet_temperature_c": 21.51, "outlet_temperature_c": 26.59, "cooling_power_kw": 0.92, "cooling_strategy_action": "Reduce AHU", "is_outlier": true},
    {"timestamp": "2026-07-22T10:35:00.000-07:00", "scenario": "normal", "severity": "info", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 63.4, "inlet_temperature_c": 21.6, "outlet_temperature_c": 26.8, "cooling_power_kw": 0.76, "cooling_strategy_action": "Maintain", "is_outlier": false},
    {"timestamp": "2026-07-22T10:35:01.000-07:00", "scenario": "outlier", "severity": "warning", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 88.1, "inlet_temperature_c": 26.9, "outlet_temperature_c": 34.8, "cooling_power_kw": 1.08, "cooling_strategy_action": "Boost All", "is_outlier": true},
    {"timestamp": "2026-07-22T10:35:02.000-07:00", "scenario": "workload_spike", "severity": "warning", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 99.2, "inlet_temperature_c": 26.4, "outlet_temperature_c": 32.1, "cooling_power_kw": 1.07, "cooling_strategy_action": "Boost All", "is_outlier": true},
    {"timestamp": "2026-07-22T10:35:03.000-07:00", "scenario": "cooling_failure", "severity": "critical", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 94.2, "inlet_temperature_c": 29.4, "outlet_temperature_c": 36.7, "cooling_power_kw": 0.39, "cooling_strategy_action": "Increase Chiller", "is_outlier": true},
    {"timestamp": "2026-07-22T10:35:04.000-07:00", "scenario": "sensor_fault", "severity": "critical", "device_id": "dc_cooling_simulator_01", "server_workload_pct": 62.8, "inlet_temperature_c": 99.99, "outlet_temperature_c": 27.1, "cooling_power_kw": 0.78, "cooling_strategy_action": "Maintain", "is_outlier": true}
  ]
};
