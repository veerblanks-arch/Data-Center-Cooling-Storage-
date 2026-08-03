# Data-Center Cooling Dataset

## Dataset description

`cold_source_control_dataset.csv` contains 3,498 hourly observations from
January 1, 2025 at 00:00 through May 26, 2025 at 17:00. It describes data-center
server demand, temperatures, cooling equipment utilization, cooling power,
energy cost, and the selected cooling-control action.

The file has 12 fields, no missing values, and no duplicate rows. All five
cooling actions are well represented: Eco Mode (718 rows), Boost All (711),
Increase Chiller (703), Reduce AHU (685), and Maintain (681). This makes the
file broad enough for simulation; it is not a narrow single-condition subset.

## Data dictionary and observed ranges

| CSV field | JSON/database field | Plain-English meaning | Observed range |
|---|---|---|---|
| `Timestamp` | Replaced by `timestamp` / `event_timestamp` | Hour when the historical condition was recorded. New events use their actual generation time. | 2025-01-01 00:00 to 2025-05-26 17:00 |
| `Server_Workload(%)` | `server_workload_pct` | Percentage of available server-compute demand being used. Higher demand generally produces more heat. | 10.00% to 100.00% |
| `Inlet_Temperature(°C)` | `inlet_temperature_c` | Temperature of air entering the server equipment. This is a primary thermal-safety measure. | 15.00°C to 27.97°C |
| `Outlet_Temperature(°C)` | `outlet_temperature_c` | Temperature of air leaving the servers after absorbing heat. | 16.28°C to 35.78°C |
| `Ambient_Temperature(°C)` | `ambient_temperature_c` | Surrounding or outdoor temperature affecting cooling difficulty. | 18.00°C to 34.38°C |
| `Cooling_Unit_Power_Consumption(kW)` | `cooling_power_kw` | Electrical power used by cooling equipment during the interval. | 0.33 kW to 1.11 kW |
| `Chiller_Usage(%)` | `chiller_usage_pct` | Percentage of chiller capacity currently being used. | 20.00% to 100.00% |
| `AHU_Usage(%)` | `ahu_usage_pct` | Percentage utilization of the air-handling unit that circulates conditioned air. | 31.09% to 70.52% |
| `Total_Energy_Cost($)` | `total_energy_cost_usd` | Estimated cooling-energy cost for the observation interval. | $0.03 to $0.16 |
| `Temperature_Deviation(°C)` | `temperature_deviation_c` | Absolute difference between ambient temperature and the 24°C reference point. | 0.00°C to 10.38°C |
| `Cooling_Strategy_Action` | `cooling_strategy_action` | Cooling-control decision selected for the condition. | Increase Chiller, Reduce AHU, Maintain, Boost All, or Eco Mode |
| `Output` | `cooling_strategy_code` | Numeric label for the action: 0 Increase Chiller, 1 Reduce AHU, 2 Maintain, 3 Boost All, 4 Eco Mode. | Integer 0 to 4 |

The generated event adds the following operational fields. They are metadata,
not original model-training inputs.

| JSON/database field | Type | Meaning |
|---|---|---|
| `schema_version` | string | Event contract version. Current events use `1.1`; migrated older rows use `1.0`. |
| `event_id` | UUID string | Unique message identity used to reject duplicate MQTT delivery. |
| `run_id` | UUID string | Identifier generated once per generator launch. The subscriber uses it to create the matching `cooling_events_run_<id>` table and the generator includes it in the run CSV. |
| `device_id` | string | Simulator or device that produced the event. |
| `scenario` | string | `normal`, `outlier`, `workload_spike`, `cooling_failure`, or `sensor_fault`. Migrated rows use `legacy`. |
| `severity` | string | `info`, `warning`, or `critical`. |
| `failure_point` | string or null | Named failed component, such as `chiller_loop` or `inlet_temperature_sensor`. |
| `sensor_status` | string | `online`, `degraded`, or `fault`. |
| `data_quality` | string | `valid` or `suspect`; model retraining should exclude suspect readings. |
| `scenario_details` | JSON object | User story, expected response, and optional fault mode. |
| `is_outlier` | Boolean | Whether the reading is a statistical or deliberate scenario outlier. |

## Scenario stories

| Scenario | How the generator creates it | Expected downstream behavior |
|---|---|---|
| `normal` | Samples a non-outlier historical row. | Store and monitor. |
| `outlier` | Samples a real IQR-tail row. | Flag for review. |
| `workload_spike` | Raises workload to 94–100% and increases cooling demand. | Increase cooling capacity and watch inlet temperature. |
| `cooling_failure` | Lowers chiller output while workload and temperatures stay high. | Raise a critical alert and initiate failover. |
| `sensor_fault` | Emits an implausible 99.99°C inlet reading marked `suspect`. | Quarantine the reading and alert on data quality. |

## Outliers

Outliers were identified with the standard 1.5×IQR rule for each numeric field.
They are retained because unusual conditions are important in a cooling-control
system.

- Inlet temperature has 9 statistical outliers, including a low of 15.00°C and
  a high of 27.97°C. High inlet values indicate elevated server thermal risk;
  unusually low values can indicate excessive cooling.
- Outlet temperature has 13 outliers, from 16.28°C to 35.78°C. A very high
  outlet reading represents unusually hot exhaust air.
- Ambient temperature has 18 high outliers above approximately 31.83°C, with a
  maximum of 34.38°C. These represent hot-weather cooling stress.
- AHU usage has 12 high outliers above approximately 65.57%, reaching 70.52%.
  They represent unusually heavy air-handling demand.
- Energy cost has 35 high outliers above $0.145, reaching $0.16.
- Temperature deviation has 34 high outliers above 6.85°C, reaching 10.38°C.

The event generator normally samples the whole dataset but deliberately selects
from these unusual observations about 5% of the time. This keeps the stream
varied while ensuring the console and database receive some meaningful edge
cases.
