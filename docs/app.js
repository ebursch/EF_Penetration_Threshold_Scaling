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
  if (overplotTraces.length) renderOverplot();
}
(function initDark() {
  if (localStorage.getItem("efp_dark") === "1") {
    document.body.classList.add("dark");
    document.getElementById("dark-toggle").checked = true;
  }
})();

// ─────────────────── Plot settings state ─────────────────

const DEFAULT_PS = {
  titleSize: 12, axisLabelSize: 14, tickSize: 12, legendSize: 10,
  fontFamily: "Times New Roman, serif",
  xLabel: "δ (Dominant EF / B_T)",
  yLabel: "Probability Density [a.u.]",
  width: 0, height: 420,
  lineWidth: 1.2, nomLineWidth: 2.0, sigLineWidth: 1.2,
  fillOpacity: 0.20,
  bgColor: "#ffffff", gridColor: "#dddddd",
  colorOverrides: {},
};
let plotSettings = JSON.parse(JSON.stringify(DEFAULT_PS));

function readPlotSettings() {
  return {
    titleSize:    parseInt($("ps_titleSize").value)   || 12,
    axisLabelSize:parseInt($("ps_axisLabelSize").value)|| 14,
    tickSize:     parseInt($("ps_tickSize").value)     || 12,
    legendSize:   parseInt($("ps_legendSize").value)   || 10,
    fontFamily:   $("ps_fontFamily").value,
    xLabel:       $("ps_xLabel").value,
    yLabel:       $("ps_yLabel").value,
    width:        parseInt($("ps_width").value)  || 0,
    height:       parseInt($("ps_height").value) || 420,
    lineWidth:    parseFloat($("ps_lineWidth").value)    || 1.2,
    nomLineWidth: parseFloat($("ps_nomLineWidth").value) || 2.0,
    sigLineWidth: parseFloat($("ps_sigLineWidth").value) || 1.2,
    fillOpacity:  parseFloat($("ps_fillOpacity").value)  || 0.20,
    bgColor:      $("ps_bgColor").value || "#ffffff",
    gridColor:    $("ps_gridColor").value || "#dddddd",
    colorOverrides: readColorOverrides(),
  };
}

function writePlotSettings(ps) {
  $("ps_titleSize").value     = ps.titleSize;
  $("ps_axisLabelSize").value = ps.axisLabelSize;
  $("ps_tickSize").value      = ps.tickSize;
  $("ps_legendSize").value    = ps.legendSize;
  $("ps_fontFamily").value    = ps.fontFamily;
  $("ps_xLabel").value        = ps.xLabel;
  $("ps_yLabel").value        = ps.yLabel;
  $("ps_width").value         = ps.width || "";
  $("ps_height").value        = ps.height;
  $("ps_lineWidth").value     = ps.lineWidth;
  $("ps_nomLineWidth").value  = ps.nomLineWidth;
  $("ps_sigLineWidth").value  = ps.sigLineWidth;
  $("ps_fillOpacity").value   = ps.fillOpacity;
  $("ps_bgColor").value       = ps.bgColor;
  $("ps_gridColor").value     = ps.gridColor;
}

function readColorOverrides() {
  const co = {};
  const container = $("ps_colorOverrides");
  const inputs = container.querySelectorAll("input");
  inputs.forEach(inp => {
    const idx = inp.dataset.idx;
    const val = inp.value.trim();
    if (val) co[idx] = val;
  });
  return co;
}

function buildColorOverrideInputs() {
  const container = $("ps_colorOverrides");
  container.innerHTML = "";
  for (let i = 0; i < overplotTraces.length; i++) {
    const lbl = document.createElement("label");
    lbl.textContent = overplotTraces[i].label;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.dataset.idx = i;
    inp.placeholder = PLOT_COLORS[i % PLOT_COLORS.length];
    inp.value = plotSettings.colorOverrides[i] || "";
    lbl.appendChild(inp);
    container.appendChild(lbl);
  }
}

function openPlotSettings() {
  writePlotSettings(plotSettings);
  buildColorOverrideInputs();
  $("plot-settings-dialog").showModal();
}

function applyPlotSettings() {
  plotSettings = readPlotSettings();
  if (overplotTraces.length) renderOverplot();
  $("plot-settings-dialog").close();
}

function resetPlotSettings() {
  plotSettings = JSON.parse(JSON.stringify(DEFAULT_PS));
  writePlotSettings(plotSettings);
  buildColorOverrideInputs();
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
SCALINGS["Custom"] = JSON.parse(JSON.stringify(SCALINGS["2026 O,L OLS"]));

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

function monteCarloThreshold(inputs, params, dist, nsample) {
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
  const psigL = percentile(sorted, 15.87);
  const psigU = percentile(sorted, 84.13);

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

function buildPlotlyTraces() {
    const ps = plotSettings;
    const traces = [];
    for (let ti = 0; ti < overplotTraces.length; ti++) {
      const t = overplotTraces[ti];
      const color = getTraceColor(ti);
      const pdfMax = Math.max(...t.pdf);
      const normPdf = Array.from(t.pdf).map(v => pdfMax > 0 ? v / pdfMax : 0);
      const ymax = 1.05;
  
      traces.push({
        x: Array.from(t.centers), y: normPdf,
        type:"scatter", mode:"lines", fill:"tozeroy",
        fillcolor: colorToRGBA(color, ps.fillOpacity),
        line:{color, width: ps.lineWidth},
        name: `${t.label} PDF`, legendgroup: t.label,
      });
      traces.push({
        x:[t.deltaNom, t.deltaNom], y:[0, ymax],
        mode:"lines", line:{color, dash:"solid", width: ps.nomLineWidth},
        name: `${t.label} δ=${fmtE(t.deltaNom)}`, legendgroup: t.label,
      });
      traces.push({
        x:[t.psigL, t.psigL], y:[0, ymax],
        mode:"lines", line:{color, dash:"dash", width: ps.sigLineWidth},
        name: `${t.label} −1σ (${fmtE(t.psigL,2)})`,
        legendgroup: t.label, showlegend: false,
      });
      traces.push({
        x:[t.psigU, t.psigU], y:[0, ymax],
        mode:"lines", line:{color, dash:"dash", width: ps.sigLineWidth},
        name: `${t.label} +1σ (${fmtE(t.psigU,2)})`,
        legendgroup: t.label, showlegend: false,
      });
    }
    return traces;
  }


function renderOverplot() {
  if (!overplotTraces.length) { $("plot-box").innerHTML = ""; return; }
  const ps = plotSettings;
  const traces = buildPlotlyTraces();
  const titleParts = overplotTraces.map(t => {
    const m = t.deltaNom - t.psigL, p = t.psigU - t.deltaNom;
    return `${t.label}: δ=${fmtE(t.deltaNom)} (−${fmtE(m,2)}/+${fmtE(p,2)})`;
  });
  const isDark = document.body.classList.contains("dark");
  const fontColor = isDark ? "#d4d4d4" : "#1a1a1a";
  const layout = {
    title: { text: titleParts.join("<br>"), font:{size: ps.titleSize, family: ps.fontFamily, color: fontColor} },
    xaxis: { title:{text: ps.xLabel, font:{size: ps.axisLabelSize, family: ps.fontFamily, color: fontColor}},
             tickfont:{size: ps.tickSize, family: ps.fontFamily, color: fontColor},
             exponentformat:"e", gridcolor: ps.gridColor },
    yaxis: { title:{text: ps.yLabel, font:{size: ps.axisLabelSize, family: ps.fontFamily, color: fontColor}},
             tickfont:{size: ps.tickSize, family: ps.fontFamily, color: fontColor},
             gridcolor: ps.gridColor },
    showlegend: true,
    legend: { font:{size: ps.legendSize, family: ps.fontFamily, color: fontColor} },
    margin: {t: 30 + overplotTraces.length * 18, b:55, l:65, r:20},
    height: ps.height + Math.max(0, overplotTraces.length - 2) * 15,
    width: ps.width || undefined,
    paper_bgcolor: isDark ? "#23272e" : ps.bgColor,
    plot_bgcolor:  isDark ? "#1a1d23" : ps.bgColor,
    font: { family: ps.fontFamily, color: fontColor },
  };
  Plotly.newPlot("plot-box", traces, layout, {responsive: !ps.width});
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

  let res;
  try { res = monteCarloThreshold(inputs, params, dist, nsample); }
  catch(e) { alert("Calculation error: " + e.message); return; }

  overplotCounter++;
  const label = userLabel
    ? `#${overplotCounter} ${userLabel} (${sName})`
    : `#${overplotCounter} ${sName}`;

  overplotTraces.push({
    label, centers:res.centers, pdf:res.pdf,
    deltaNom:res.deltaNom, psigL:res.psigL, psigU:res.psigU,
    inputs:{...inputs}, scaling:sName, dist, nsample, userLabel,
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
  const plotDiv = $("plot-box");
  if (!plotDiv || !plotDiv.data || !plotDiv.data.length) { alert("No plot to save."); return; }
  Plotly.downloadImage(plotDiv, {
    format:"png", width:1200, height:700, filename:"efp_threshold_plot",
  });
}

function savePlotData() {
  if (!overplotTraces.length) { alert("No plot data to save."); return; }
  const maxBins = Math.max(...overplotTraces.map(t => t.centers.length));
  const hdrParts = ["bin_index"];
  for (const t of overplotTraces) {
    const s = t.label.replace(/,/g, ";");
    hdrParts.push(`${s}_delta`, `${s}_pdf`);
  }
  hdrParts.push("");
  hdrParts.push("trace","label","scaling","dist","nsample",
                 "n_e","B_T","beta_n","l_i","R_0","I_p",
                 "delta_nominal","minus_1sigma","plus_1sigma","approx_sigma");
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

      const params  = getActiveParams();
      const dist    = $("sel_dist").value;
      const nsample = parseInt($("in_nsample").value) || 1000000;
      const sName   = currentScaling();
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
          const mc = monteCarloThreshold(inp, params, dist, nsample);
          const minus = mc.deltaNom - mc.psigL, plus = mc.psigU - mc.deltaNom;
          results2.push({
            row:i+1, label:lbl, n_e:ne, B_T:BT, beta_n:bn, l_i:li,
            bnli:bn/li, R_0:R0, I_p:Ip,
            delta:mc.deltaNom, minus, plus, sigma:(minus+plus)/2,
          });
        } catch(e) { errors.push(`Row ${i+1}: ${e.message}`); }
      }

      if (errors.length) alert(`${errors.length} row(s) had errors:\n` + errors.slice(0,20).join("\n"));
      if (!results2.length) { alert("No valid results."); return; }

      const cols = ["row","label","n_e","B_T","β_n","l_i","β_n/l_i","R_0","I_p","δ_nom","−1σ","+1σ","≈σ"];
      let html = `<table><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
      for (const r of results2) {
        html += `<tr>
          <td>${r.row}</td><td>${r.label}</td>
          <td>${r.n_e.toPrecision(4)}</td><td>${r.B_T.toPrecision(4)}</td>
          <td>${r.beta_n.toPrecision(4)}</td><td>${r.l_i.toPrecision(4)}</td>
          <td>${r.bnli.toPrecision(4)}</td><td>${r.R_0.toPrecision(4)}</td>
          <td>${r.I_p.toPrecision(4)}</td><td>${fmtE(r.delta)}</td>
          <td>${fmtE(r.minus)}</td><td>${fmtE(r.plus)}</td><td>${fmtE(r.sigma)}</td>
        </tr>`;
      }
      html += `</table>`;
      html += `<p class="summary">Processed ${results2.length} row(s) | Scaling: ${sName} | `
            + `MC: ${nsample.toLocaleString()} | dist: ${dist} &nbsp;`
            + `<button onclick="exportCSV()">Export Results to CSV</button></p>`;

      $("table-box").innerHTML = html;
      $("plot-box").innerHTML = "";
      overplotTraces = [];

      window._batchResults = results2;
    }
  });
}

function exportCSV() {
  const rows = window._batchResults;
  if (!rows || !rows.length) { alert("No results to export."); return; }
  const hdr = "label,n_e,B_T,beta_n,l_i,beta_n_l_i,R_0,I_p,delta_nominal,minus_1sigma,plus_1sigma,approx_sigma";
  const lines = [hdr];
  for (const r of rows) {
    // Wrap label in quotes in case it contains commas
    const safeLabel = `"${(r.label||"").replace(/"/g,'""')}"`;
    lines.push([safeLabel,r.n_e,r.B_T,r.beta_n,r.l_i,r.bnli,r.R_0,r.I_p,
                r.delta,r.minus,r.plus,r.sigma].join(","));
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
  "2026 O,L OLS","2026 O,L WLS","2020 O,L,H WLS","2020 O,L WLS","Custom"
]);

function refreshDropdown() {
  const sel = $("sel_scaling");
  const cur = sel.value;
  const builtin = ["2026 O,L OLS","2026 O,L WLS","2020 O,L,H WLS","2020 O,L WLS"];
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
    $("sel_scaling").value = "2026 O,L OLS";
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
  const waitKatex = setInterval(() => {
    if (typeof katex !== "undefined") {
      clearInterval(waitKatex);
      renderFormula();
    }
  }, 50);
})();