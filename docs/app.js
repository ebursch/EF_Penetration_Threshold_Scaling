"use strict";

// ─────────────────── Scalings ────────────────────────────
// Each value: [nominal, uncertainty]
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
  C:    ["ex_C_v","ex_C_u"],
  bnli: ["ex_bnli_v","ex_bnli_u"],
  ip:   ["ex_ip_v","ex_ip_u"],
  R:    ["ex_R_v","ex_R_u"],
  ne:   ["ex_ne_v","ex_ne_u"],
  BT:   ["ex_BT_v","ex_BT_u"],
};

let SCALINGS = JSON.parse(JSON.stringify(BUILTIN_SCALINGS));
SCALINGS["Custom"] = JSON.parse(JSON.stringify(SCALINGS["2026 O,L OLS"]));

// ─────────────────── Helpers ─────────────────────────────

const $ = id => document.getElementById(id);
const mode = () => document.querySelector('input[name="mode"]:checked').value;

function fmtE(x, d=3) {
  return x.toExponential(d);
}

// Box-Muller normal random
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

// ─────────────────── Read GUI helpers ────────────────────

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

function getActiveParams() {
  return SCALINGS[currentScaling()];
}

// ─────────────────── Monte Carlo core ────────────────────

function monteCarloThreshold(inputs, params, dist, nsample) {
  const keys = EXP_ORDER;
  const nk = keys.length;
  const bnli = inputs.beta_n / inputs.l_i;

  // Generate random matrix (nk × nsample)
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

  // Nominal + MC exponent arrays
  const alphaV = keys.map(k => params[k][0]);
  const alphaU = keys.map(k => params[k][1]);

  // Build delta distribution
  const delta = new Float64Array(nsample);
  delta.fill(1.0);
  let deltaNom = 1.0;

  for (let ki = 0; ki < nk; ki++) {
    const nom = alphaV[ki];
    const unc = alphaU[ki];
    const r = rands[ki];
    const key = keys[ki];

    if (key === "C") {
      deltaNom *= Math.pow(10, nom);
      for (let i = 0; i < nsample; i++) {
        delta[i] *= Math.pow(10, nom + unc * r[i]);
      }
    } else {
      let x;
      if      (key === "bnli") x = bnli;
      else if (key === "ip")   x = Math.abs(inputs.I_p);
      else if (key === "R")    x = inputs.R_0;
      else if (key === "ne")   x = inputs.n_e;
      else if (key === "BT")   x = Math.abs(inputs.B_T);
      deltaNom *= Math.pow(x, nom);
      for (let i = 0; i < nsample; i++) {
        delta[i] *= Math.pow(x, nom + unc * r[i]);
      }
    }
  }

  // Sort for percentiles
  const sorted = Float64Array.from(delta).sort();
  const psigL = percentile(sorted, 15.87);
  const psigU = percentile(sorted, 84.13);

  // Histogram (1000 bins)
  const bins = 1000;
  const mn = sorted[0], mx = sorted[sorted.length - 1];
  const bw = (mx - mn) / bins;
  const counts = new Float64Array(bins);
  for (let i = 0; i < nsample; i++) {
    let bi = Math.floor((delta[i] - mn) / bw);
    if (bi >= bins) bi = bins - 1;
    if (bi < 0) bi = 0;
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
    return `\\delta_{\\text{2026 O,L WLS}} = 10^{-4.26\\pm0.09}`
      + `\\left(\\frac{\\beta_n}{l_i}\\right)^{0.13\\pm0.06}`
      + `\\,|I_p|^{-1.01\\pm0.07}\\,R_0^{1.57\\pm0.15}`
      + `\\,n_e^{0.56\\pm0.08}\\,|B_T|^{0.30\\pm0.10}`;
  if (name === "2026 O,L OLS")
    return `\\delta_{\\text{2026 O,L OLS}} = 10^{-4.31\\pm0.03}`
      + `\\left(\\frac{\\beta_n}{l_i}\\right)^{0.25\\pm0.02}`
      + `\\,|I_p|^{-0.97\\pm0.02}\\,R_0^{1.88\\pm0.04}`
      + `\\,n_e^{0.77\\pm0.02}\\,|B_T|^{0.20\\pm0.03}`;
  if (name === "2020 O,L,H WLS")
    return `\\delta_{\\text{2020 O,L,H WLS}} = 10^{-3.62\\pm0.04}`
      + `\\,n_e^{0.53\\pm0.06}\\,B_T^{-0.95\\pm0.07}`
      + `\\,R_0^{0.14\\pm0.08}`
      + `\\left(\\frac{\\beta_n}{l_i}\\right)^{-0.19\\pm0.05}`
      + `\\,|I_p|^{0.00\\pm0.00}`;
  if (name === "2020 O,L WLS")
    return `\\delta_{\\text{2020 O,L WLS}} = 10^{-3.46\\pm0.05}`
      + `\\,n_e^{0.64\\pm0.06}\\,B_T^{-1.14\\pm0.08}`
      + `\\,R_0^{0.20\\pm0.07}`
      + `\\left(\\frac{\\beta_n}{l_i}\\right)^{0.15\\pm0.07}`
      + `\\,|I_p|^{0.00\\pm0.00}`;

  // Dynamic (Custom or user-saved)
  const safe = name.replace(/_/g, "\\_");
  return `\\delta_{\\text{${safe}}} = 10^{${f(p.C[0],p.C[1])}}`
    + `\\left(\\frac{\\beta_n}{l_i}\\right)^{${f(p.bnli[0],p.bnli[1])}}`
    + `\\,|I_p|^{${f(p.ip[0],p.ip[1])}}`
    + `\\,R_0^{${f(p.R[0],p.R[1])}}`
    + `\\,n_e^{${f(p.ne[0],p.ne[1])}}`
    + `\\,|B_T|^{${f(p.BT[0],p.BT[1])}}`;
}

function renderFormula() {
  const el = $("formula-box");
  try {
    katex.render(formulaLatex(currentScaling()), el, {
      displayMode: true, throwOnError: false,
    });
  } catch(e) { el.textContent = "(formula render error)"; }
}

// ─────────────────── Exponent editor events ──────────────

let _updatingExp = false;

function onExpChanged() {
  if (_updatingExp) return;
  const p = readExponents();
  if (!p) return;
  SCALINGS["Custom"] = p;
  $("sel_scaling").value = "Custom";
  renderFormula();
}

function onScalingSelected() {
  const name = currentScaling();
  if (name !== "Custom") {
    _updatingExp = true;
    writeExponents(SCALINGS[name]);
    _updatingExp = false;
  }
  renderFormula();
}

// ─────────────────── Mode toggle ─────────────────────────

function toggleMode() {
  const single = mode() === "single";
  document.querySelectorAll("#input-box input").forEach(
    el => el.disabled = !single);
  $("btn_calc").disabled = !single;
  $("btn_csv").disabled  = single;
  document.querySelectorAll(".preset-btn").forEach(
    el => el.disabled = !single);
}

// ─────────────────── Presets ─────────────────────────────

function fillInputs(ne,BT,bn,li,R0,Ip) {
  document.querySelector('input[name="mode"][value="single"]').checked = true;
  toggleMode();
  $("in_ne").value = ne;
  $("in_BT").value = BT;
  $("in_bn").value = bn;
  $("in_li").value = li;
  $("in_R0").value = R0;
  $("in_Ip").value = Ip;
}
function fillITER()    { fillInputs(9.8,  5.3,  1.8,  1.0,  6.2,  14.9); }
function fillSPARC_L() { fillInputs(17.3, 12.16,0.17, 0.74, 1.85, 8.7);  }
function fillSPARC_H() { fillInputs(28.8, 12.16,0.98, 0.72, 1.85, 8.7);  }

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
  const inputs = readSingleInputs();
  if (!inputs) return;
  const params  = getActiveParams();
  const dist    = $("sel_dist").value;
  const nsample = parseInt($("in_nsample").value) || 1000000;
  const sName   = currentScaling();

  let res;
  try { res = monteCarloThreshold(inputs, params, dist, nsample); }
  catch(e) { alert("Calculation error: " + e.message); return; }

  const { deltaNom, pdf, centers, psigL, psigU } = res;
  const minus = deltaNom - psigL;
  const plus  = psigU - deltaNom;

  // Plot
  const traceArea = {
    x: Array.from(centers), y: Array.from(pdf),
    type:"scatter", mode:"lines", fill:"tozeroy",
    fillcolor:"rgba(70,130,180,0.3)", line:{color:"steelblue", width:1.2},
    name:"PDF",
  };
  const mkLine = (xv,color,dash,label) => ({
    x:[xv,xv], y:[0, Math.max(...pdf)*1.05],
    mode:"lines", line:{color,dash,width:1.5}, name:label,
  });
  const layout = {
    title: `δ = ${fmtE(deltaNom)} (−${fmtE(minus,2)} / +${fmtE(plus,2)})<br>`
         + `<span style="font-size:0.8em">${sName} | MC: ${nsample.toLocaleString()} | dist: ${dist}</span>`,
    xaxis:{title:"δ (Error-field penetration threshold)"},
    yaxis:{title:"Probability density"},
    showlegend:true, margin:{t:70,b:50,l:60,r:20}, height: 380,
  };
  Plotly.newPlot("plot-box", [
    traceArea,
    mkLine(deltaNom,"black","solid","Nominal"),
    mkLine(psigL,"red","dash",`−1σ (${fmtE(psigL,2)})`),
    mkLine(psigU,"red","dash",`+1σ (${fmtE(psigU,2)})`),
  ], layout, {responsive:true});

  $("table-box").innerHTML = "";
}

// ─────────────────── CSV / batch ─────────────────────────

function loadCSV(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = "";

  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: function(results) {
      const rows = results.data;
      if (!rows.length) { alert("CSV has no data rows."); return; }

      // Case-insensitive column mapping
      const required = ["n_e","B_T","beta_n","l_i","R_0","I_p"];
      const fields = results.meta.fields;
      const colMap = {};
      for (const req of required) {
        const found = fields.find(f => f.trim().toLowerCase() === req.toLowerCase());
        if (!found) { alert(`CSV missing column: ${req}\nFound: ${fields.join(", ")}`); return; }
        colMap[req] = found;
      }

      const params  = getActiveParams();
      const dist    = $("sel_dist").value;
      const nsample = parseInt($("in_nsample").value) || 1000000;
      const sName   = currentScaling();

      const results2 = [];
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const r = rows[i];
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
          const minus = mc.deltaNom - mc.psigL;
          const plus  = mc.psigU - mc.deltaNom;
          results2.push({
            row:i+1, n_e:ne, B_T:BT, beta_n:bn, l_i:li,
            bnli: bn/li, R_0:R0, I_p:Ip,
            delta: mc.deltaNom, minus, plus, sigma:(minus+plus)/2,
          });
        } catch(e) { errors.push(`Row ${i+1}: ${e.message}`); }
      }

      if (errors.length) alert(`${errors.length} row(s) had errors:\n` + errors.slice(0,20).join("\n"));
      if (!results2.length) { alert("No valid results."); return; }

      // Build table
      const cols = ["row","n_e","B_T","β_n","l_i","β_n/l_i","R_0","I_p","δ_nom","−1σ","+1σ","≈σ"];
      let html = `<table><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
      for (const r of results2) {
        html += `<tr>
          <td>${r.row}</td><td>${r.n_e.toPrecision(4)}</td><td>${r.B_T.toPrecision(4)}</td>
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

      // Stash for export
      window._batchResults = results2;
    }
  });
}

function exportCSV() {
  const rows = window._batchResults;
  if (!rows || !rows.length) { alert("No results to export."); return; }
  const hdr = "row,n_e,B_T,beta_n,l_i,beta_n_l_i,R_0,I_p,delta_nominal,minus_1sigma,plus_1sigma,approx_sigma";
  const lines = [hdr];
  for (const r of rows) {
    lines.push([r.row,r.n_e,r.B_T,r.beta_n,r.l_i,r.bnli,r.R_0,r.I_p,
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
  // Restore selection if still valid
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
  const p = saved[name];
  if (!p) return;
  SCALINGS[name] = p;
  refreshDropdown();
  $("sel_scaling").value = name;
  _updatingExp = true;
  writeExponents(p);
  _updatingExp = false;
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
  // Remove from dialog list
  for (const opt of list.options) {
    if (opt.value === name) { opt.remove(); break; }
  }
  if (!list.options.length) $("load-dialog").close();
}

// ─────────────────── Startup ─────────────────────────────

(function init() {
  // Load saved scalings into runtime
  const saved = getSavedScalings();
  for (const [name, p] of Object.entries(saved)) {
    if (!BUILTIN_NAMES.has(name)) SCALINGS[name] = p;
  }
  refreshDropdown();
  _updatingExp = true;
  writeExponents(SCALINGS[currentScaling()]);
  _updatingExp = false;
  toggleMode();
  // Wait for KaTeX to load then render
  const waitKatex = setInterval(() => {
    if (typeof katex !== "undefined") {
      clearInterval(waitKatex);
      renderFormula();
    }
  }, 50);
})();