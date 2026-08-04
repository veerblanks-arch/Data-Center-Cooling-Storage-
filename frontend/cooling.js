/* Render the cooling dashboard from its bundled snapshot or a user-selected CSV.
 * CSV parsing, validation, aggregation, and chart updates happen entirely in
 * this browser. Imported data is never uploaded or saved between page loads.
 */
(function () {
  "use strict";

  if (!window.COOLING_DASHBOARD_DATA) {
    if (typeof document !== "undefined") {
      document.body.textContent = "Cooling dashboard data could not be loaded.";
    }
    return;
  }

  const BASE_HEADERS = [
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
  ];
  const METADATA_HEADERS = [
    "scenario",
    "severity",
    "failure_point",
    "sensor_status",
    "data_quality",
    "is_outlier",
    "event_id",
  ];
  const ACTION_CODES = {
    "Increase Chiller": 0,
    "Reduce AHU": 1,
    Maintain: 2,
    "Boost All": 3,
    "Eco Mode": 4,
  };
  const SCENARIOS = new Set([
    "legacy",
    "normal",
    "outlier",
    "cooling_failure",
    "workload_spike",
    "sensor_fault",
  ]);
  const GENERATED_SCENARIOS = [
    "normal",
    "outlier",
    "cooling_failure",
    "workload_spike",
    "sensor_fault",
  ];
  const MIXED_SCENARIO_WEIGHTS = [
    ["normal", 0.70],
    ["outlier", 0.10],
    ["workload_spike", 0.08],
    ["cooling_failure", 0.07],
    ["sensor_fault", 0.05],
  ];
  const SEVERITIES = new Set(["info", "warning", "critical"]);
  const SENSOR_STATUSES = new Set(["online", "degraded", "fault"]);
  const DATA_QUALITIES = new Set(["valid", "suspect"]);
  const SCENARIO_COLORS = {
    legacy: "#64748b",
    normal: "#34d399",
    outlier: "#fbbf24",
    workload_spike: "#f97316",
    cooling_failure: "#fb7185",
    sensor_fault: "#a78bfa",
  };
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_GENERATED_EVENTS = 50000;

  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const bundledDashboard = deepClone(window.COOLING_DASHBOARD_DATA);
  let dashboard = deepClone(bundledDashboard);
  let charts = [];
  let scenarioChart = null;
  let currentImport = null;
  let backendSource = null;
  let backendConnected = false;
  // Analytics always derives from this one canonical event collection. It is
  // populated from PostgreSQL when the bridge is available or replaced by a
  // validated CSV import; every Analytics component then receives the same
  // date-filtered subset.
  let analyticsEvents = null;
  let analyticsMode = "snapshot";
  let analyticsRefreshTimer = null;

  const streamState = {
    generated: 0,
    outliers: 0,
    paused: false,
    startedAt: Date.now(),
    sequence: 0,
    events: [],
  };

  const byId = (id) => document.getElementById(id);
  const className = (value) => String(value).replaceAll("_", "-");
  const round = (value, places) => Number(Number(value).toFixed(places));
  const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;

  // Create text-only elements so event data and filenames cannot inject markup.
  function makeElement(tag, classes, text) {
    const element = document.createElement(tag);
    if (classes) element.className = classes;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // Parse RFC 4180-style CSV, including quoted commas, escaped quotes, and
  // either CRLF or LF line endings. Validation happens before the UI changes.
  function parseCsvText(text) {
    const source = String(text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];

      if (inQuotes) {
        if (character === '"') {
          if (source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += character;
        }
        continue;
      }

      if (character === '"') {
        if (field.length) throw new Error("A quoted field starts after unquoted text.");
        inQuotes = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    if (inQuotes) throw new Error("The CSV ends inside a quoted field.");
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every((value) => !value.trim())) rows.pop();
    if (rows.length < 2) throw new Error("The CSV needs a header and at least one data row.");

    const headers = rows.shift().map((header) => header.trim());
    if (headers.some((header) => !header)) throw new Error("The CSV contains an empty column name.");
    const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
    if (duplicates.length) throw new Error(`Duplicate columns: ${Array.from(new Set(duplicates)).join(", ")}.`);

    const records = [];
    rows.forEach((values, rowIndex) => {
      if (values.every((value) => !value.trim())) return;
      if (values.length !== headers.length) {
        throw new Error(`Row ${rowIndex + 2} has ${values.length} values; expected ${headers.length}.`);
      }
      records.push(Object.fromEntries(headers.map((header, index) => [header, values[index].trim()])));
    });
    if (!records.length) throw new Error("The CSV contains no data rows.");
    return { headers, records };
  }

  function detectCsvFormat(headers) {
    const missingBase = BASE_HEADERS.filter((header) => !headers.includes(header));
    if (missingBase.length) throw new Error(`Missing required columns: ${missingBase.join(", ")}.`);

    const presentMetadata = METADATA_HEADERS.filter((header) => headers.includes(header));
    if (presentMetadata.length && presentMetadata.length !== METADATA_HEADERS.length) {
      const missingMetadata = METADATA_HEADERS.filter((header) => !headers.includes(header));
      throw new Error(`The scenario export is incomplete. Missing: ${missingMetadata.join(", ")}.`);
    }

    const expected = presentMetadata.length ? [...BASE_HEADERS, ...METADATA_HEADERS] : BASE_HEADERS;
    const unexpected = headers.filter((header) => !expected.includes(header));
    if (unexpected.length) throw new Error(`Unsupported columns: ${unexpected.join(", ")}.`);
    if (headers.length !== expected.length) {
      throw new Error(`Expected ${expected.length} unique columns; found ${headers.length}.`);
    }
    return presentMetadata.length ? "19-column PostgreSQL export" : "12-column source dataset";
  }

  function readNumber(record, header, rowNumber) {
    const value = Number(record[header]);
    if (!record[header] || !Number.isFinite(value)) {
      throw new Error(`Row ${rowNumber}: ${header} must be numeric.`);
    }
    return value;
  }

  function readBoolean(value, rowNumber) {
    const normalized = String(value).trim().toLowerCase();
    if (["true", "t", "1", "yes"].includes(normalized)) return true;
    if (["false", "f", "0", "no"].includes(normalized)) return false;
    throw new Error(`Row ${rowNumber}: is_outlier must be true/false or t/f.`);
  }

  function parseTimestamp(value, rowNumber) {
    const raw = String(value).trim();
    if (!raw) throw new Error(`Row ${rowNumber}: Timestamp is required.`);
    const normalized = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const milliseconds = Date.parse(normalized);
    if (!Number.isFinite(milliseconds)) throw new Error(`Row ${rowNumber}: Timestamp is not recognized.`);
    return { raw, milliseconds, iso: new Date(milliseconds).toISOString() };
  }

  function deriveOutlier(event) {
    return (
      event.inlet_temperature_c < 15.371
      || event.inlet_temperature_c > 27.714
      || event.outlet_temperature_c < 18.565
      || event.outlet_temperature_c > 34.391
      || event.ambient_temperature_c > 31.826
      || event.ahu_usage_pct > 65.571
      || event.total_energy_cost_usd > 0.145
      || event.temperature_deviation_c > 6.85
    );
  }

  function recordsToEvents(records, format) {
    const hasMetadata = format.startsWith("19-column");
    return records.map((record, index) => {
      const rowNumber = index + 2;
      const timestamp = parseTimestamp(record.Timestamp, rowNumber);
      const action = record.Cooling_Strategy_Action;
      const actionCode = readNumber(record, "Output", rowNumber);
      if (!(action in ACTION_CODES)) throw new Error(`Row ${rowNumber}: unknown cooling action ${action || "(blank)"}.`);
      if (!Number.isInteger(actionCode) || ACTION_CODES[action] !== actionCode) {
        throw new Error(`Row ${rowNumber}: Output does not match ${action}.`);
      }

      const event = {
        source_index: index,
        timestamp: timestamp.iso,
        source_timestamp: timestamp.raw,
        sort_ms: timestamp.milliseconds,
        event_id: hasMetadata && record.event_id ? record.event_id : `csv-row-${index + 1}`,
        device_id: "csv_import",
        server_workload_pct: readNumber(record, "Server_Workload(%)", rowNumber),
        inlet_temperature_c: readNumber(record, "Inlet_Temperature(°C)", rowNumber),
        outlet_temperature_c: readNumber(record, "Outlet_Temperature(°C)", rowNumber),
        ambient_temperature_c: readNumber(record, "Ambient_Temperature(°C)", rowNumber),
        cooling_power_kw: readNumber(record, "Cooling_Unit_Power_Consumption(kW)", rowNumber),
        chiller_usage_pct: readNumber(record, "Chiller_Usage(%)", rowNumber),
        ahu_usage_pct: readNumber(record, "AHU_Usage(%)", rowNumber),
        total_energy_cost_usd: readNumber(record, "Total_Energy_Cost($)", rowNumber),
        temperature_deviation_c: readNumber(record, "Temperature_Deviation(°C)", rowNumber),
        cooling_strategy_action: action,
        cooling_strategy_code: actionCode,
      };

      if ([event.server_workload_pct, event.chiller_usage_pct, event.ahu_usage_pct].some((value) => value < 0 || value > 100)) {
        throw new Error(`Row ${rowNumber}: percentage values must be between 0 and 100.`);
      }
      if ([event.cooling_power_kw, event.total_energy_cost_usd, event.temperature_deviation_c].some((value) => value < 0)) {
        throw new Error(`Row ${rowNumber}: power, cost, and deviation cannot be negative.`);
      }

      if (hasMetadata) {
        event.scenario = record.scenario;
        event.severity = record.severity;
        event.failure_point = record.failure_point || null;
        event.sensor_status = record.sensor_status;
        event.data_quality = record.data_quality;
        event.is_outlier = readBoolean(record.is_outlier, rowNumber);
        if (!SCENARIOS.has(event.scenario)) throw new Error(`Row ${rowNumber}: unknown scenario ${event.scenario || "(blank)"}.`);
        if (!SEVERITIES.has(event.severity)) throw new Error(`Row ${rowNumber}: unknown severity ${event.severity || "(blank)"}.`);
        if (!SENSOR_STATUSES.has(event.sensor_status)) throw new Error(`Row ${rowNumber}: unknown sensor status ${event.sensor_status || "(blank)"}.`);
        if (!DATA_QUALITIES.has(event.data_quality)) throw new Error(`Row ${rowNumber}: unknown data quality ${event.data_quality || "(blank)"}.`);
      } else {
        event.scenario = "legacy";
        event.severity = "info";
        event.failure_point = null;
        event.sensor_status = "online";
        event.data_quality = "valid";
        event.is_outlier = deriveOutlier(event);
      }
      return event;
    });
  }

  function formatDate(milliseconds, options) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(milliseconds));
  }

  function formatRange(events) {
    const first = events[0].sort_ms;
    const last = events[events.length - 1].sort_ms;
    const options = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return first === last ? formatDate(first, options) : `${formatDate(first, options)}–${formatDate(last, options)}`;
  }

  function dateTimeLocalToMilliseconds(value, includeWholeMinute) {
    if (!value) return null;
    const milliseconds = new Date(value).getTime();
    if (!Number.isFinite(milliseconds)) return null;
    return includeWholeMinute ? milliseconds + 59999 : milliseconds;
  }

  function selectedTimeRange() {
    const start = dateTimeLocalToMilliseconds(byId("rangeStart").value, false);
    const end = dateTimeLocalToMilliseconds(byId("rangeEnd").value, true);
    if (start !== null && end !== null && start > end) {
      return { error: "The From time must be before the To time.", start, end };
    }
    return { start, end, error: null };
  }

  function filterEventsByTime(events) {
    const range = selectedTimeRange();
    if (range.error) return { events: [], ...range };
    return {
      events: events.filter((event) => (range.start === null || event.sort_ms >= range.start) && (range.end === null || event.sort_ms <= range.end)),
      ...range,
    };
  }

  function formatCompactTime(milliseconds) {
    return formatDate(milliseconds, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatTrendTime(milliseconds) {
    return formatDate(milliseconds, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function humanizeScenario(scenario) {
    if (scenario === "legacy") return "legacy export";
    return scenario.replaceAll("_", " ");
  }

  function buildTrend(events) {
    const windowCount = Math.min(12, events.length);
    const labels = [];
    const inlet = [];
    const outlet = [];

    for (let index = 0; index < windowCount; index += 1) {
      const start = Math.floor((index * events.length) / windowCount);
      const end = Math.floor(((index + 1) * events.length) / windowCount);
      const group = events.slice(start, Math.max(start + 1, end));
      labels.push(formatTrendTime(group[group.length - 1].sort_ms));
      inlet.push(round(average(group.map((event) => event.inlet_temperature_c)), 2));
      outlet.push(round(average(group.map((event) => event.outlet_temperature_c)), 2));
    }
    return { labels, inlet_c: inlet, outlet_c: outlet, inlet_watch_c: 27 };
  }

  function buildStrategyPerformance(events) {
    const groups = new Map();
    events.forEach((event) => {
      if (!groups.has(event.cooling_strategy_action)) groups.set(event.cooling_strategy_action, []);
      groups.get(event.cooling_strategy_action).push(event);
    });
    return Array.from(groups, ([strategy, group]) => ({
      strategy,
      events: group.length,
      avg_inlet_c: round(average(group.map((event) => event.inlet_temperature_c)), 2),
      avg_power_kw: round(average(group.map((event) => event.cooling_power_kw)), 3),
      avg_cost_usd: round(average(group.map((event) => event.total_energy_cost_usd)), 4),
    })).sort((left, right) => left.strategy.localeCompare(right.strategy));
  }

  function alertForEvent(event) {
    let severity = event.severity === "critical" ? "critical" : "warning";
    let title;
    let message;

    if (event.scenario === "cooling_failure" || event.failure_point) {
      title = "Cooling failure point";
      message = `${event.failure_point || "Cooling equipment"} reported a failure while workload was ${event.server_workload_pct.toFixed(2)}%.`;
    } else if (event.scenario === "sensor_fault" || event.sensor_status === "fault") {
      title = "Sensor fault";
      message = `The inlet reading reached ${event.inlet_temperature_c.toFixed(2)}°C with ${event.data_quality} data quality.`;
    } else if (event.inlet_temperature_c > 27) {
      title = "Inlet threshold exceeded";
      message = `Inlet temperature reached ${event.inlet_temperature_c.toFixed(2)}°C while workload was ${event.server_workload_pct.toFixed(2)}%.`;
    } else if (event.temperature_deviation_c > 6.85) {
      title = "High ambient deviation";
      message = `Temperature deviation reached ${event.temperature_deviation_c.toFixed(2)}°C while workload was ${event.server_workload_pct.toFixed(2)}%.`;
    } else if (event.total_energy_cost_usd > 0.145) {
      title = "High interval energy cost";
      message = `Energy cost reached $${event.total_energy_cost_usd.toFixed(2)} with ${event.cooling_power_kw.toFixed(2)} kW cooling power.`;
    } else if (event.is_outlier) {
      title = "Statistical outlier";
      message = `The event crossed a documented cooling-data outlier threshold.`;
    } else {
      return null;
    }
    if (event.severity === "info") severity = "warning";
    return {
      severity,
      title,
      message,
      timestamp: formatCompactTime(event.sort_ms),
      event_id: event.event_id,
      sort_ms: event.sort_ms,
    };
  }

  function buildAlerts(events) {
    const rank = { critical: 2, warning: 1, info: 0 };
    return events
      .map(alertForEvent)
      .filter(Boolean)
      .sort((left, right) => rank[right.severity] - rank[left.severity] || right.sort_ms - left.sort_ms)
      .slice(0, 6)
      .map(({ sort_ms, ...alert }) => alert);
  }

  function buildScenarioCoverage(events) {
    const counts = new Map();
    events.forEach((event) => counts.set(event.scenario, (counts.get(event.scenario) || 0) + 1));
    return Array.from(counts, ([scenario, count]) => ({
      scenario: humanizeScenario(scenario),
      events: count,
      color: SCENARIO_COLORS[scenario] || "#94a3b8",
    })).sort((left, right) => right.events - left.events);
  }

  function eventFromBackend(event, sourceIndex) {
    const sortMs = Date.parse(event.timestamp);
    if (!Number.isFinite(sortMs)) return null;
    return {
      ...event,
      source_index: sourceIndex,
      sort_ms: sortMs,
      timestamp: new Date(sortMs).toISOString(),
      event_id: event.event_id || `backend-row-${event._db_id || sourceIndex}`,
      server_workload_pct: Number(event.server_workload_pct),
      inlet_temperature_c: Number(event.inlet_temperature_c),
      outlet_temperature_c: Number(event.outlet_temperature_c),
      ambient_temperature_c: Number(event.ambient_temperature_c),
      cooling_power_kw: Number(event.cooling_power_kw),
      chiller_usage_pct: Number(event.chiller_usage_pct),
      ahu_usage_pct: Number(event.ahu_usage_pct),
      total_energy_cost_usd: Number(event.total_energy_cost_usd),
      temperature_deviation_c: Number(event.temperature_deviation_c),
      is_outlier: event.is_outlier === true || event.is_outlier === "true",
    };
  }

  function restoreBundledAnalytics() {
    if (!Array.isArray(window.COOLING_BUNDLED_EVENTS)) return false;
    analyticsEvents = window.COOLING_BUNDLED_EVENTS.map(eventFromBackend).filter(Boolean);
    analyticsMode = "bundle";
    return analyticsEvents.length > 0;
  }

  function buildEmptyDashboard(sourceName, format) {
    const nextDashboard = deepClone(bundledDashboard);
    nextDashboard.meta = {
      ...nextDashboard.meta,
      source_file: sourceName,
      source_rows: 0,
      source_range: "No events in selected range",
      import_format: format,
    };
    nextDashboard.components.kpis.items = [
      { id: "avg-inlet", label: "Average inlet temperature", value: 0, unit: "°C", note: "No readings in this time range", tone: "neutral", color: "#38bdf8" },
      { id: "avg-power", label: "Average cooling power", value: 0, unit: "kW", note: "No readings in this time range", tone: "neutral", color: "#a78bfa" },
      { id: "outliers", label: "Flagged outliers", value: 0, unit: "events", note: "No readings in this time range", tone: "neutral", color: "#fbbf24" },
      { id: "total-cost", label: "Recorded energy cost", value: 0, unit: "USD", note: "No readings in this time range", tone: "neutral", color: "#34d399" },
    ];
    nextDashboard.components.temperature_trend = { labels: [], inlet_c: [], outlet_c: [], inlet_watch_c: 27 };
    nextDashboard.components.strategy_performance.items = [];
    nextDashboard.components.alerts.items = [];
    nextDashboard.components.recent_events.items = [];
    return nextDashboard;
  }

  function buildDashboardFromEvents(inputEvents, fileName, format) {
    const events = [...inputEvents].sort((left, right) => left.sort_ms - right.sort_ms || left.source_index - right.source_index);
    const eventCount = events.length;
    const outlierCount = events.filter((event) => event.is_outlier).length;
    const thresholdCount = events.filter((event) => event.inlet_temperature_c > 27).length;
    const minPower = events.reduce((minimum, event) => Math.min(minimum, event.cooling_power_kw), Number.POSITIVE_INFINITY);
    const maxPower = events.reduce((maximum, event) => Math.max(maximum, event.cooling_power_kw), Number.NEGATIVE_INFINITY);
    const nextDashboard = deepClone(bundledDashboard);

    nextDashboard.meta = {
      ...nextDashboard.meta,
      generated_at: new Date().toISOString(),
      source_file: fileName,
      source_rows: eventCount,
      source_range: formatRange(events),
      event_schema: format.startsWith("19-column") ? "1.1" : "derived legacy",
      import_format: format,
    };
    nextDashboard.components.kpis.items = [
      {
        id: "avg-inlet",
        label: "Average inlet temperature",
        value: round(average(events.map((event) => event.inlet_temperature_c)), 2),
        unit: "°C",
        note: `${thresholdCount.toLocaleString()} ${thresholdCount === 1 ? "reading" : "readings"} exceeded the 27°C watch threshold`,
        tone: thresholdCount ? "warning" : "safe",
        color: "#38bdf8",
      },
      {
        id: "avg-power",
        label: "Average cooling power",
        value: round(average(events.map((event) => event.cooling_power_kw)), 3),
        unit: "kW",
        note: `Observed range: ${minPower.toFixed(2)}–${maxPower.toFixed(2)} kW`,
        tone: "info",
        color: "#a78bfa",
      },
      {
        id: "outliers",
        label: "Flagged outliers",
        value: outlierCount,
        unit: "events",
        note: `${((outlierCount / eventCount) * 100).toFixed(2)}% of selected events`,
        tone: outlierCount ? "warning" : "safe",
        color: "#fbbf24",
      },
      {
        id: "total-cost",
        label: "Recorded energy cost",
        value: round(events.reduce((total, event) => total + event.total_energy_cost_usd, 0), 2),
        unit: "USD",
        note: `Sum across ${eventCount.toLocaleString()} selected observations`,
        tone: "info",
        color: "#34d399",
      },
    ];
    nextDashboard.components.temperature_trend = buildTrend(events);
    nextDashboard.components.strategy_performance.items = buildStrategyPerformance(events);
    nextDashboard.components.alerts.items = buildAlerts(events);
    nextDashboard.components.scenario_coverage.items = buildScenarioCoverage(events);
    nextDashboard.components.recent_events.items = [...events].reverse().slice(0, 8).map((event) => ({
      timestamp: formatCompactTime(event.sort_ms),
      device_id: event.device_id,
      server_workload_pct: event.server_workload_pct,
      inlet_temperature_c: event.inlet_temperature_c,
      outlet_temperature_c: event.outlet_temperature_c,
      cooling_power_kw: event.cooling_power_kw,
      cooling_strategy_action: event.cooling_strategy_action,
      is_outlier: event.is_outlier,
      scenario: event.scenario,
    }));
    nextDashboard.replay_events = events.map((event) => ({
      timestamp: event.timestamp,
      scenario: event.scenario,
      severity: event.severity,
      device_id: event.device_id,
      server_workload_pct: event.server_workload_pct,
      inlet_temperature_c: event.inlet_temperature_c,
      outlet_temperature_c: event.outlet_temperature_c,
      cooling_power_kw: event.cooling_power_kw,
      cooling_strategy_action: event.cooling_strategy_action,
      is_outlier: event.is_outlier,
    }));
    return nextDashboard;
  }

  function prepareCsvImport(text, fileName) {
    const parsed = parseCsvText(text);
    const format = detectCsvFormat(parsed.headers);
    const events = recordsToEvents(parsed.records, format);
    return { format, events, dashboard: buildDashboardFromEvents(events, fileName, format) };
  }

  // Expose pure CSV functions for deterministic tests without a browser DOM.
  window.COOLING_CSV_TOOLS = { parseCsvText, prepareCsvImport, deriveOutlier };
  if (typeof document === "undefined") return;

  function formatMetric(item) {
    if (item.id === "avg-power") return item.value.toFixed(3);
    if (item.id === "total-cost") return `$${item.value.toFixed(2)}`;
    return Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(2);
  }

  function initializeTabs() {
    const tabButtons = Array.from(document.querySelectorAll(".tab[data-panel]"));
    function activateTab(button, shouldFocus) {
      tabButtons.forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === button.getAttribute("aria-controls"));
      });
      if (shouldFocus) button.focus();
      window.requestAnimationFrame(() => charts.forEach((chart) => chart.resize()));
    }

    tabButtons.forEach((button, index) => {
      button.addEventListener("click", () => activateTab(button, false));
      button.addEventListener("keydown", (event) => {
        let targetIndex = index;
        if (event.key === "ArrowRight") targetIndex = (index + 1) % tabButtons.length;
        else if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabButtons.length) % tabButtons.length;
        else if (event.key === "Home") targetIndex = 0;
        else if (event.key === "End") targetIndex = tabButtons.length - 1;
        else return;
        event.preventDefault();
        activateTab(tabButtons[targetIndex], true);
      });
    });
  }

  function renderMeta() {
    byId("snapshotRange").textContent = dashboard.meta.source_range;
    byId("sourceRows").textContent = `${dashboard.meta.source_rows.toLocaleString()} events`;
    const pill = byId("sourceModePill");
    const isBackend = analyticsMode === "backend";
    pill.textContent = currentImport ? "CSV import" : isBackend ? "PostgreSQL live" : "Bundled sample";
    pill.className = `status-pill ${currentImport || isBackend ? "status-imported" : "status-snapshot"}`;
  }

  function renderKpis() {
    const row = byId("kpiRow");
    row.replaceChildren();
    dashboard.components.kpis.items.forEach((item) => {
      const card = makeElement("article", "kpi-card");
      card.style.setProperty("--kpi-color", item.color);
      card.appendChild(makeElement("div", "kpi-label", item.label));
      const value = makeElement("div", "kpi-value", formatMetric(item));
      value.appendChild(makeElement("span", "kpi-unit", item.unit));
      card.appendChild(value);
      card.appendChild(makeElement("div", `kpi-delta ${item.tone}`, item.note));
      row.appendChild(card);
    });
  }

  function renderAlerts() {
    const feed = byId("alertFeed");
    const alerts = dashboard.components.alerts.items;
    feed.replaceChildren();
    byId("alertCount").textContent = `${alerts.filter((item) => item.severity !== "info").length} open`;
    if (!alerts.length) {
      feed.appendChild(makeElement("p", "empty-state", "No alerts in this dataset."));
      return;
    }
    alerts.forEach((alert) => {
      const tone = alert.severity === "warning" ? "warn" : alert.severity === "critical" ? "crit" : "ok";
      const item = makeElement("div", `alert-item alert-${tone}`);
      item.appendChild(makeElement("div", "alert-dot"));
      const copy = makeElement("div", "alert-copy");
      const titleRow = makeElement("div", "alert-title-row");
      titleRow.appendChild(makeElement("span", "alert-title", alert.title));
      titleRow.appendChild(makeElement("span", `status-pill status-${alert.severity}`, alert.severity));
      copy.appendChild(titleRow);
      copy.appendChild(makeElement("div", "alert-msg", alert.message));
      const eventSuffix = alert.event_id ? ` · ${alert.event_id.slice(0, 8)}` : "";
      copy.appendChild(makeElement("div", "alert-time", `${alert.timestamp}${eventSuffix}`));
      item.appendChild(copy);
      feed.appendChild(item);
    });
  }

  function renderStrategyTable() {
    const body = byId("strategyTableBody");
    const strategies = dashboard.components.strategy_performance.items;
    body.replaceChildren();
    if (!strategies.length) {
      const row = document.createElement("tr");
      const cell = makeElement("td", "empty-cell", "No strategy data is available.");
      cell.colSpan = 5;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    strategies.forEach((item) => {
      const row = document.createElement("tr");
      [item.strategy, item.events, `${item.avg_inlet_c.toFixed(2)}°C`, `${item.avg_power_kw.toFixed(3)} kW`, `$${item.avg_cost_usd.toFixed(4)}`]
        .forEach((value) => row.appendChild(makeElement("td", "", value)));
      body.appendChild(row);
    });
  }

  function renderRecentEvents() {
    const body = byId("recentEventsBody");
    const events = dashboard.components.recent_events.items;
    const selectedCount = dashboard.meta.source_rows;
    byId("recentEventsMeta").textContent = `${selectedCount.toLocaleString()} selected ${selectedCount === 1 ? "event" : "events"}`;
    body.replaceChildren();
    if (!events.length) {
      const row = document.createElement("tr");
      const cell = makeElement("td", "empty-cell", "No live session events yet.");
      cell.colSpan = 6;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    events.forEach((event) => {
      const row = document.createElement("tr");
      const thermalTone = event.inlet_temperature_c > 27 ? "value-critical" : event.inlet_temperature_c >= 25 ? "value-warning" : "value-safe";
      [
        { text: event.timestamp },
        { text: `${event.server_workload_pct.toFixed(2)}%` },
        { text: `${event.inlet_temperature_c.toFixed(2)} / ${event.outlet_temperature_c.toFixed(2)}°C`, className: thermalTone },
        { text: `${event.cooling_power_kw.toFixed(2)} kW` },
        { text: event.cooling_strategy_action },
      ].forEach((cell) => row.appendChild(makeElement("td", cell.className || "", cell.text)));
      const flagCell = document.createElement("td");
      flagCell.appendChild(makeElement("span", `status-pill ${event.is_outlier ? "status-warning" : "status-normal"}`, event.is_outlier ? "outlier" : "normal"));
      row.appendChild(flagCell);
      body.appendChild(row);
    });
  }

  function renderScenarioCards() {
    const grid = byId("scenarioGrid");
    grid.replaceChildren();
    dashboard.scenario_catalog.forEach((scenario) => {
      const slug = className(scenario.name);
      const card = makeElement("article", `scenario-card ${slug}`);
      card.appendChild(makeElement("span", `status-pill status-${slug}`, scenario.severity));
      card.appendChild(makeElement("h2", "", scenario.label));
      card.appendChild(makeElement("p", "", scenario.description));
      card.appendChild(makeElement("code", "scenario-response", `response: ${scenario.expected_response}`));
      grid.appendChild(card);
    });
  }

  function initializeSchemaCopy() {
    const preview = byId("scenarioSchemaPreview");
    const copyButton = byId("copySchemaButton");
    const status = byId("copyStatus");
    const schemaText = JSON.stringify(dashboard.event_schema_example, null, 2);
    preview.textContent = schemaText;
    copyButton.addEventListener("click", async () => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(schemaText);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = schemaText;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        status.textContent = "JSON copied.";
      } catch (error) {
        status.textContent = "Copy failed. Select the JSON block and copy it manually.";
      }
    });
  }

  function chartOptions(yConfig) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: true, labels: { color: "#9ca3af", boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 10 } } },
        tooltip: { backgroundColor: "#0a0c10", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1, titleColor: "#e8eaf0", bodyColor: "#9ca3af" },
      },
      scales: {
        x: { ticks: { color: "#6b7280", font: { size: 9 }, maxRotation: 0 }, grid: { color: "rgba(255,255,255,0.035)" }, border: { color: "rgba(255,255,255,0.07)" } },
        y: { ticks: { color: "#6b7280", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.035)" }, border: { color: "rgba(255,255,255,0.07)" }, ...yConfig },
      },
    };
  }

  function showChartFallback(id) {
    const element = byId(id);
    element.hidden = false;
    element.textContent = "The local chart library could not be loaded. Tables and metrics remain available.";
  }

  // Count the scenarios currently held by the browser listener buffer. This
  // intentionally ignores the bundled or imported dashboard snapshot so the
  // coverage chart always describes the live Raw Event Stream session.
  function liveScenarioCoverage() {
    const counts = new Map(GENERATED_SCENARIOS.map((scenario) => [scenario, 0]));
    streamState.events.forEach((event) => {
      counts.set(event.scenario, (counts.get(event.scenario) || 0) + 1);
    });
    return GENERATED_SCENARIOS.map((scenario) => ({
      scenario: humanizeScenario(scenario),
      events: counts.get(scenario) || 0,
      color: SCENARIO_COLORS[scenario],
    }));
  }

  // Refresh both the visible event count and the Chart.js dataset whenever a
  // generated event enters the listener buffer or the session is cleared.
  function updateScenarioCoverage() {
    const coverage = liveScenarioCoverage();
    const count = streamState.events.length;
    byId("scenarioCoverageMeta").textContent = `${count.toLocaleString()} buffered ${count === 1 ? "event" : "events"}`;
    if (!scenarioChart) return;
    scenarioChart.data.labels = coverage.map((item) => item.scenario);
    scenarioChart.data.datasets[0].data = coverage.map((item) => item.events);
    scenarioChart.data.datasets[0].backgroundColor = coverage.map((item) => item.color);
    scenarioChart.update("none");
  }

  // Classify backend rows from measurable cooling parameters. Explicit named
  // scenarios from the terminal generator win for non-normal cases; rows from
  // older database records or generic "normal" labels are checked against the
  // same operational thresholds used by the generator/data dictionary.
  function detectCoolingScenario(event) {
    const explicit = SCENARIOS.has(event.scenario) ? event.scenario : "";
    const workload = Number(event.server_workload_pct);
    const inlet = Number(event.inlet_temperature_c);
    const outlet = Number(event.outlet_temperature_c);
    const ambient = Number(event.ambient_temperature_c);
    const power = Number(event.cooling_power_kw);
    const chiller = Number(event.chiller_usage_pct);
    const ahu = Number(event.ahu_usage_pct);
    const cost = Number(event.total_energy_cost_usd);
    const deviation = Number(event.temperature_deviation_c);
    if (explicit && explicit !== "normal" && explicit !== "legacy") return explicit;
    if (event.sensor_status === "fault" || event.data_quality === "suspect") return "sensor_fault";
    if (Number.isFinite(workload) && workload >= 82 && Number.isFinite(inlet) && inlet >= 28 && Number.isFinite(power) && power <= 0.5) return "cooling_failure";
    if (Number.isFinite(workload) && workload >= 85) return "workload_spike";
    if (event.is_outlier === true || (Number.isFinite(inlet) && (inlet < 15.371 || inlet > 27.714)) || (Number.isFinite(outlet) && (outlet < 18.565 || outlet > 34.391)) || (Number.isFinite(ambient) && ambient > 31.826) || (Number.isFinite(chiller) && chiller > 100) || (Number.isFinite(ahu) && ahu > 65.571) || (Number.isFinite(cost) && cost > 0.145) || (Number.isFinite(deviation) && deviation > 6.85)) return "outlier";
    return "normal";
  }

  function initializeCharts() {
    charts.forEach((chart) => chart.destroy());
    charts = [];
    scenarioChart = null;
    ["temperatureFallback", "strategyFallback", "scenarioFallback"].forEach((id) => {
      byId(id).hidden = true;
      byId(id).textContent = "";
    });
    if (typeof window.Chart !== "function") {
      ["temperatureFallback", "strategyFallback", "scenarioFallback"].forEach(showChartFallback);
      return;
    }

    const trend = dashboard.components.temperature_trend;
    charts.push(new window.Chart(byId("temperatureChart"), {
      type: "line",
      data: {
        labels: trend.labels,
        datasets: [
          { label: "Inlet °C", data: trend.inlet_c, borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.09)", borderWidth: 2, pointRadius: 2, fill: true, tension: 0.32 },
          { label: "Outlet °C", data: trend.outlet_c, borderColor: "#fb7185", backgroundColor: "transparent", borderWidth: 2, pointRadius: 2, tension: 0.32 },
          { label: "Inlet watch", data: trend.labels.map(() => trend.inlet_watch_c), borderColor: "rgba(251,191,36,0.65)", borderDash: [5, 5], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: chartOptions({ ticks: { color: "#6b7280", font: { size: 9 }, callback: (value) => `${value}°C` } }),
    }));

    const strategies = dashboard.components.strategy_performance.items;
    charts.push(new window.Chart(byId("strategyChart"), {
      type: "bar",
      data: {
        labels: strategies.map((item) => item.strategy),
        datasets: [{ label: "Average power (kW)", data: strategies.map((item) => item.avg_power_kw), backgroundColor: ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#60a5fa"], borderRadius: 5, maxBarThickness: 42 }],
      },
      options: chartOptions({ ticks: { color: "#6b7280", font: { size: 9 }, callback: (value) => `${Number(value).toFixed(2)} kW` } }),
    }));

    const coverage = liveScenarioCoverage();
    scenarioChart = new window.Chart(byId("scenarioChart"), {
      type: "doughnut",
      data: { labels: coverage.map((item) => item.scenario), datasets: [{ data: coverage.map((item) => item.events), backgroundColor: coverage.map((item) => item.color), borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { position: "bottom", labels: { color: "#9ca3af", boxWidth: 10, padding: 14, font: { size: 10 } } },
          tooltip: { backgroundColor: "#0a0c10", titleColor: "#e8eaf0", bodyColor: "#9ca3af" },
        },
      },
    });
    charts.push(scenarioChart);
    updateScenarioCoverage();
  }

  function randomBetween(minimum, maximum, places = 2) {
    return round(minimum + Math.random() * (maximum - minimum), places);
  }

  function chooseGeneratedScenario(requestedScenario) {
    if (GENERATED_SCENARIOS.includes(requestedScenario)) return requestedScenario;
    const roll = Math.random();
    let cumulative = 0;
    for (const [scenario, weight] of MIXED_SCENARIO_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) return scenario;
    }
    return "normal";
  }

  function generatedUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  // Generate one complete, plausible schema 1.1 cooling event without reading
  // from the bundled snapshot, an imported CSV, MQTT, or browser storage.
  function generateCoolingEvent(requestedScenario = "all") {
    const scenario = chooseGeneratedScenario(requestedScenario);
    let workload = randomBetween(38, 82);
    let inlet = randomBetween(18, 25.8);
    let outlet = inlet + randomBetween(3.2, 6.4);
    let ambient = randomBetween(17, 29);
    let power = randomBetween(3.2, 8.8);
    let chiller = randomBetween(25, 68);
    let ahu = randomBetween(25, 60);
    let action = workload > 70 || inlet > 24.5 ? "Increase Chiller" : workload < 48 ? "Eco Mode" : "Maintain";
    let severity = "info";
    let failurePoint = null;
    let sensorStatus = "online";
    let dataQuality = "valid";

    if (scenario === "outlier") {
      workload = randomBetween(60, 95);
      inlet = randomBetween(28.2, 34);
      outlet = inlet + randomBetween(4, 8);
      ambient = randomBetween(25, 33.5);
      power = randomBetween(8, 13);
      chiller = randomBetween(65, 100);
      ahu = randomBetween(55, 78);
      action = "Boost All";
      severity = "warning";
    } else if (scenario === "workload_spike") {
      workload = randomBetween(90, 100);
      inlet = randomBetween(25.5, 30.5);
      outlet = inlet + randomBetween(5, 9);
      ambient = randomBetween(22, 31);
      power = randomBetween(10, 15);
      chiller = randomBetween(80, 100);
      ahu = randomBetween(72, 100);
      action = "Boost All";
      severity = inlet > 28.5 ? "critical" : "warning";
    } else if (scenario === "cooling_failure") {
      workload = randomBetween(70, 98);
      inlet = randomBetween(30, 39);
      outlet = inlet + randomBetween(5, 10);
      ambient = randomBetween(23, 32);
      power = randomBetween(1.2, 4.5);
      chiller = randomBetween(0, 20);
      ahu = randomBetween(25, 60);
      action = "Boost All";
      severity = "critical";
      failurePoint = "chiller_unit";
      sensorStatus = "degraded";
    } else if (scenario === "sensor_fault") {
      workload = randomBetween(35, 85);
      inlet = Math.random() < 0.5 ? randomBetween(5, 11) : randomBetween(42, 58);
      outlet = randomBetween(22, 32);
      ambient = randomBetween(18, 30);
      power = randomBetween(3, 9);
      chiller = randomBetween(30, 70);
      ahu = randomBetween(30, 65);
      action = "Maintain";
      severity = "critical";
      failurePoint = "inlet_temperature_sensor";
      sensorStatus = "fault";
      dataQuality = "suspect";
    }

    streamState.sequence += 1;
    const timestamp = new Date().toISOString();
    const event = {
      schema_version: "1.1",
      event_id: generatedUuid(),
      timestamp,
      scenario,
      severity,
      failure_point: failurePoint,
      sensor_status: sensorStatus,
      data_quality: dataQuality,
      scenario_details: {
        source: "dashboard_browser_generator",
        selected_mode: requestedScenario === "all" ? "mixed" : requestedScenario,
        sequence: streamState.sequence,
      },
      device_id: `cooling-sim-${String(1 + Math.floor(Math.random() * 4)).padStart(2, "0")}`,
      server_workload_pct: round(workload, 2),
      inlet_temperature_c: round(inlet, 2),
      outlet_temperature_c: round(outlet, 2),
      ambient_temperature_c: round(ambient, 2),
      cooling_power_kw: round(power, 2),
      chiller_usage_pct: round(chiller, 2),
      ahu_usage_pct: round(ahu, 2),
      total_energy_cost_usd: round(power * randomBetween(0.011, 0.016, 4), 4),
      temperature_deviation_c: round(Math.abs(outlet - inlet), 2),
      cooling_strategy_action: action,
      cooling_strategy_code: ACTION_CODES[action],
    };
    event.is_outlier = scenario !== "normal" || deriveOutlier(event);
    return event;
  }

  function updateGeneratorFilter() {
    const filter = byId("scenarioFilter");
    const selected = filter.value;
    filter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "ALL";
    filter.appendChild(allOption);
    GENERATED_SCENARIOS.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario;
      option.textContent = humanizeScenario(scenario).toUpperCase();
      filter.appendChild(option);
    });
    filter.value = selected === "all" || GENERATED_SCENARIOS.includes(selected) ? selected : "all";
  }

  function updateGeneratorStats() {
    byId("rowCount").textContent = String(byId("rawStream").children.length);
    byId("statIn").textContent = streamState.generated.toLocaleString();
    byId("statOutliers").textContent = streamState.outliers.toLocaleString();
    byId("statFiltered").textContent = "MQTT / POSTGRES";
    byId("exportGeneratedCsv").disabled = streamState.events.length === 0;
  }

  function csvField(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function generatedEventCsvRow(event) {
    return [
      event.timestamp,
      event.server_workload_pct,
      event.inlet_temperature_c,
      event.outlet_temperature_c,
      event.ambient_temperature_c,
      event.cooling_power_kw,
      event.chiller_usage_pct,
      event.ahu_usage_pct,
      event.total_energy_cost_usd,
      event.temperature_deviation_c,
      event.cooling_strategy_action,
      event.cooling_strategy_code,
      event.scenario,
      event.severity,
      event.failure_point,
      event.sensor_status,
      event.data_quality,
      event.is_outlier,
      event.event_id,
    ].map(csvField).join(",");
  }

  function buildGeneratedCsv(events) {
    const header = [...BASE_HEADERS, ...METADATA_HEADERS].map(csvField).join(",");
    return `\uFEFF${[header, ...events.map(generatedEventCsvRow)].join("\r\n")}\r\n`;
  }

  function exportGeneratedCsv() {
    if (!streamState.events.length) return;
    const csv = buildGeneratedCsv(streamState.events);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    link.href = url;
    link.download = `dashboard_generated_cooling_events_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function appendStreamEvent(event) {
    if (streamState.paused) return;
    const row = makeElement("div", "raw-row");
    const header = makeElement("div", "raw-row-head");
    header.appendChild(makeElement("span", "ts", `[${new Date(event.timestamp).toISOString().replace("T", " ").slice(0, 23)}]`));
    header.appendChild(makeElement("span", "scenario", event.scenario.toUpperCase()));
    header.appendChild(makeElement("span", `sid ${event.severity === "critical" ? "critical" : ""}`, event.device_id));
    row.appendChild(header);
    row.appendChild(makeElement(
      "span",
      "details",
      `workload=${event.server_workload_pct.toFixed(2)}% · inlet=${event.inlet_temperature_c.toFixed(2)}°C · outlet=${event.outlet_temperature_c.toFixed(2)}°C · power=${event.cooling_power_kw.toFixed(2)} kW · action=${event.cooling_strategy_action} · quality=${event.data_quality} · flag=${event.is_outlier ? "OUTLIER" : "normal"}`
    ));
    const stream = byId("rawStream");
    stream.appendChild(row);
    while (stream.children.length > 100) stream.removeChild(stream.firstChild);
    stream.scrollTop = stream.scrollHeight;

    streamState.events.push(event);
    if (streamState.events.length > MAX_GENERATED_EVENTS) streamState.events.shift();
    streamState.generated += 1;
    if (event.is_outlier) streamState.outliers += 1;
    updateGeneratorStats();
    updateScenarioCoverage();
    if (analyticsMode === "backend") {
      const analyticsEvent = eventFromBackend(event, analyticsEvents.length);
      if (analyticsEvent && !analyticsEvents.some((candidate) => candidate.event_id === analyticsEvent.event_id)) {
        analyticsEvents.push(analyticsEvent);
        scheduleAnalyticsRefresh();
      }
    }
  }

  function resetGenerator() {
    streamState.generated = 0;
    streamState.outliers = 0;
    streamState.paused = false;
    streamState.startedAt = Date.now();
    streamState.events = [];
    byId("pauseStream").textContent = "Pause";
    byId("rawStream").replaceChildren();
    byId("rawSourceLabel").textContent = backendConnected ? "MQTT → PostgreSQL → dashboard" : "connecting to MQTT/PostgreSQL backend…";
    byId("statUp").textContent = "00:00:00";
    updateGeneratorStats();
    updateScenarioCoverage();
  }

  function initializeGenerator() {
    byId("pauseStream").addEventListener("click", () => {
      streamState.paused = !streamState.paused;
      byId("pauseStream").textContent = streamState.paused ? "Resume" : "Pause";
    });
    byId("clearGeneratedEvents").addEventListener("click", () => resetGenerator(false));
    byId("exportGeneratedCsv").addEventListener("click", exportGeneratedCsv);
    window.setInterval(() => {
      const elapsed = Date.now() - streamState.startedAt;
      const seconds = Math.floor(elapsed / 1000) % 60;
      const minutes = Math.floor(elapsed / 60000) % 60;
      const hours = Math.floor(elapsed / 3600000);
      byId("statUp").textContent = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
    }, 1000);
    initializeBackendStream();
  }

  function initializeBackendStream() {
    if (!window.EventSource) {
      byId("rawSourceLabel").textContent = "EventSource unavailable — start the local bridge";
      return;
    }
    // Use the bridge explicitly rather than a relative /api/events path. The
    // dashboard is often opened from file:// or another local web server, and
    // a relative path would otherwise target the wrong process.
    const endpoint = "http://127.0.0.1:8765/api/events";
    try {
      backendSource = new window.EventSource(endpoint);
      backendSource.onopen = () => {
        backendConnected = true;
        byId("rawSourceLabel").textContent = "MQTT → PostgreSQL → dashboard";
      };
      backendSource.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data);
          if (!event.event_id || streamState.paused) return;
          ["server_workload_pct", "inlet_temperature_c", "outlet_temperature_c", "cooling_power_kw", "chiller_usage_pct", "ahu_usage_pct", "total_energy_cost_usd", "temperature_deviation_c"].forEach((field) => { event[field] = Number(event[field]); });
          event.detected_scenario = detectCoolingScenario(event);
          event.scenario = event.detected_scenario;
          appendStreamEvent(event);
        } catch (error) {
          byId("rawSourceLabel").textContent = "Backend event could not be displayed";
        }
      };
      backendSource.onerror = () => {
        backendConnected = false;
        byId("rawSourceLabel").textContent = "Backend disconnected — retrying…";
      };
    } catch (error) {
      byId("rawSourceLabel").textContent = "Backend unavailable — start the local bridge";
    }
  }

  function renderTimeFilterStatus() {
    const status = byId("timeFilterStatus");
    const range = selectedTimeRange();
    if (range.error) {
      status.textContent = range.error;
      status.className = "time-filter-status error";
      return;
    }
    if (analyticsEvents === null) {
      status.textContent = "Connect the local bridge or load a CSV to filter individual events.";
      status.className = "time-filter-status";
      return;
    }
    const count = dashboard.meta.source_rows;
    const rangeLabel = range.start === null && range.end === null ? "all available time" : dashboard.meta.source_range;
    status.textContent = `${count.toLocaleString()} ${count === 1 ? "event" : "events"} included · ${rangeLabel}`;
    status.className = "time-filter-status";
  }

  function renderAnalytics() {
    renderMeta();
    renderImportSource();
    renderKpis();
    renderAlerts();
    renderStrategyTable();
    renderRecentEvents();
    initializeCharts();
    renderTimeFilterStatus();
  }

  function refreshAnalyticsFromRange() {
    if (analyticsEvents === null) {
      renderTimeFilterStatus();
      return;
    }
    const filtered = filterEventsByTime(analyticsEvents);
    if (filtered.error) {
      renderTimeFilterStatus();
      return;
    }
    const sourceName = analyticsMode === "backend" ? "PostgreSQL cooling_events" : currentImport ? currentImport.name : "Bundled cooling event sample";
    const format = analyticsMode === "backend" ? "PostgreSQL live event stream" : currentImport ? currentImport.format : "Bundled 19-column event sample";
    dashboard = filtered.events.length
      ? buildDashboardFromEvents(filtered.events, sourceName, format)
      : buildEmptyDashboard(sourceName, format);
    renderAnalytics();
  }

  function scheduleAnalyticsRefresh() {
    if (analyticsRefreshTimer !== null) return;
    analyticsRefreshTimer = window.setTimeout(() => {
      analyticsRefreshTimer = null;
      refreshAnalyticsFromRange();
    }, 100);
  }

  async function loadBackendAnalytics() {
    try {
      const response = await window.fetch("http://127.0.0.1:8765/api/events/history", { cache: "no-store" });
      if (!response.ok) throw new Error(`History request failed (${response.status})`);
      const payload = await response.json();
      if (!Array.isArray(payload.events)) throw new Error("History response was invalid");
      analyticsEvents = payload.events.map(eventFromBackend).filter(Boolean);
      analyticsMode = "backend";
      currentImport = null;
      refreshAnalyticsFromRange();
    } catch (error) {
      // The static bundled sample remains useful when PostgreSQL is not running.
      renderTimeFilterStatus();
    }
  }

  function initializeTimeFilter() {
    ["rangeStart", "rangeEnd"].forEach((id) => ["input", "change"].forEach((type) => byId(id).addEventListener(type, refreshAnalyticsFromRange)));
    byId("resetTimeRange").addEventListener("click", () => {
      byId("rangeStart").value = "";
      byId("rangeEnd").value = "";
      refreshAnalyticsFromRange();
    });
  }

  window.COOLING_STREAM_TOOLS = {
    buildGeneratedCsv,
  };

  function renderImportSource() {
    byId("csvSourceName").textContent = currentImport
      ? `"${currentImport.name}" CSV is loaded`
      : analyticsMode === "backend" ? "PostgreSQL event history is active"
      : "Bundled sample is active";
    byId("csvSourceMeta").textContent = currentImport
      ? `${currentImport.format} · ${currentImport.rows.toLocaleString()} events · session only`
      : analyticsMode === "backend" ? `${analyticsEvents.length.toLocaleString()} events · live updates included`
      : `${bundledDashboard.meta.source_rows.toLocaleString()} events`;
    byId("csvLoadedActions").hidden = !currentImport;
  }

  function setImportMessage(message, tone) {
    const element = byId("csvImportMessage");
    element.textContent = message;
    element.className = `import-message${tone ? ` ${tone}` : ""}`;
  }

  function renderDashboard() {
    renderImportSource();
    renderScenarioCards();
    renderAnalytics();
    resetGenerator();
  }

  async function importFile(file) {
    const dropZone = byId("csvDropZone");
    dropZone.setAttribute("aria-busy", "true");
    setImportMessage(`Checking ${file.name}…`, "");
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a file ending in .csv.");
      if (file.size > MAX_FILE_BYTES) throw new Error("The CSV is larger than the 20 MB browser limit.");
      const prepared = prepareCsvImport(await file.text(), file.name);
      currentImport = { name: file.name, format: prepared.format, rows: prepared.events.length };
      analyticsEvents = prepared.events;
      analyticsMode = "import";
      renderDashboard();
      refreshAnalyticsFromRange();
      setImportMessage(`Loaded ${prepared.events.length.toLocaleString()} rows. Every dashboard view now uses ${file.name}.`, "success");
    } catch (error) {
      setImportMessage(`Import failed: ${error.message} The current dashboard was not changed.`, "error");
    } finally {
      dropZone.removeAttribute("aria-busy");
      dropZone.classList.remove("drag-active");
      byId("csvFileInput").value = "";
    }
  }

  function initializeCsvImport() {
    const input = byId("csvFileInput");
    const dropZone = byId("csvDropZone");
    input.addEventListener("change", () => {
      if (input.files.length) importFile(input.files[0]);
    });
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    ["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-active");
    }));
    ["dragleave", "dragend"].forEach((type) => dropZone.addEventListener(type, () => dropZone.classList.remove("drag-active")));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-active");
      if (event.dataTransfer.files.length !== 1) {
        setImportMessage("Import failed: drop exactly one CSV file. The current dashboard was not changed.", "error");
        return;
      }
      importFile(event.dataTransfer.files[0]);
    });
    byId("resetCsvButton").addEventListener("click", () => {
      dashboard = deepClone(bundledDashboard);
      currentImport = null;
      restoreBundledAnalytics();
      renderDashboard();
      loadBackendAnalytics();
      setImportMessage("Imported CSV removed. Bundled sample restored.", "success");
    });

    byId("openDifferentCsvButton").addEventListener("click", () => input.click());
  }

  initializeTabs();
  initializeSchemaCopy();
  initializeGenerator();
  initializeCsvImport();
  initializeTimeFilter();
  restoreBundledAnalytics();
  renderDashboard();
  loadBackendAnalytics();
})();
