"use strict";

// ─────────────────── Pages ───────────────────────────────

function showPage(name) {
  document.getElementById("page-landing").style.display = name === "landing" ? "" : "none";
  document.getElementById("page-app").style.display     = name === "app"     ? "" : "none";
}

// ─────────────────── Dark mode ───────────────────────────

function toggleDark() {
  const on = document.getElementById("dark-toggle").checked;
  document.body.classList.toggle("dark", on);
  localStorage.setItem("efp_dark", on ? "1" : "0");
  // Page chrome toggles; matplotlib bg is independent (user picks in Plot Settings).
}

// Rerender whichever plot the user last saw. Used by the overlap controls
// and other live-update triggers.
function rerenderLast() {
  if (lastPlotKind === "delta_vs_time") return plotDeltaVsTime();
  if (overplotTraces.length) return renderOverplot();
}

// ─────────────────── Inline plot view controls ───────────

function _currentYPanel() {
  const el = $("pc_yPanel");
  return (el && el.value) || "delta";
}

// Pull the inline x limit + figure size inputs into plotSettings.
// The y inputs + y tick format are stored *per-subplot* keyed by the panel dropdown.
function _readInlinePlotControls() {
  plotSettings.xMin   = _vS("pc_xMin");
  plotSettings.xMax   = _vS("pc_xMax");
  plotSettings.xTickFormat = _vS("pc_xTickFormat") || "auto";
  const panel = _currentYPanel();
  if (!plotSettings.yLimits) plotSettings.yLimits = {};
  if (!plotSettings.yTickFormats) plotSettings.yTickFormats = {};
  plotSettings.yLimits[panel] = {
    min: _vS("pc_yMin"),
    max: _vS("pc_yMax"),
  };
  const tick = _vS("pc_yTickFormat") || "auto";
  if (tick === "auto") delete plotSettings.yTickFormats[panel];
  else plotSettings.yTickFormats[panel] = tick;
  const w = parseFloat(_vS("pc_width"));
  const h = parseFloat(_vS("pc_height"));
  if (Number.isFinite(w) && w > 0) plotSettings.width  = w;
  if (Number.isFinite(h) && h > 0) plotSettings.height = h;
  plotSettings.limitsKind = lastPlotKind;
}

function _writeInlinePlotControls() {
  _setV("pc_xMin",   plotSettings.xMin);
  _setV("pc_xMax",   plotSettings.xMax);
  _setV("pc_xTickFormat", plotSettings.xTickFormat || "auto");
  const panel = _currentYPanel();
  const yl = (plotSettings.yLimits && plotSettings.yLimits[panel]) || {};
  _setV("pc_yMin",   yl.min || "");
  _setV("pc_yMax",   yl.max || "");
  const tick = (plotSettings.yTickFormats && plotSettings.yTickFormats[panel]) || "auto";
  _setV("pc_yTickFormat", tick);
  _setV("pc_width",  plotSettings.width);
  _setV("pc_height", plotSettings.height);
}

// Rebuild the "Y axis for" dropdown to reflect the panels in the current view.
function _updateYPanelDropdown() {
  const sel = $("pc_yPanel");
  if (!sel) return;
  let panels;
  if (lastPlotKind === "delta_vs_time") {
    const stacked = Array.from(document.querySelectorAll(".stack-quant:checked"))
      .map(cb => cb.dataset.key);
    panels = [{ key: "delta", label: "δ" }, ...stacked.map(k => ({ key: k, label: k }))];
  } else {
    panels = [{ key: "delta", label: "δ" }];
  }
  const prev = sel.value;
  sel.innerHTML = "";
  for (const p of panels) {
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  // Preserve current selection if still present, else fall back to first panel.
  if (panels.some(p => p.key === prev)) sel.value = prev;
  else sel.value = panels[0].key;
  // Sync the y min/max inputs to whatever's now selected.
  _writeInlinePlotControls();
}

function _onYPanelChange() {
  // Just refresh the min/max inputs to show the selected panel's saved limits.
  _writeInlinePlotControls();
}

function toggleCdfSubplot() {
  plotSettings.showCdf = !plotSettings.showCdf;
  const btn = $("btn_toggle_cdf");
  if (btn) btn.textContent = plotSettings.showCdf ? "− CDF subplot" : "+ CDF subplot";
  rerenderLast();
}

function applyPlotControls() {
  _readInlinePlotControls();
  rerenderLast();
}

function autoscalePlotControls() {
  plotSettings.xMin = "";
  plotSettings.xMax = "";
  plotSettings.yLimits = {};
  plotSettings.limitsKind = null;
  _writeInlinePlotControls();
  rerenderLast();
}

// Drop any previously-set limits when the active plot kind changes — they
// were entered for the *other* view and would mis-frame the new one.
function _maybeClearStaleLimits(forKind) {
  const lk = plotSettings.limitsKind;
  if (lk && lk !== forKind) {
    plotSettings.xMin = "";
    plotSettings.xMax = "";
    plotSettings.yLimits = {};
    plotSettings.limitsKind = null;
    _writeInlinePlotControls();
  }
}

// ─────────────────── Inline legend editor ────────────────
function _renderLegendEditor() {
  const wrap = $("plot-legend-editor");
  const rows = $("ple-rows");
  if (!wrap || !rows) return;
  if (lastPlotKind !== "overplot" || !overplotTraces.length) {
    wrap.style.display = "none";
    rows.innerHTML = "";
    return;
  }
  wrap.style.display = "";
  rows.innerHTML = "";
  for (let i = 0; i < overplotTraces.length; i++) {
    const defaultLabel = overplotTraces[i].label;
    const row = document.createElement("div");
    row.className = "ple-row";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "ple-color";
    colorInput.value = _colorToHex(plotSettings.colorOverrides[i] || DEFAULT_HEX_PALETTE[i % DEFAULT_HEX_PALETTE.length]);
    colorInput.dataset.idx = i;
    colorInput.addEventListener("input", () => {
      plotSettings.colorOverrides[i] = colorInput.value;
      renderOverplot();
    });

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = plotSettings.labelOverrides[i] || defaultLabel;
    labelInput.placeholder = defaultLabel;
    labelInput.dataset.idx = i;
    labelInput.addEventListener("change", () => {
      const v = labelInput.value;
      if (v && v.trim() && v !== defaultLabel) plotSettings.labelOverrides[i] = v;
      else delete plotSettings.labelOverrides[i];
      renderOverplot();
    });

    row.appendChild(colorInput);
    row.appendChild(labelInput);
    rows.appendChild(row);
  }
}

// Default matplotlib-ish palette so we can prefill the inline color pickers.
const DEFAULT_HEX_PALETTE = [
  "#4C72B0", "#DD8452", "#55A467", "#C44E52", "#8172B2",
  "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD",
];

// Cumulative-distribution-percent at value `x`, via trapezoidal integration
// of the (bin centers, pdf) pair coming back from monteCarloThreshold().
function _cdfPercentAt(centers, pdf, x) {
  const n = centers.length;
  if (n < 2) return NaN;
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    total += 0.5 * (pdf[i] + pdf[i + 1]) * (centers[i + 1] - centers[i]);
  }
  if (total <= 0) return 0;
  if (x <= centers[0]) return 0;
  if (x >= centers[n - 1]) return 100;
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const c0 = centers[i], c1 = centers[i + 1];
    const p0 = pdf[i],     p1 = pdf[i + 1];
    if (x >= c1) {
      acc += 0.5 * (p0 + p1) * (c1 - c0);
      continue;
    }
    const frac = (x - c0) / (c1 - c0);
    const px = p0 + frac * (p1 - p0);
    acc += 0.5 * (p0 + px) * (x - c0);
    return (acc / total) * 100;
  }
  return 100;
}

function _renderStatsPanel() {
  const wrap = $("plot-stats");
  const body = $("ps-stats-rows");
  if (!wrap || !body) return;

  if (lastPlotKind !== "overplot" || !overplotTraces.length) {
    wrap.style.display = "none";
    body.innerHTML = "";
    return;
  }
  wrap.style.display = "";

  const ov = getOverlapInfo();
  const hdrCfg = (overplotTraces[overplotTraces.length - 1] || {}).boundCfg
                 || currentBoundConfig();
  const header = ["Trace", "Nominal δ_crit", hdrCfg.negCol, hdrCfg.posCol];
  if (ov) header.push("δ_applied/δ_nom", "Prob. of EF Pen.");

  let html = `<table><thead><tr>${header.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>`;
  for (let i = 0; i < overplotTraces.length; i++) {
    const t = overplotTraces[i];
    const labelText = plotSettings.labelOverrides[i] || t.label;
    const color = _colorToHex(
      plotSettings.colorOverrides[i] ||
      DEFAULT_HEX_PALETTE[i % DEFAULT_HEX_PALETTE.length]
    );
    const labelHtml =
      `<span class="ps-trace-color" style="background:${color}"></span>${labelText}`;
    let row = `<td>${labelHtml}</td>`
            + `<td>${fmtE(t.deltaNom, 3)}</td>`
            + `<td>${fmtE(t.psigL, 3)}</td>`
            + `<td>${fmtE(t.psigU, 3)}</td>`;
    if (ov) {
      const ratio = (ov.value / t.deltaNom) * 100;
      const centers = Array.from(t.centers);
      const pdf = Array.from(t.pdf);
      const ppen = _cdfPercentAt(centers, pdf, ov.value);
      row += `<td>${ratio.toFixed(1)}%</td>`
           + `<td>${ppen.toFixed(2)}%</td>`;
    }
    html += `<tr>${row}</tr>`;
  }
  html += `</tbody></table>`;
  body.innerHTML = html;
}

function _colorToHex(c) {
  if (!c) return "#4c72b0";
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) return c;
  // Try to render through a temporary element to normalise CSS names.
  try {
    const tmp = document.createElement("span");
    tmp.style.color = c;
    document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const h = n => parseInt(n).toString(16).padStart(2, "0");
      return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
    }
  } catch (_) { /* fallthrough */ }
  return "#4c72b0";
}
(function initDark() {
  if (localStorage.getItem("efp_dark") === "1") {
    document.body.classList.add("dark");
    document.getElementById("dark-toggle").checked = true;
  }
})();

// ─────────────────── Plot settings state ─────────────────

// All settings are passed verbatim to plot_engine.py (matplotlib backend).
// Sizes are matplotlib-style (inches for width/height, fontSize in points).
const DEFAULT_PS = {
  // Title & labels (empty string → engine picks a default)
  title: "", xLabel: "", yLabel: "",
  // Fonts
  fontFamily: "serif", mathFontset: "dejavuserif",
  baseFontSize: 11, titleSize: 13, axisLabelSize: 12,
  tickSize: 10, legendSize: 10,
  // Axes
  xScale: "linear", yScale: "linear",
  xMin: "", xMax: "", yMin: "", yMax: "",
  xTickFormat: "auto", yTickFormat: "auto",
  tickDir: "out", axisColor: "#000000",
  spineTop: true, spineRight: true,
  // Grid
  grid: false, gridColor: "#dddddd", gridAlpha: 0.5, gridStyle: "-",
  // Lines & markers
  showNomLine: true, showSigmaLines: true,
  lineWidth: 1.4, nomLineWidth: 2.0, nomLineStyle: "-",
  sigLineWidth: 1.2, sigLineStyle: "--",
  fillOpacity: 0.20,
  marker: "o", markerSize: 5.5,
  // Legend
  legendShow: true, legendLoc: "best", legendNCol: 1,
  legendFrame: true, legendEdge: "#888888", legendAlpha: 0.9,
  // Figure & output
  width: 7.0, height: 4.2, dpi: 120, format: "png",
  bgColor: "#ffffff", axesBgColor: "#ffffff",
  tightLayout: true, normalizePdf: true, stackHspace: 0.12,
  // Show a cumulative-distribution-function subplot below the PDF plot.
  showCdf: false,
  // Overlap (default: solid red, lw=2)
  overlapColor: "#cc0000", overlapWidth: 2.0, overlapStyle: "-",
  // Per-trace
  colorOverrides: {},
  labelOverrides: {},
  // Which plot kind the current xMin/xMax/yLimits apply to. When the user
  // switches plot kinds we auto-clear the limits so the new view auto-scales.
  limitsKind: null,
  // Per-subplot y-limits keyed by panel key ("delta", "I_p", "q_95", …).
  // Shape: { delta: { min: "...", max: "..." }, ... }
  yLimits: {},
  // Per-subplot y-axis tick format ("auto" | "sci" | "plain").
  // Empty / missing → falls back to the global yTickFormat from the popup.
  yTickFormats: {},
};
let plotSettings = JSON.parse(JSON.stringify(DEFAULT_PS));

function _vS(id) { const el = $(id); return el ? el.value : ""; }
function _vI(id, def) { const v = parseInt(_vS(id)); return Number.isFinite(v) ? v : def; }
function _vF(id, def) { const v = parseFloat(_vS(id)); return Number.isFinite(v) ? v : def; }
function _vB(id, def) { const el = $(id); return el ? !!el.checked : def; }

function readPlotSettings() {
  return {
    title:         _vS("ps_title"),
    xLabel:        _vS("ps_xLabel"),
    yLabel:        _vS("ps_yLabel"),
    fontFamily:    _vS("ps_fontFamily") || "serif",
    mathFontset:   _vS("ps_mathFontset") || "dejavuserif",
    baseFontSize:  _vI("ps_baseFontSize", 11),
    titleSize:     _vI("ps_titleSize", 13),
    axisLabelSize: _vI("ps_axisLabelSize", 12),
    tickSize:      _vI("ps_tickSize", 10),
    legendSize:    _vI("ps_legendSize", 10),
    xScale:        _vS("ps_xScale") || "linear",
    yScale:        _vS("ps_yScale") || "linear",
    // X limit + per-panel Y limits live in the inline #plot-controls panel.
    xMin: plotSettings.xMin || "",
    xMax: plotSettings.xMax || "",
    yLimits: { ...(plotSettings.yLimits || {}) },
    yTickFormats: { ...(plotSettings.yTickFormats || {}) },
    limitsKind: plotSettings.limitsKind || null,
    // X tick format lives only in the inline panel now; preserve it.
    xTickFormat:   plotSettings.xTickFormat || "auto",
    yTickFormat:   _vS("ps_yTickFormat") || "auto",
    tickDir:       _vS("ps_tickDir") || "out",
    axisColor:     _vS("ps_axisColor") || "#000000",
    spineTop:      _vB("ps_spineTop", true),
    spineRight:    _vB("ps_spineRight", true),
    grid:          _vB("ps_grid", false),
    gridColor:     _vS("ps_gridColor") || "#dddddd",
    gridAlpha:     _vF("ps_gridAlpha", 0.5),
    gridStyle:     _vS("ps_gridStyle") || "-",
    lineWidth:     _vF("ps_lineWidth", 1.4),
    nomLineWidth:  _vF("ps_nomLineWidth", 2.0),
    nomLineStyle:  _vS("ps_nomLineStyle") || "-",
    sigLineWidth:  _vF("ps_sigLineWidth", 1.2),
    sigLineStyle:  _vS("ps_sigLineStyle") || "--",
    showNomLine:   _vB("ps_showNomLine", true),
    showSigmaLines:_vB("ps_showSigmaLines", true),
    fillOpacity:   _vF("ps_fillOpacity", 0.20),
    marker:        _vS("ps_marker") || "o",
    markerSize:    _vF("ps_markerSize", 5.5),
    legendShow:    _vB("ps_legendShow", true),
    legendLoc:     _vS("ps_legendLoc") || "best",
    legendNCol:    _vI("ps_legendNCol", 1),
    legendFrame:   _vB("ps_legendFrame", true),
    legendEdge:    _vS("ps_legendEdge") || "#888888",
    legendAlpha:   _vF("ps_legendAlpha", 0.9),
    // Width / height live in the inline panel; preserve current values.
    width:         plotSettings.width || 7.0,
    height:        plotSettings.height || 4.2,
    dpi:           _vI("ps_dpi", 120),
    format:        _vS("ps_format") || "png",
    bgColor:       _vS("ps_bgColor") || "#ffffff",
    axesBgColor:   _vS("ps_axesBgColor") || "#ffffff",
    tightLayout:   _vB("ps_tightLayout", true),
    normalizePdf:  _vB("ps_normalizePdf", true),
    stackHspace:   _vF("ps_stackHspace", 0.12),
    overlapColor:  _vS("ps_overlapColor") || "#2e8b57",
    overlapWidth:  _vF("ps_overlapWidth", 1.6),
    overlapStyle:  _vS("ps_overlapStyle") || ":",
    // Per-trace overrides are managed by the inline editor — preserve them.
    colorOverrides: { ...(plotSettings.colorOverrides || {}) },
    labelOverrides: { ...(plotSettings.labelOverrides || {}) },
  };
}

function _setV(id, v) { const el = $(id); if (el) el.value = (v ?? ""); }
function _setC(id, v) { const el = $(id); if (el) el.checked = !!v; }

function writePlotSettings(ps) {
  _setV("ps_title",         ps.title);
  _setV("ps_xLabel",        ps.xLabel);
  _setV("ps_yLabel",        ps.yLabel);
  _setV("ps_fontFamily",    ps.fontFamily);
  _setV("ps_mathFontset",   ps.mathFontset);
  _setV("ps_baseFontSize",  ps.baseFontSize);
  _setV("ps_titleSize",     ps.titleSize);
  _setV("ps_axisLabelSize", ps.axisLabelSize);
  _setV("ps_tickSize",      ps.tickSize);
  _setV("ps_legendSize",    ps.legendSize);
  _setV("ps_xScale",        ps.xScale);
  _setV("ps_yScale",        ps.yScale);
  _setV("ps_yTickFormat",   ps.yTickFormat);
  _setV("ps_tickDir",       ps.tickDir);
  _setV("ps_axisColor",     ps.axisColor);
  _setC("ps_spineTop",      ps.spineTop);
  _setC("ps_spineRight",    ps.spineRight);
  _setC("ps_grid",          ps.grid);
  _setV("ps_gridColor",     ps.gridColor);
  _setV("ps_gridAlpha",     ps.gridAlpha);
  _setV("ps_gridStyle",     ps.gridStyle);
  _setV("ps_lineWidth",     ps.lineWidth);
  _setV("ps_nomLineWidth",  ps.nomLineWidth);
  _setV("ps_nomLineStyle",  ps.nomLineStyle);
  _setV("ps_sigLineWidth",  ps.sigLineWidth);
  _setV("ps_sigLineStyle",  ps.sigLineStyle);
  _setC("ps_showNomLine",   ps.showNomLine);
  _setC("ps_showSigmaLines",ps.showSigmaLines);
  _setV("ps_fillOpacity",   ps.fillOpacity);
  _setV("ps_marker",        ps.marker);
  _setV("ps_markerSize",    ps.markerSize);
  _setC("ps_legendShow",    ps.legendShow);
  _setV("ps_legendLoc",     ps.legendLoc);
  _setV("ps_legendNCol",    ps.legendNCol);
  _setC("ps_legendFrame",   ps.legendFrame);
  _setV("ps_legendEdge",    ps.legendEdge);
  _setV("ps_legendAlpha",   ps.legendAlpha);
  _setV("ps_dpi",           ps.dpi);
  _setV("ps_format",        ps.format);
  _setV("ps_bgColor",       ps.bgColor);
  _setV("ps_axesBgColor",   ps.axesBgColor);
  _setC("ps_tightLayout",   ps.tightLayout);
  _setC("ps_normalizePdf",  ps.normalizePdf);
  _setV("ps_stackHspace",   ps.stackHspace);
  _setV("ps_overlapColor",  ps.overlapColor);
  _setV("ps_overlapWidth",  ps.overlapWidth);
  _setV("ps_overlapStyle",  ps.overlapStyle);
}

function openPlotSettings() {
  writePlotSettings(plotSettings);
  $("plot-settings-dialog").showModal();
}

function applyPlotSettings() {
  plotSettings = readPlotSettings();
  $("plot-settings-dialog").close();
  rerenderLast();
}

function resetPlotSettings() {
  // Preserve per-trace overrides and the inline view (width/height/limits) —
  // resetting Plot Settings shouldn't blow away the user's labels or framing.
  const keep = {
    colorOverrides: plotSettings.colorOverrides,
    labelOverrides: plotSettings.labelOverrides,
    width: plotSettings.width,
    height: plotSettings.height,
    xMin: plotSettings.xMin, xMax: plotSettings.xMax,
    yMin: plotSettings.yMin, yMax: plotSettings.yMax,
    limitsKind: plotSettings.limitsKind,
  };
  plotSettings = { ...JSON.parse(JSON.stringify(DEFAULT_PS)), ...keep };
  writePlotSettings(plotSettings);
}

// ─────────────────── Pyodide bootstrap (matplotlib) ──────

let _pyodide = null;
let _pyodideReady = null;       // Promise that resolves when ready
let _pyodideStatusEl = null;
let lastPlotKind = null;        // "overplot" | "delta_vs_time" | null
let _lastPlotDataUrl = null;    // for "Save Plot (PNG)"

function _setPlotBusy(msg) {
  const box = $("plot-box");
  if (!box) return;
  box.innerHTML = `<div class="plot-status">${msg}</div>`;
}

async function ensurePyodide() {
  if (_pyodide) return _pyodide;
  if (_pyodideReady) return _pyodideReady;
  _pyodideReady = (async () => {
    _setPlotBusy("Loading Python (matplotlib) — first load ~10 MB, cached after.");
    // loadPyodide is provided by the CDN script in index.html.
    const py = await loadPyodide();
    _setPlotBusy("Loading numpy + matplotlib…");
    await py.loadPackage(["numpy", "matplotlib"]);
    _setPlotBusy("Loading plot engine…");
    const src = await (await fetch("plot_engine.py?v=3")).text();
    py.FS.writeFile("/tmp/plot_engine.py", src);
    py.runPython("import sys; sys.path.insert(0, '/tmp'); import plot_engine");
    _pyodide = py;
    _setPlotBusy("");
    return py;
  })();
  return _pyodideReady;
}

async function _runPythonRender(funcName, payload) {
  const py = await ensurePyodide();
  // Marshal payload via JSON so we don't hit pyodide's proxy quirks.
  py.globals.set("_efp_payload_json", JSON.stringify(payload));
  const dataUrl = py.runPython(`
import json, plot_engine
_p = json.loads(_efp_payload_json)
plot_engine.${funcName}(_p['data'], _p['settings'])
`);
  return dataUrl;
}

function _showPlotImage(dataUrl) {
  _lastPlotDataUrl = dataUrl;
  const box = $("plot-box");
  if (!dataUrl) { box.innerHTML = ""; return; }
  if (dataUrl.startsWith("data:image/svg+xml")) {
    // Decode and inline SVG so it scales responsively.
    try {
      const b64 = dataUrl.split(",", 2)[1];
      const svg = atob(b64);
      box.innerHTML = `<div class="plot-img-wrap">${svg}</div>`;
      return;
    } catch (_) { /* fall through */ }
  }
  box.innerHTML = `<div class="plot-img-wrap"><img alt="δ plot" src="${dataUrl}"></div>`;
}

// ─────────────────── Scalings ────────────────────────────

const BUILTIN_SCALINGS = {
  "2026 O,L OLS": {
    C:[-4.31,0.03], bnli:[0.25,0.02], ip:[-0.97,0.02],
    R:[1.88,0.04],  ne:[0.77,0.02],   BT:[0.20,0.03],
  },
  "2026 O,L WLS": {
    C:[-4.26,0.09], bnli:[0.13,0.06], ip:[-1.01,0.07],
    R:[1.57,0.15],  ne:[0.56,0.08],   BT:[0.30,0.10],
  },
  "2020 O,L,H WLS": {
    C:[-3.62,0.04], bnli:[-0.19,0.05], ip:[0.00,0.00],
    R:[0.14,0.08],  ne:[0.53,0.06],    BT:[-0.95,0.07],
  },
  "2020 O,L WLS": {
    C:[-3.46,0.05], bnli:[0.15,0.07], ip:[0.00,0.00],
    R:[0.20,0.07],  ne:[0.64,0.06],   BT:[-1.14,0.08],
  },
};

const EXP_ORDER = ["C","bnli","ip","R","ne","BT"];
const EXP_IDS   = {
  C:["ex_C_v","ex_C_u"], bnli:["ex_bnli_v","ex_bnli_u"],
  ip:["ex_ip_v","ex_ip_u"], R:["ex_R_v","ex_R_u"],
  ne:["ex_ne_v","ex_ne_u"], BT:["ex_BT_v","ex_BT_u"],
};

let SCALINGS = JSON.parse(JSON.stringify(BUILTIN_SCALINGS));
SCALINGS["Custom"] = JSON.parse(JSON.stringify(SCALINGS["2026 O,L WLS"]));

// ─────────────────── Overplot state ──────────────────────
const PLOT_COLORS = [
  "steelblue","#e05050","#2ca02c","#d4a017","#9467bd",
  "#8c564b","#17becf","#e377c2","#7f7f7f","#bcbd22",
];
let overplotTraces = [];
let overplotCounter = 0;

// ─────────────────── Helpers ─────────────────────────────

const $ = id => document.getElementById(id);
const mode = () => document.querySelector('input[name="mode"]:checked').value;
function fmtE(x, d=3) { return x.toExponential(d); }

// Bound-mode config. Inputs are CDF percentiles (the cumulative probability
// at or below each bound). Mirrors the desktop Python `_bound_config()`.
const _SIGMA_BOUND_CFG = {
  mode: "sigma",
  percentiles: [15.87, 84.13],
  cdfLevels:   [15.87, 84.13],
  negLatex:  "−1σ",
  posLatex:  "+1σ",
  negCol:    "−1σ",
  posCol:    "+1σ",
  symCol:    "≈σ",
  negCsv:    "minus_1sigma",
  posCsv:    "plus_1sigma",
  symCsv:    "approx_sigma",
  summary:   "≈±1σ (CDF 15.87 / 84.13 %)",
  bandLabel: "≈±1σ band",
};

// Default bound mode: 25th / 75th CDF percentiles (interquartile range).
const _QUARTILE_BOUND_CFG = {
  mode: "quartile",
  percentiles: [25, 75],
  cdfLevels:   [25, 75],
  negLatex:  "25%",
  posLatex:  "75%",
  negCol:    "25%",
  posCol:    "75%",
  symCol:    "½IQR",
  negCsv:    "lower_25cdf",
  posCsv:    "upper_75cdf",
  symCsv:    "half_iqr",
  summary:   "25 / 75 % (IQR)",
  bandLabel: "25–75% band",
};

// When the user switches to a preset bound mode, write its canonical CDF
// percentiles into the lower/upper boxes (25 / 75 for the quartile default,
// 15.87 / 84.13 for ≈±1σ). Custom CDF values typed by the user are preserved
// when switching back.
function onBoundModeChange() {
  const radio = document.querySelector('input[name="bound_mode"]:checked');
  if (!radio) return;
  if (radio.value === "quartile") {
    const lo = $("in_lower_pct"); if (lo) lo.value = "25";
    const hi = $("in_upper_pct"); if (hi) hi.value = "75";
  } else if (radio.value === "sigma") {
    const lo = $("in_lower_pct"); if (lo) lo.value = "15.87";
    const hi = $("in_upper_pct"); if (hi) hi.value = "84.13";
  }
}

function currentBoundConfig() {
  const radio = document.querySelector('input[name="bound_mode"]:checked');
  const m = radio ? radio.value : "quartile";
  if (m === "sigma")    return { ..._SIGMA_BOUND_CFG };
  if (m === "quartile") return { ..._QUARTILE_BOUND_CFG };
  if (m !== "cdf")      return { ..._QUARTILE_BOUND_CFG };
  let lo = parseFloat(($("in_lower_pct") || {}).value);
  let hi = parseFloat(($("in_upper_pct") || {}).value);
  if (!Number.isFinite(lo)) lo = 15.87;
  if (!Number.isFinite(hi)) hi = 84.13;
  lo = Math.max(0, Math.min(100, lo));
  hi = Math.max(0, Math.min(100, hi));
  if (lo > hi) [lo, hi] = [hi, lo];
  const tag = n => String(n).replace(".", "p");
  return {
    mode: "cdf",
    lo, hi,
    percentiles: [lo, hi],
    cdfLevels:   [lo, hi],
    negLatex:  `CDF=${lo}%`,
    posLatex:  `CDF=${hi}%`,
    negCol:    `@${lo}%`,
    posCol:    `@${hi}%`,
    symCol:    "Δ½",
    negCsv:    `lower_${tag(lo)}cdf`,
    posCsv:    `upper_${tag(hi)}cdf`,
    symCsv:    "half_width",
    summary:   `CDF ${lo}% / ${hi}%`,
    bandLabel: `CDF [${lo}%, ${hi}%] band`,
  };
}

function randn() {
  let u, v, s;
  do { u = Math.random()*2-1; v = Math.random()*2-1; s = u*u+v*v; }
  while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}
function randnArray(n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = randn();
  return a;
}
function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function hexToRGBA(hex, alpha) {
  hex = hex.replace("#","");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function colorToRGBA(c, alpha) {
  if (c.startsWith("#")) return hexToRGBA(c, alpha);
  if (c.startsWith("rgb")) return c.replace("rgb","rgba").replace(")",`,${alpha})`);
  // named color — wrap in rgba via a temp element
  const d = document.createElement("div"); d.style.color = c;
  document.body.appendChild(d);
  const comp = getComputedStyle(d).color; document.body.removeChild(d);
  return comp.replace("rgb","rgba").replace(")",`,${alpha})`);
}

// ─────────────────── Read GUI ────────────────────────────

function readExponents() {
  const p = {};
  for (const k of EXP_ORDER) {
    const v = parseFloat($(EXP_IDS[k][0]).value);
    const u = parseFloat($(EXP_IDS[k][1]).value);
    if (isNaN(v) || isNaN(u)) return null;
    p[k] = [v, u];
  }
  return p;
}
function writeExponents(params) {
  for (const k of EXP_ORDER) {
    $(EXP_IDS[k][0]).value = params[k][0];
    $(EXP_IDS[k][1]).value = params[k][1];
  }
}
function currentScaling() { return $("sel_scaling").value; }
function getActiveParams() { return SCALINGS[currentScaling()]; }

// ─────────────────── Monte Carlo core ────────────────────

function monteCarloThreshold(inputs, params, dist, nsample, percentiles) {
  const pcts = (Array.isArray(percentiles) && percentiles.length === 2)
    ? percentiles
    : [15.87, 84.13];
  const keys = EXP_ORDER;
  const nk = keys.length;
  const bnli = inputs.beta_n / inputs.l_i;

  const rands = [];
  for (let ki = 0; ki < nk; ki++) {
    let r;
    if (dist === "flat") {
      r = new Float64Array(nsample);
      for (let i = 0; i < nsample; i++) r[i] = Math.random();
    } else {
      r = randnArray(nsample);
      if (dist === "normal truncated") {
        for (let i = 0; i < nsample; i++) {
          while (Math.abs(r[i]) > 1.5) r[i] = randn();
        }
      }
    }
    rands.push(r);
  }

  const alphaV = keys.map(k => params[k][0]);
  const alphaU = keys.map(k => params[k][1]);
  const delta = new Float64Array(nsample);
  delta.fill(1.0);
  let deltaNom = 1.0;

  for (let ki = 0; ki < nk; ki++) {
    const nom = alphaV[ki], unc = alphaU[ki], r = rands[ki], key = keys[ki];
    if (key === "C") {
      deltaNom *= Math.pow(10, nom);
      for (let i = 0; i < nsample; i++) delta[i] *= Math.pow(10, nom + unc * r[i]);
    } else {
      let x;
      if      (key === "bnli") x = bnli;
      else if (key === "ip")   x = Math.abs(inputs.I_p);
      else if (key === "R")    x = inputs.R_0;
      else if (key === "ne")   x = inputs.n_e;
      else if (key === "BT")   x = Math.abs(inputs.B_T);
      deltaNom *= Math.pow(x, nom);
      for (let i = 0; i < nsample; i++) delta[i] *= Math.pow(x, nom + unc * r[i]);
    }
  }

  const sorted = Float64Array.from(delta).sort();
  const psigL = percentile(sorted, pcts[0]);
  const psigU = percentile(sorted, pcts[1]);

  const bins = 1000;
  const mn = sorted[0], mx = sorted[sorted.length - 1];
  const bw = (mx - mn) / bins;
  const counts = new Float64Array(bins);
  for (let i = 0; i < nsample; i++) {
    let bi = Math.floor((delta[i] - mn) / bw);
    if (bi >= bins) bi = bins - 1; if (bi < 0) bi = 0;
    counts[bi]++;
  }
  const pdf = new Float64Array(bins);
  const centers = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    pdf[b] = counts[b] / (nsample * bw);
    centers[b] = mn + (b + 0.5) * bw;
  }
  return { deltaNom, delta, pdf, centers, psigL, psigU };
}

// ─────────────────── LaTeX formula ───────────────────────

function formulaLatex(name) {
  const p = SCALINGS[name];
  if (!p) return "";
  const f = (v,u) => `${v}\\pm${u}`;
  if (name === "2026 O,L WLS")
    return `\\delta_{\\text{2026 O,L WLS}} = 10^{-4.26\\pm0.09}\\left(\\frac{\\beta_n}{l_i}\\right)^{0.13\\pm0.06}\\,|I_p|^{-1.01\\pm0.07}\\,R_0^{1.57\\pm0.15}\\,n_e^{0.56\\pm0.08}\\,|B_T|^{0.30\\pm0.10}`;
  if (name === "2026 O,L OLS")
    return `\\delta_{\\text{2026 O,L OLS}} = 10^{-4.31\\pm0.03}\\left(\\frac{\\beta_n}{l_i}\\right)^{0.25\\pm0.02}\\,|I_p|^{-0.97\\pm0.02}\\,R_0^{1.88\\pm0.04}\\,n_e^{0.77\\pm0.02}\\,|B_T|^{0.20\\pm0.03}`;
  if (name === "2020 O,L,H WLS")
    return `\\delta_{\\text{2020 O,L,H WLS}} = 10^{-3.62\\pm0.04}\\,n_e^{0.53\\pm0.06}\\,B_T^{-0.95\\pm0.07}\\,R_0^{0.14\\pm0.08}\\left(\\frac{\\beta_n}{l_i}\\right)^{-0.19\\pm0.05}\\,|I_p|^{0.00\\pm0.00}`;
  if (name === "2020 O,L WLS")
    return `\\delta_{\\text{2020 O,L WLS}} = 10^{-3.46\\pm0.05}\\,n_e^{0.64\\pm0.06}\\,B_T^{-1.14\\pm0.08}\\,R_0^{0.20\\pm0.07}\\left(\\frac{\\beta_n}{l_i}\\right)^{0.15\\pm0.07}\\,|I_p|^{0.00\\pm0.00}`;
  const safe = name.replace(/_/g, "\\_");
  return `\\delta_{\\text{${safe}}} = 10^{${f(p.C[0],p.C[1])}}\\left(\\frac{\\beta_n}{l_i}\\right)^{${f(p.bnli[0],p.bnli[1])}}\\,|I_p|^{${f(p.ip[0],p.ip[1])}}\\,R_0^{${f(p.R[0],p.R[1])}}\\,n_e^{${f(p.ne[0],p.ne[1])}}\\,|B_T|^{${f(p.BT[0],p.BT[1])}}`;
}

function renderFormula() {
  const el = $("formula-box");
  try { katex.render(formulaLatex(currentScaling()), el, { displayMode:true, throwOnError:false }); }
  catch(e) { el.textContent = "(formula render error)"; }
}

// ─────────────────── Exponent editor events ──────────────

let _updatingExp = false;
function onExpChanged() {
  if (_updatingExp) return;
  const p = readExponents(); if (!p) return;
  SCALINGS["Custom"] = p;
  $("sel_scaling").value = "Custom";
  renderFormula();
}
function onScalingSelected() {
  const name = currentScaling();
  if (name !== "Custom") { _updatingExp = true; writeExponents(SCALINGS[name]); _updatingExp = false; }
  renderFormula();
}

// ─────────────────── Mode toggle ─────────────────────────

function toggleMode() {
  const single = mode() === "single";
  document.querySelectorAll("#input-box input").forEach(el => el.disabled = !single);
  $("btn_calc").disabled = !single;
  $("btn_csv").disabled  = single;
  document.querySelectorAll(".preset-btn").forEach(el => el.disabled = !single);
}

// ─────────────────── Presets ─────────────────────────────

function fillInputs(label,ne,BT,bn,li,R0,Ip) {
  document.querySelector('input[name="mode"][value="single"]').checked = true;
  toggleMode();
  $("in_label").value = label;
  $("in_ne").value = ne; $("in_BT").value = BT; $("in_bn").value = bn;
  $("in_li").value = li; $("in_R0").value = R0; $("in_Ip").value = Ip;
}
function fillITER()    { fillInputs("ITER",    9.8,  5.3,  1.8,  1.0,  6.2,  14.9); }
function fillSPARC_L() { fillInputs("SPARC-L", 17.3, 12.16,0.17, 0.74, 1.85, 8.7);  }
function fillSPARC_H() { fillInputs("SPARC-H", 28.8, 12.16,0.98, 0.72, 1.85, 8.7);  }

// ─────────────────── Overplot rendering ──────────────────

function getTraceColor(idx) {
  if (plotSettings.colorOverrides[idx]) return plotSettings.colorOverrides[idx];
  return PLOT_COLORS[idx % PLOT_COLORS.length];
}

// Returns {value, label} when the overlap reference line is enabled and numeric,
// else null. Pulls from the new Settings inputs.
function getOverlapInfo() {
  const en = $("in_overlap_enabled");
  if (!en || !en.checked) return null;
  const v = parseFloat($("in_overlap_value").value);
  if (!isFinite(v)) return null;
  const lbl = ($("in_overlap_label").value || "").trim() || "Dominant mode overlap";
  return { value: v, label: lbl };
}

// Serializable settings + overlap payload for the Python backend.
// `forSave` swaps in the user-chosen save format; on-screen render is always PNG
// (PDF can't be inlined in an <img>, SVG ok but PNG keeps things simple).
function _renderPayloadSettings(forSave = false) {
  const out = JSON.parse(JSON.stringify(plotSettings));
  const ov = getOverlapInfo();
  out.overlap = ov ? { value: ov.value, label: ov.label } : null;
  out.colorOverrides = Object.fromEntries(
    Object.entries(out.colorOverrides || {}).map(([k, v]) => [String(k), v])
  );
  out.labelOverrides = Object.fromEntries(
    Object.entries(out.labelOverrides || {}).map(([k, v]) => [String(k), v])
  );
  // Bound-mode label + CDF levels (used by plot_engine for the band title
  // and to draw horizontal reference lines on the CDF subplot).
  const rows = window._batchResults;
  const refCfg = (rows && rows.length && rows[0].boundCfg)
              || (overplotTraces[0] && overplotTraces[0].boundCfg)
              || currentBoundConfig();
  out.boundLabel = refCfg.bandLabel;
  out.cdfLevels  = refCfg.cdfLevels;
  if (!forSave) out.format = "png";
  return out;
}

let _renderSeq = 0;
async function renderOverplot() {
  _maybeClearStaleLimits("overplot");
  lastPlotKind = "overplot";
  if (!overplotTraces.length) {
    _showPlotImage(null);
    _renderLegendEditor();
    _renderStatsPanel();
    return;
  }
  const seq = ++_renderSeq;
  _setPlotBusy("Rendering…");
  // Marshal traces (Float64Array → plain arrays)
  const traces = overplotTraces.map((t, i) => ({
    label:   plotSettings.labelOverrides[i] || t.label,
    centers: Array.from(t.centers),
    pdf:     Array.from(t.pdf),
    deltaNom: t.deltaNom,
    psigL:   t.psigL,
    psigU:   t.psigU,
    color:   plotSettings.colorOverrides[i] || null,
  }));
  try {
    const dataUrl = await _runPythonRender("render_overplot", {
      data: traces,
      settings: _renderPayloadSettings(),
    });
    if (seq !== _renderSeq) return; // stale
    _showPlotImage(dataUrl);
    _renderLegendEditor();
    _renderStatsPanel();
    _updateYPanelDropdown();
  } catch (e) {
    console.error(e);
    _setPlotBusy(`<pre style="color:#c33">Plot error: ${e.message || e}</pre>`);
  }
}

// ─────────────────── Single-point calc ───────────────────

function readSingleInputs() {
  const ne = parseFloat($("in_ne").value);
  const BT = parseFloat($("in_BT").value);
  const bn = parseFloat($("in_bn").value);
  const li = parseFloat($("in_li").value);
  const R0 = parseFloat($("in_R0").value);
  const Ip = parseFloat($("in_Ip").value);
  if ([ne,BT,bn,li,R0,Ip].some(isNaN)) { alert("Invalid numerical input."); return null; }
  if (li === 0) { alert("l_i must be non-zero."); return null; }
  return { n_e:ne, B_T:Math.abs(BT), beta_n:bn, l_i:li, R_0:R0, I_p:Math.abs(Ip) };
}

function calcSingle() {
  const inputs = readSingleInputs(); if (!inputs) return;
  const params  = getActiveParams();
  const dist    = $("sel_dist").value;
  const nsample = parseInt($("in_nsample").value) || 1000000;
  const sName   = currentScaling();
  const userLabel = $("in_label").value.trim();
  const boundCfg  = currentBoundConfig();

  let res;
  try { res = monteCarloThreshold(inputs, params, dist, nsample, boundCfg.percentiles); }
  catch(e) { alert("Calculation error: " + e.message); return; }

  overplotCounter++;
  const label = userLabel ? `${userLabel} (${sName})` : `${sName}`;

  overplotTraces.push({
    label, centers:res.centers, pdf:res.pdf,
    deltaNom:res.deltaNom, psigL:res.psigL, psigU:res.psigU,
    inputs:{...inputs}, scaling:sName, dist, nsample, userLabel,
    boundCfg,
  });
  renderOverplot();
  $("table-box").innerHTML = "";
}

function clearOverplots() {
  overplotTraces = []; overplotCounter = 0;
  $("plot-box").innerHTML = "";
}

// ─────────────────── Save plot ───────────────────────────

function savePlotImage() {
  if (lastPlotKind === null) { alert("No plot to save. Render one first."); return; }
  // Default the radio to whatever the user last chose (from popup or last save).
  const fmt = (plotSettings.format || "png").toLowerCase();
  const radio = document.querySelector(`#save-format-dialog input[name="save_fmt"][value="${fmt}"]`);
  if (radio) radio.checked = true;
  $("save-format-dialog").showModal();
}

async function _doSavePlotImage() {
  const sel = document.querySelector('#save-format-dialog input[name="save_fmt"]:checked');
  const fmt = (sel && sel.value) || "png";
  plotSettings.format = fmt;     // remember choice for next time
  $("save-format-dialog").close();
  // PNG was already rendered for the screen — reuse it instead of re-running Python.
  if (fmt === "png" && _lastPlotDataUrl && _lastPlotDataUrl.startsWith("data:image/png")) {
    _downloadDataUrl(_lastPlotDataUrl, `efp_threshold_plot.png`);
    return;
  }
  // Otherwise do a one-shot Python render in the chosen format.
  try {
    let dataUrl;
    if (lastPlotKind === "overplot") {
      if (!overplotTraces.length) { alert("No plot to save."); return; }
      const traces = overplotTraces.map((t, i) => ({
        label:   plotSettings.labelOverrides[i] || t.label,
        centers: Array.from(t.centers),
        pdf:     Array.from(t.pdf),
        deltaNom: t.deltaNom, psigL: t.psigL, psigU: t.psigU,
        color:   plotSettings.colorOverrides[i] || null,
      }));
      _setPlotBusy(`Rendering ${fmt.toUpperCase()}…`);
      dataUrl = await _runPythonRender("render_overplot", {
        data: traces,
        settings: _renderPayloadSettings(true),
      });
      _showPlotImage(_lastPlotDataUrl);    // restore the PNG view
    } else if (lastPlotKind === "delta_vs_time") {
      const rows = window._batchResults;
      if (!rows || !rows.length) { alert("No plot to save."); return; }
      const extras = Array.from(document.querySelectorAll(".stack-quant:checked"))
        .map(cb => cb.dataset.key);
      _setPlotBusy(`Rendering ${fmt.toUpperCase()}…`);
      dataUrl = await _runPythonRender("render_delta_vs_time", {
        data: rows.map(r => ({
          shot: r.shot, time_ms: r.time_ms,
          deltaNom: r.deltaNom, psigL: r.psigL, psigU: r.psigU,
          I_p: r.I_p, B_T: r.B_T, n_e: r.n_e,
          beta_n: r.beta_n, l_i: r.l_i, R_0: r.R_0, bnli: r.bnli,
          ...(r.extras || {}),
        })),
        settings: { ..._renderPayloadSettings(true), stack: extras },
      });
      _showPlotImage(_lastPlotDataUrl);    // restore the PNG view
    } else {
      alert("Nothing to save.");
      return;
    }
    _downloadDataUrl(dataUrl, `efp_threshold_plot.${fmt}`);
  } catch (e) {
    console.error(e);
    alert(`Save error: ${e.message || e}`);
    _showPlotImage(_lastPlotDataUrl);
  }
}

function _downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function savePlotData() {
  if (!overplotTraces.length) { alert("No plot data to save."); return; }
  const cfg = (overplotTraces[0] && overplotTraces[0].boundCfg) || currentBoundConfig();
  const maxBins = Math.max(...overplotTraces.map(t => t.centers.length));
  const hdrParts = ["bin_index"];
  for (const t of overplotTraces) {
    const s = t.label.replace(/,/g, ";");
    hdrParts.push(`${s}_delta`, `${s}_pdf`);
  }
  hdrParts.push("");
  hdrParts.push("trace","label","scaling","dist","nsample",
                 "n_e","B_T","beta_n","l_i","R_0","I_p",
                 "delta_nominal", cfg.negCsv, cfg.posCsv, cfg.symCsv);
  const lines = [hdrParts.join(",")];
  const nMeta = overplotTraces.length;
  for (let i = 0; i < Math.max(maxBins, nMeta); i++) {
    const parts = [];
    parts.push(i < maxBins ? i : "");
    for (const t of overplotTraces) {
      if (i < t.centers.length) { parts.push(t.centers[i], t.pdf[i]); }
      else { parts.push("",""); }
    }
    parts.push("");
    if (i < nMeta) {
      const t = overplotTraces[i]; const inp = t.inputs;
      const minus = t.deltaNom - t.psigL, plus = t.psigU - t.deltaNom;
      parts.push(t.label.replace(/,/g,";"), t.userLabel||"", t.scaling, t.dist, t.nsample,
        inp.n_e, inp.B_T, inp.beta_n, inp.l_i, inp.R_0, inp.I_p,
        t.deltaNom, minus, plus, (minus+plus)/2);
    } else { parts.push("","","","","","","","","","","","","","",""); }
    lines.push(parts.join(","));
  }
  const blob = new Blob([lines.join("\n")], {type:"text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "efp_plot_data.csv"; a.click();
}

// ─────────────────── CSV / batch ─────────────────────────

function loadCSV(fileInput) {
  const file = fileInput.files[0]; if (!file) return;
  fileInput.value = "";
  Papa.parse(file, {
    header:true, skipEmptyLines:true,
    complete: function(results) {
      const rows = results.data;
      if (!rows.length) { alert("CSV has no data rows."); return; }
      const required = ["n_e","B_T","beta_n","l_i","R_0","I_p"];
      const fields = results.meta.fields;
      const colMap = {};
      for (const req of required) {
        const found = fields.find(f => f.trim().toLowerCase() === req.toLowerCase());
        if (!found) { alert(`CSV missing column: ${req}\nFound: ${fields.join(", ")}`); return; }
        colMap[req] = found;
      }
      // Find label column (first column, or column named "label"/"shot")
      let labelCol = null;
      for (const f of fields) {
        const fl = f.trim().toLowerCase();
        if (fl === "label" || fl === "shot" || fl === "shot_number" || fl === "name") {
          labelCol = f; break;
        }
      }
      if (!labelCol) labelCol = fields[0]; // default to first column

      // Optional: time_ms column (enables the δ-vs-time plot). Also pick up
      // shot separately so groups can split by shot even when labelCol == shot.
      const timeCol = fields.find(f => f.trim().toLowerCase() === "time_ms") || null;
      const shotCol = fields.find(f => f.trim().toLowerCase() === "shot") || null;

      // Detect "extra" CSV columns (anything beyond the required/known set).
      // Any column with at least one finite numeric value becomes available
      // as a stack-subplot in the δ-vs-time view.
      const KNOWN_COLS = new Set([
        "n_e","b_t","beta_n","l_i","r_0","i_p",
        "time_ms","shot","shot_number","name","label",
        "delta","delta_nom","delta_nominal","minus","minus_1sigma",
        "plus","plus_1sigma","sigma","approx_sigma","row","bnli","beta_n_l_i",
        "half_width",
      ]);
      // Also skip the dynamic bound columns produced by either bound mode:
      // legacy tail-style ("minus_5pct", "plus_2p5pct") and CDF-style
      // ("lower_5cdf", "upper_84p13cdf").
      const BOUND_COL_RE = /^(minus|plus|lower|upper)_[0-9]+(p[0-9]+)?(pct|cdf)$/;
      const extraCols = fields.filter(f => {
        const fl = (f || "").trim().toLowerCase();
        if (!fl) return false;
        if (KNOWN_COLS.has(fl)) return false;
        if (BOUND_COL_RE.test(fl)) return false;
        if (f === labelCol) return false;
        // Must have at least one parseable value across the rows.
        return rows.some(r => Number.isFinite(parseFloat(r[f])));
      });

      const params  = getActiveParams();
      const dist    = $("sel_dist").value;
      const nsample = parseInt($("in_nsample").value) || 1000000;
      const sName   = currentScaling();
      const boundCfg = currentBoundConfig();
      const results2 = []; const errors = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const r = rows[i];
          const lbl = r[labelCol] || `Row ${i+1}`;
          const ne = parseFloat(r[colMap["n_e"]]);
          const BT = parseFloat(r[colMap["B_T"]]);
          const bn = parseFloat(r[colMap["beta_n"]]);
          const li = parseFloat(r[colMap["l_i"]]);
          const R0 = parseFloat(r[colMap["R_0"]]);
          const Ip = parseFloat(r[colMap["I_p"]]);
          if ([ne,BT,bn,li,R0,Ip].some(isNaN)) throw new Error("non-numeric value");
          if (li === 0) throw new Error("l_i = 0");
          const inp = {n_e:ne, B_T:Math.abs(BT), beta_n:bn, l_i:li, R_0:R0, I_p:Math.abs(Ip)};
          const mc = monteCarloThreshold(inp, params, dist, nsample, boundCfg.percentiles);
          const minus = mc.deltaNom - mc.psigL, plus = mc.psigU - mc.deltaNom;
          let tms = null;
          if (timeCol) {
            const tv = parseFloat(r[timeCol]);
            if (isFinite(tv)) tms = tv;
          }
          const shotVal = shotCol ? (r[shotCol] || "").toString().trim() || null : null;
          const extras = {};
          for (const c of extraCols) {
            const v = parseFloat(r[c]);
            if (Number.isFinite(v)) extras[c] = v;
          }
          results2.push({
            row: i+1, label: lbl, n_e: ne, B_T: BT, beta_n: bn, l_i: li,
            bnli: bn/li, R_0: R0, I_p: Ip,
            delta: mc.deltaNom, minus, plus, sigma: (minus+plus)/2,
            // Keep MC data so we can re-plot selected rows without redoing MC.
            centers: mc.centers, pdf: mc.pdf,
            deltaNom: mc.deltaNom, psigL: mc.psigL, psigU: mc.psigU,
            // Preserve the raw input row verbatim so exportCSV can emit
            // every column that was present in the input CSV.
            raw: { ...r },
            boundCfg,
            inputs: {...inp},
            scaling: sName, dist, nsample,
            time_ms: tms, shot: shotVal,
            extras,
          });
        } catch(e) { errors.push(`Row ${i+1}: ${e.message}`); }
      }

      if (errors.length) alert(`${errors.length} row(s) had errors:\n` + errors.slice(0,20).join("\n"));
      if (!results2.length) { alert("No valid results."); return; }

      const haveTimes = results2.every(r => r.time_ms !== null);
      // Remember dynamic stack keys so plotDeltaVsTime payload includes them.
      window._extraStackKeys = extraCols.slice();

      // Build the per-batch action bar + stack-quant checkboxes (placed
      // ABOVE the table so the user doesn't have to scroll past all the rows).
      const customQuants = extraCols.map(c => ({ key: c, label: c }));
      const allStackQuants = [...STACK_QUANTS, ...customQuants];
      const stackChecks = allStackQuants.map(q =>
        `<label style="margin:0 6px;font-style:normal;font-size:0.78rem;white-space:nowrap;">`
        + `<input type="checkbox" class="stack-quant" data-key="${q.key}"`
        + `${haveTimes ? "" : " disabled"}> ${q.label}</label>`
      ).join("");
      const summaryHtml =
          `<p class="summary">Processed ${results2.length} row(s) | Scaling: ${sName} | `
        + `MC: ${nsample.toLocaleString()} | dist: ${dist} | bounds: ${boundCfg.summary} &nbsp;`
        + `<button onclick="plotSelectedRows()">Plot Selected Rows</button> `
        + `<button onclick="plotDeltaVsTime()"${haveTimes ? "" : " disabled"} `
        + `title="${haveTimes ? "" : "CSV needs a time_ms column on every row"}">`
        + `Plot δ vs time</button> `
        + `<button onclick="exportCSV()">Export Results to CSV</button></p>`
        + `<p class="summary" style="margin-top:0">`
        + `<span style="font-style:normal">Stack with δ vs time:</span> ${stackChecks}</p>`;

      const cols = ["sel","row","label","n_e","B_T","β_n","l_i","β_n/l_i","R_0","I_p","δ_nom",
                    boundCfg.negCol, boundCfg.posCol, boundCfg.symCol];
      let tableHtml = `<table id="batch-table"><tr>`
              + `<th><input type="checkbox" id="row-select-all" onchange="toggleAllRowSelect(this)"></th>`
              + cols.slice(1).map(c=>`<th>${c}</th>`).join("")
              + `</tr>`;
      for (const r of results2) {
        tableHtml += `<tr>
          <td><input type="checkbox" class="row-select" data-idx="${r.row - 1}"></td>
          <td>${r.row}</td><td>${r.label}</td>
          <td>${r.n_e.toPrecision(4)}</td><td>${r.B_T.toPrecision(4)}</td>
          <td>${r.beta_n.toPrecision(4)}</td><td>${r.l_i.toPrecision(4)}</td>
          <td>${r.bnli.toPrecision(4)}</td><td>${r.R_0.toPrecision(4)}</td>
          <td>${r.I_p.toPrecision(4)}</td><td>${fmtE(r.delta)}</td>
          <td>${fmtE(r.minus)}</td><td>${fmtE(r.plus)}</td><td>${fmtE(r.sigma)}</td>
        </tr>`;
      }
      tableHtml += `</table>`;

      $("table-box").innerHTML = summaryHtml + tableHtml;
      $("plot-box").innerHTML = "";
      overplotTraces = [];

      window._batchResults = results2;
      window._batchInputFields = (fields || []).filter(Boolean);
    }
  });
}

// Quantities the user can stack as extra subplots under δ vs time.
const STACK_QUANTS = [
  { key: "I_p",    label: "|I_p|",    units: "MA"        },
  { key: "B_T",    label: "|B_T|",    units: "T"         },
  { key: "n_e",    label: "n_e",      units: "10¹⁹ m⁻³" },
  { key: "beta_n", label: "β_n",      units: ""          },
  { key: "l_i",    label: "l_i",      units: ""          },
  { key: "R_0",    label: "R_0",      units: "m"         },
  { key: "bnli",   label: "β_n / l_i", units: ""         },
];

function toggleAllRowSelect(master) {
  document.querySelectorAll(".row-select").forEach(cb => cb.checked = master.checked);
}

function _selectedBatchIndices() {
  return Array.from(document.querySelectorAll(".row-select:checked"))
    .map(cb => parseInt(cb.dataset.idx, 10))
    .filter(i => !isNaN(i));
}

function plotSelectedRows() {
  const rows = window._batchResults;
  if (!rows || !rows.length) { alert("Load a CSV first."); return; }
  const idxs = _selectedBatchIndices();
  if (!idxs.length) { alert("Tick the checkbox in one or more table rows first."); return; }

  overplotTraces = [];
  overplotCounter = 0;
  for (const i of idxs) {
    const r = rows[i];
    overplotCounter++;
    const tag = r.time_ms !== null ? ` t=${r.time_ms.toFixed(0)}ms` : "";
    const label = `${r.label}${tag} (${r.scaling})`;
    overplotTraces.push({
      label,
      centers: r.centers, pdf: r.pdf,
      deltaNom: r.deltaNom, psigL: r.psigL, psigU: r.psigU,
      inputs: {...r.inputs}, scaling: r.scaling, dist: r.dist,
      nsample: r.nsample, userLabel: r.label,
    });
  }
  return renderOverplot();
}

async function plotDeltaVsTime() {
  const rows = window._batchResults;
  if (!rows || !rows.length) { alert("Load a CSV first."); return; }
  if (!rows.every(r => r.time_ms !== null)) {
    alert("Plot δ vs time requires a `time_ms` column on every row of the CSV.");
    return;
  }

  // Read extra quantities to stack as subplots beneath δ.
  const extras = Array.from(document.querySelectorAll(".stack-quant:checked"))
    .map(cb => cb.dataset.key);

  _maybeClearStaleLimits("delta_vs_time");
  lastPlotKind = "delta_vs_time";
  _renderLegendEditor();
  _renderStatsPanel();
  _updateYPanelDropdown();
  _setPlotBusy("Rendering δ vs time…");

  const payload = {
    data: rows.map(r => ({
      shot: r.shot,
      time_ms: r.time_ms,
      deltaNom: r.deltaNom,
      psigL: r.psigL,
      psigU: r.psigU,
      I_p: r.I_p, B_T: r.B_T, n_e: r.n_e,
      beta_n: r.beta_n, l_i: r.l_i, R_0: r.R_0,
      bnli: r.bnli,
      ...(r.extras || {}),   // q0, q95, anything else from the CSV
    })),
    settings: { ..._renderPayloadSettings(), stack: extras },
  };
  try {
    const dataUrl = await _runPythonRender("render_delta_vs_time", payload);
    _showPlotImage(dataUrl);
  } catch (e) {
    console.error(e);
    _setPlotBusy(`<pre style="color:#c33">Plot error: ${e.message || e}</pre>`);
  }
}

function exportCSV() {
  const rows = window._batchResults;
  if (!rows || !rows.length) { alert("No results to export."); return; }
  const cfg = (rows[0] && rows[0].boundCfg) || currentBoundConfig();

  // CSV-quote any value that contains a comma, quote, or newline. Numbers
  // and bare strings pass through as-is.
  const csvCell = v => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Computed columns the export always populates. When an input column has
  // the same name, the computed value wins (preserves input position).
  const computed = [
    ["beta_n_l_i",    r => r.bnli],
    ["delta_nominal", r => r.delta],
    [cfg.negCsv,      r => r.minus],
    [cfg.posCsv,      r => r.plus],
    [cfg.symCsv,      r => r.sigma],
  ];
  const computedMap = new Map(computed);

  // Preserve every input column in its original order. Append any computed
  // columns that weren't present in the input header.
  const inputCols = (window._batchInputFields || []).slice();
  const appended  = computed.map(([n]) => n).filter(n => !inputCols.includes(n));
  const fieldnames = inputCols.concat(appended);

  const lines = [fieldnames.map(csvCell).join(",")];
  for (const r of rows) {
    const raw = r.raw || {};
    const out = fieldnames.map(name => {
      if (computedMap.has(name)) return computedMap.get(name)(r);
      return raw[name] !== undefined ? raw[name] : "";
    });
    lines.push(out.map(csvCell).join(","));
  }
  const blob = new Blob([lines.join("\n")], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "efp_results.csv";
  a.click();
}

// ─────────────────── Save / Load scalings ────────────────

function getSavedScalings() {
  try { return JSON.parse(localStorage.getItem("efp_scalings") || "{}"); }
  catch(e) { return {}; }
}
function putSavedScalings(obj) {
  localStorage.setItem("efp_scalings", JSON.stringify(obj));
}

const BUILTIN_NAMES = new Set([
  "2026 O,L WLS","2026 O,L OLS","2020 O,L,H WLS","2020 O,L WLS","Custom"
]);

function refreshDropdown() {
  const sel = $("sel_scaling");
  const cur = sel.value;
  const builtin = ["2026 O,L WLS","2026 O,L OLS","2020 O,L,H WLS","2020 O,L WLS"];
  const user = Object.keys(getSavedScalings()).sort();
  sel.innerHTML = "";
  for (const name of [...builtin, ...user, "Custom"]) {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  }
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function saveScaling() {
  const p = readExponents();
  if (!p) { alert("All exponent fields must be valid numbers."); return; }
  const name = prompt("Enter a name for this scaling:");
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (BUILTIN_NAMES.has(n)) { alert(`"${n}" is a reserved name.`); return; }
  const saved = getSavedScalings();
  if (saved[n] && !confirm(`Overwrite existing "${n}"?`)) return;
  saved[n] = p;
  putSavedScalings(saved);
  SCALINGS[n] = p;
  refreshDropdown();
  $("sel_scaling").value = n;
  renderFormula();
  alert(`Scaling "${n}" saved.`);
}

function loadScalingDialog() {
  const saved = getSavedScalings();
  const names = Object.keys(saved).sort();
  if (!names.length) { alert("No saved scalings found."); return; }
  const list = $("saved-list");
  list.innerHTML = "";
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    list.appendChild(opt);
  }
  $("load-dialog").showModal();
}

function doLoadSaved() {
  const list = $("saved-list");
  const name = list.value;
  if (!name) { alert("Select a scaling first."); return; }
  const saved = getSavedScalings();
  const p = saved[name]; if (!p) return;
  SCALINGS[name] = p;
  refreshDropdown();
  $("sel_scaling").value = name;
  _updatingExp = true; writeExponents(p); _updatingExp = false;
  renderFormula();
  $("load-dialog").close();
}

function doDeleteSaved() {
  const list = $("saved-list");
  const name = list.value;
  if (!name) { alert("Select a scaling first."); return; }
  if (!confirm(`Delete "${name}"?`)) return;
  const saved = getSavedScalings();
  delete saved[name];
  putSavedScalings(saved);
  if (!BUILTIN_NAMES.has(name)) delete SCALINGS[name];
  refreshDropdown();
  if (currentScaling() === name) {
    $("sel_scaling").value = "2026 O,L WLS";
    onScalingSelected();
  }
  for (const opt of list.options) {
    if (opt.value === name) { opt.remove(); break; }
  }
  if (!list.options.length) $("load-dialog").close();
}

// ─────────────────── Save / Load inputs ──────────────────

function getSavedInputs() {
    try { return JSON.parse(localStorage.getItem("efp_inputs") || "{}"); }
    catch(e) { return {}; }
  }
  function putSavedInputs(obj) {
    localStorage.setItem("efp_inputs", JSON.stringify(obj));
  }
  
  function saveInputs() {
    const label = $("in_label").value.trim();
    const ne = $("in_ne").value.trim();
    const BT = $("in_BT").value.trim();
    const bn = $("in_bn").value.trim();
    const li = $("in_li").value.trim();
    const R0 = $("in_R0").value.trim();
    const Ip = $("in_Ip").value.trim();
  
    if ([ne,BT,bn,li,R0,Ip].some(v => v === "" || isNaN(parseFloat(v)))) {
      alert("All input fields must contain valid numbers before saving.");
      return;
    }
  
    const name = prompt("Enter a name for this input set:");
    if (!name || !name.trim()) return;
    const n = name.trim();
  
    const saved = getSavedInputs();
    if (saved[n] && !confirm(`Overwrite existing "${n}"?`)) return;
  
    saved[n] = { label, n_e:ne, B_T:BT, beta_n:bn, l_i:li, R_0:R0, I_p:Ip };
    putSavedInputs(saved);
    alert(`Input set "${n}" saved.`);
  }
  
  function loadInputsDialog() {
    const saved = getSavedInputs();
    const names = Object.keys(saved).sort();
    if (!names.length) { alert("No saved input sets found."); return; }
    const list = $("saved-inputs-list");
    list.innerHTML = "";
    for (const n of names) {
      const opt = document.createElement("option");
      opt.value = n; opt.textContent = n;
      list.appendChild(opt);
    }
    $("load-inputs-dialog").showModal();
  }
  
  function doLoadSavedInputs() {
    const list = $("saved-inputs-list");
    const name = list.value;
    if (!name) { alert("Select an input set first."); return; }
    const saved = getSavedInputs();
    const p = saved[name];
    if (!p) return;
  
    // Switch to single mode
    document.querySelector('input[name="mode"][value="single"]').checked = true;
    toggleMode();
  
    $("in_label").value = p.label || "";
    $("in_ne").value    = p.n_e   || "";
    $("in_BT").value    = p.B_T   || "";
    $("in_bn").value    = p.beta_n|| "";
    $("in_li").value    = p.l_i   || "";
    $("in_R0").value    = p.R_0   || "";
    $("in_Ip").value    = p.I_p   || "";
  
    $("load-inputs-dialog").close();
  }
  
  function doDeleteSavedInputs() {
    const list = $("saved-inputs-list");
    const name = list.value;
    if (!name) { alert("Select an input set first."); return; }
    if (!confirm(`Delete "${name}"?`)) return;
    const saved = getSavedInputs();
    delete saved[name];
    putSavedInputs(saved);
    for (const opt of list.options) {
      if (opt.value === name) { opt.remove(); break; }
    }
    if (!list.options.length) $("load-inputs-dialog").close();
  }

// ─────────────────── Startup ─────────────────────────────

(function init() {
  const saved = getSavedScalings();
  for (const [name, p] of Object.entries(saved)) {
    if (!BUILTIN_NAMES.has(name)) SCALINGS[name] = p;
  }
  refreshDropdown();
  _updatingExp = true;
  writeExponents(SCALINGS[currentScaling()]);
  _updatingExp = false;
  toggleMode();
  _writeInlinePlotControls();
  const waitKatex = setInterval(() => {
    if (typeof katex !== "undefined") {
      clearInterval(waitKatex);
      renderFormula();
    }
  }, 50);
})();