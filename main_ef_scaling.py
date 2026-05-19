"""
This python script launches a GUI which users can input the parameters:
density (n_e), toroidal field (B_T), normalized beta (beta_n), internal
inductance (l_i), major radius (R_0), and plasma current (I_p) and the
empirical error field penetration threshold is calculated using Monte Carlo
uncertainty propagation.

Users can either enter single values manually or upload a CSV file with
columns: n_e, B_T, beta_n, l_i, R_0, I_p. Results are displayed in a
table and can be exported to CSV.

2026 Scalings from E.M. Bursch et al 2026 Submitted to PPCF
2020 Scalings from N.C. Logan et al 2020 Plasma Phys. Control. Fusion 62 084001
"""
import tkinter as tk
from tkinter import messagebox, ttk, filedialog
import math
import csv
import os
import numpy as np

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
import matplotlib as mpl

formula_canvas_widget = None
result_canvas_widget = None
batch_results = []
batch_bound_config = None
batch_input_fieldnames = []


def get_formula_latex(name: str) -> str:
    if name == "2026 O,L WLS":
        return (
            r"\delta_\text{2026 O,L WLS} = 10^{-4.26\pm0.09}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.13\pm0.06}"
            r"\,|I_p|^{-1.01\pm0.07}\,R_0^{1.57\pm0.15}"
            r"\,n_e^{0.56\pm0.08}\,|B_T|^{0.30\pm0.10}"
        )
    if name == "2026 O,L OLS":
        return (
            r"\delta_\text{2026 O,L OLS} = 10^{-4.31\pm0.03}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.25\pm0.02}"
            r"\,|I_p|^{-0.97\pm0.02}\,R_0^{1.88\pm0.04}"
            r"\,n_e^{0.77\pm0.02}\,|B_T|^{0.20\pm0.03}"
        )
    if name == "2020 O,L,H WLS":
        return (
            r"\delta_\text{2020 O,L,H WLS} = 10^{-3.62\pm0.04}"
            r"\,n_e^{0.53\pm0.06}\,B_T^{-0.95\pm0.07}"
            r"\,R_0^{0.14\pm0.08}"
            r"\left(\frac{\beta_n}{l_i}\right)^{-0.19\pm0.05}"
            r"\,|I_p|^{0.00\pm0.00}"
        )
    if name == "2020 O,L WLS":
        return (
            r"\delta_\text{2020 O,L WLS} = 10^{-3.46\pm0.05}"
            r"\,n_e^{0.64\pm0.06}\,B_T^{-1.14\pm0.08}"
            r"\,R_0^{0.20\pm0.07}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.15\pm0.07}"
            r"\,|I_p|^{0.00\pm0.00}"
        )


SCALINGS = {
    "2026 O,L WLS": {
        "C":        (-4.26, 0.09),
        "bnli_exp": ( 0.13, 0.06),
        "ip_exp":   (-1.01, 0.07),
        "R_exp":    ( 1.57, 0.15),
        "ne_exp":   ( 0.56, 0.08),
        "BT_exp":   ( 0.30, 0.10),
    },
    "2026 O,L OLS": {
        "C":        (-4.31, 0.03),
        "bnli_exp": ( 0.25, 0.02),
        "ip_exp":   (-0.97, 0.02),
        "R_exp":    ( 1.88, 0.04),
        "ne_exp":   ( 0.77, 0.02),
        "BT_exp":   ( 0.20, 0.03),
    },
    "2020 O,L,H WLS": {
        "C":        (-3.62, 0.04),
        "ne_exp":   ( 0.53, 0.06),
        "BT_exp":   (-.95, 0.07),
        "R_exp":    ( 0.14, 0.08),
        "bnli_exp": (-0.19, 0.05),
        "ip_exp":   ( 0.00, 0.00),
    },
    "2020 O,L WLS": {
        "C":        (-3.46, 0.05),
        "ne_exp":   ( 0.64, 0.06),
        "BT_exp":   (-1.14, 0.08),
        "R_exp":    ( 0.20, 0.07),
        "bnli_exp": ( 0.15, 0.07),
        "ip_exp":   ( 0.00, 0.00),
    },
}

PARAM_KEY_MAP = {
    "bnli_exp": "beta_n_l_i",
    "ip_exp":   "I_p",
    "R_exp":    "R_0",
    "ne_exp":   "n_e",
    "BT_exp":   "B_T",
}

# Required CSV columns (case-insensitive matching performed at load time)
REQUIRED_COLUMNS = {"n_e", "B_T", "beta_n", "l_i", "R_0", "I_p"}


# ─────────────────── Monte Carlo core ────────────────────

def monte_carlo_threshold(test_dict, scaling_title,
                          dist="normal", nsample=int(1e6), bins=1000,
                          percentiles=(15.87, 84.13)):
    nsample = int(nsample)
    params = SCALINGS[scaling_title]
    length = len(params)

    work = dict(test_dict)
    if "bnli_exp" in params:
        if work["l_i"] == 0:
            raise ValueError("l_i must be non-zero.")
        work["beta_n_l_i"] = work["beta_n"] / work["l_i"]

    if dist == "flat":
        rands = np.random.rand(length, nsample)
    elif dist == "normal":
        rands = np.random.randn(length, nsample)
    elif dist == "normal truncated":
        rands = np.random.randn(length, nsample)
        while True:
            bad = np.where(np.abs(rands) > 1.5)
            if bad[0].size == 0:
                break
            rands[bad[0], bad[1]] = np.random.randn(bad[0].size)
    else:
        raise ValueError(f"Unknown distribution: {dist}")

    alpha_nom = {}
    alpha_mc  = {}
    for idx, (key, (val, unc)) in enumerate(params.items()):
        alpha_nom[key] = val
        alpha_mc[key]  = val + unc * rands[idx]

    delta_nominal = np.float64(1.0)
    delta_distrib = np.ones(nsample, dtype=np.float64)

    for key in params:
        if key == "C":
            delta_nominal = delta_nominal * 10.0 ** alpha_nom[key]
            delta_distrib = delta_distrib * 10.0 ** alpha_mc[key]
        else:
            x = work[PARAM_KEY_MAP[key]]
            delta_nominal = delta_nominal * x ** alpha_nom[key]
            delta_distrib = delta_distrib * x ** alpha_mc[key]

    pdf, bin_edges = np.histogram(delta_distrib, bins=bins, density=True)
    psigL, psigU = np.percentile(delta_distrib, list(percentiles))

    return delta_nominal, delta_distrib, pdf, bin_edges, psigL, psigU


# ─────────────────── Bound-mode helpers ──────────────────

_SIGMA_BOUND_CONFIG = {
    "percentiles": (15.87, 84.13),
    "cdf_levels":  (15.87, 84.13),
    "neg_latex":   r"$-1\sigma$",
    "pos_latex":   r"$+1\sigma$",
    "neg_col":     "−1σ",
    "pos_col":     "+1σ",
    "sym_col":     "≈σ",
    "neg_csv":     "minus_1sigma",
    "pos_csv":     "plus_1sigma",
    "sym_csv":     "approx_sigma",
    "summary":     "±1σ (CDF 15.87 / 84.13 %)",
    "band_label":  "±1σ band",
}


def _bound_config():
    """Return the bound-mode config used to label and compute MC bounds.

    Inputs are interpreted as CDF percentiles (cumulative probability at or
    below the lower / upper bound). The percentile pair is fed straight into
    np.percentile — no flipping. ±1σ remains the canonical 15.87 / 84.13 case.
    """
    try:
        mode = bound_mode_var.get()
    except (NameError, AttributeError):
        return dict(_SIGMA_BOUND_CONFIG)

    if mode == "cdf":
        try:
            lo_cdf = float(lower_pct_var.get())
            hi_cdf = float(upper_pct_var.get())
        except (ValueError, TypeError):
            lo_cdf, hi_cdf = 15.87, 84.13
        lo_cdf = max(0.0, min(lo_cdf, 100.0))
        hi_cdf = max(0.0, min(hi_cdf, 100.0))
        if lo_cdf > hi_cdf:
            lo_cdf, hi_cdf = hi_cdf, lo_cdf
        return {
            "percentiles": (lo_cdf, hi_cdf),
            "cdf_levels":  (lo_cdf, hi_cdf),
            "neg_latex":   rf"$\mathrm{{CDF}}={lo_cdf:g}\%$",
            "pos_latex":   rf"$\mathrm{{CDF}}={hi_cdf:g}\%$",
            "neg_col":     f"@{lo_cdf:g}%",
            "pos_col":     f"@{hi_cdf:g}%",
            "sym_col":     "Δ½",
            "neg_csv":     f"lower_{lo_cdf:g}cdf".replace(".", "p"),
            "pos_csv":     f"upper_{hi_cdf:g}cdf".replace(".", "p"),
            "sym_csv":     "half_width",
            "summary":     f"CDF {lo_cdf:g}% / {hi_cdf:g}%",
            "band_label":  f"CDF [{lo_cdf:g}%, {hi_cdf:g}%] band",
        }
    return dict(_SIGMA_BOUND_CONFIG)


# ─────────────────── Overlap-line helpers ────────────────

def _overlap_value():
    """Return (value, label) if the overlap line is enabled and numeric, else None."""
    try:
        if not overlap_enabled_var.get():
            return None
        x = float(overlap_value_var.get())
    except (TypeError, ValueError, NameError):
        return None
    lbl = overlap_label_var.get().strip() or "Dominant mode overlap"
    return x, lbl


def _draw_overlap_line(ax, orient="v"):
    """Draw the user's overlap line on `ax` (vertical by default, horizontal if orient='h')."""
    v = _overlap_value()
    if v is None:
        return
    x, lbl = v
    legend_label = f"{lbl} ({x:.2e})"
    if orient == "h":
        ax.axhline(x, color="seagreen", ls=":", lw=1.6, label=legend_label)
    else:
        ax.axvline(x, color="seagreen", ls=":", lw=1.6, label=legend_label)


# ─────────────────── Single-point calc ───────────────────

def calculate_threshold_single():
    global result_canvas_widget

    try:
        n_e    = float(entry_density.get())
        B_T    = float(entry_toroidal_field.get())
        beta_n = float(entry_beta_n.get())
        l_i    = float(entry_l_i.get())
        R_0    = float(entry_major_radius.get())
        I_p    = float(entry_plasma_current.get())
    except ValueError:
        messagebox.showerror("Input Error", "Invalid numerical input.")
        return

    if l_i == 0:
        messagebox.showerror("Input Error", "l_i must be non-zero.")
        return

    test_dict = {
        "n_e": n_e, "B_T": abs(B_T), "beta_n": beta_n,
        "l_i": l_i, "R_0": R_0, "I_p": abs(I_p),
    }

    s       = scaling_var.get()
    dist    = dist_var.get()
    nsample = int(float(nsample_var.get()))
    bc      = _bound_config()

    try:
        (delta_nominal, delta_distrib,
         pdf, bin_edges, psigL, psigU) = monte_carlo_threshold(
            test_dict, s, dist=dist, nsample=nsample,
            percentiles=bc["percentiles"])
    except Exception as e:
        messagebox.showerror("Calculation Error", str(e))
        return

    sigma_approx = (psigU - psigL) / 2.0

    if result_canvas_widget is not None:
        result_canvas_widget.destroy()
        result_canvas_widget = None

    mpl.rcParams['mathtext.fontset'] = 'dejavuserif'
    fig = Figure(figsize=(7, 3.5), dpi=120)
    ax = fig.add_subplot(111)
    bc = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    ax.fill_between(bc, pdf, alpha=0.35, color="steelblue")
    ax.plot(bc, pdf, color="steelblue", lw=1.2)
    ax.axvline(delta_nominal, color="k", ls="-",  lw=1.5, label="Nominal")
    ax.axvline(psigL, color="r", ls="--", lw=1.2,
               label=f"{bc['neg_latex']} ({psigL:.2e})")
    ax.axvline(psigU, color="r", ls="--", lw=1.2,
               label=f"{bc['pos_latex']} ({psigU:.2e})")
    _draw_overlap_line(ax)
    ax.set_xlabel(r"$\delta$  (Error-field penetration threshold)")
    ax.set_ylabel("Probability density")
    ax.set_title(
        rf"$\delta = {delta_nominal:.3e}$"
        rf"$\;(-{delta_nominal - psigL:.2e}\;/\;+{psigU - delta_nominal:.2e})$"
        f"\n{s}  |  MC: {nsample:,}  |  dist: {dist}  |  bounds: {bc['summary']}",
        #f"  |  $\\beta_n/l_i$ = {beta_n / l_i:.3f}",
        fontsize=10)
    ax.legend(fontsize=8)
    fig.tight_layout()

    canvas = FigureCanvasTkAgg(fig, master=result_frame)
    canvas.draw()
    result_canvas_widget = canvas.get_tk_widget()
    result_canvas_widget.pack(fill="both", expand=True)


# ─────────────────── CSV / batch calc ────────────────────

def load_csv_and_calculate():
    global batch_results, batch_bound_config, batch_input_fieldnames, result_canvas_widget

    filepath = filedialog.askopenfilename(
        title="Select CSV File",
        filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
    )
    if not filepath:
        return

    # ── Read & validate CSV ──────────────────────────────────────
    try:
        with open(filepath, newline="") as f:
            reader = csv.DictReader(f)
            raw_fieldnames = reader.fieldnames
            if raw_fieldnames is None:
                raise ValueError("CSV file appears to be empty.")

            # Build case-insensitive column mapping
            col_map = {}
            for raw in raw_fieldnames:
                stripped = raw.strip()
                for req in REQUIRED_COLUMNS:
                    if stripped.lower() == req.lower():
                        col_map[req] = raw  # map required name → actual header
            # Optional columns for time-series / per-shot views
            for raw in raw_fieldnames:
                stripped = raw.strip().lower()
                if stripped == "time_ms" and "time_ms" not in col_map:
                    col_map["time_ms"] = raw
                elif stripped == "shot" and "shot" not in col_map:
                    col_map["shot"] = raw
            missing = REQUIRED_COLUMNS - col_map.keys()
            if missing:
                raise ValueError(
                    f"CSV is missing required columns: {', '.join(sorted(missing))}\n"
                    f"Found columns: {', '.join(raw_fieldnames)}\n"
                    f"Required: {', '.join(sorted(REQUIRED_COLUMNS))}"
                )
            rows = list(reader)
            batch_input_fieldnames = [f for f in (raw_fieldnames or []) if f]
    except Exception as e:
        messagebox.showerror("CSV Error", str(e))
        return

    if len(rows) == 0:
        messagebox.showerror("CSV Error", "CSV file contains no data rows.")
        return

    s       = scaling_var.get()
    dist    = dist_var.get()
    nsample = int(float(nsample_var.get()))
    bc      = _bound_config()
    batch_bound_config = bc

    batch_results = []
    errors = []

    for i, row in enumerate(rows, start=1):
        try:
            n_e    = float(row[col_map["n_e"]])
            B_T    = float(row[col_map["B_T"]])
            beta_n = float(row[col_map["beta_n"]])
            l_i    = float(row[col_map["l_i"]])
            R_0    = float(row[col_map["R_0"]])
            I_p    = float(row[col_map["I_p"]])

            if l_i == 0:
                raise ValueError("l_i = 0")

            test_dict = {
                "n_e": n_e, "B_T": abs(B_T), "beta_n": beta_n,
                "l_i": l_i, "R_0": R_0, "I_p": abs(I_p),
            }

            (delta_nom, _delta_distrib, pdf, bin_edges,
             psigL, psigU) = monte_carlo_threshold(
                test_dict, s, dist=dist, nsample=nsample,
                percentiles=bc["percentiles"])

            minus = delta_nom - psigL
            plus  = psigU - delta_nom
            sigma = (plus + minus) / 2.0

            time_ms = None
            if "time_ms" in col_map:
                try:
                    time_ms = float(row[col_map["time_ms"]])
                except (ValueError, TypeError):
                    time_ms = None
            shot_id = None
            if "shot" in col_map:
                shot_id = (row[col_map["shot"]] or "").strip() or None

            batch_results.append({
                "row":        i,
                "n_e":        n_e,
                "B_T":        B_T,
                "beta_n":     beta_n,
                "l_i":        l_i,
                "beta_n_l_i": beta_n / l_i,
                "R_0":        R_0,
                "I_p":        I_p,
                "delta_nom":  delta_nom,
                "minus":      minus,
                "plus":       plus,
                "sigma":      sigma,
                "psigL":      psigL,
                "psigU":      psigU,
                "pdf":        pdf,
                "bin_edges":  bin_edges,
                "time_ms":    time_ms,
                "shot":       shot_id,
                "raw_row":    dict(row),
            })

        except Exception as e:
            errors.append(f"Row {i}: {e}")

    if errors:
        messagebox.showwarning(
            "Batch Warnings",
            f"{len(errors)} row(s) had errors:\n" + "\n".join(errors[:20]))

    if not batch_results:
        messagebox.showerror("Batch Error", "No valid results were produced.")
        return

    # ── Display results in a Treeview table ──────────────────────
    if result_canvas_widget is not None:
        result_canvas_widget.destroy()
        result_canvas_widget = None

    # Clear anything in result_frame
    for w in result_frame.winfo_children():
        w.destroy()

    columns = ("row", "n_e", "B_T", "β_n", "l_i", "β_n/l_i",
               "R_0", "I_p", "δ_nom",
               bc["neg_col"], bc["pos_col"], bc["sym_col"])

    container = tk.Frame(result_frame)
    container.pack(fill="both", expand=True)

    tree_scroll_y = ttk.Scrollbar(container, orient="vertical")
    tree_scroll_x = ttk.Scrollbar(container, orient="horizontal")
    tree = ttk.Treeview(
        container, columns=columns, show="headings",
        yscrollcommand=tree_scroll_y.set,
        xscrollcommand=tree_scroll_x.set,
        height=min(len(batch_results), 20),
        selectmode="extended",
    )
    tree_scroll_y.config(command=tree.yview)
    tree_scroll_x.config(command=tree.xview)

    for col in columns:
        tree.heading(col, text=col)
        tree.column(col, width=90, anchor="center")

    iid_to_index: dict[str, int] = {}
    for idx, r in enumerate(batch_results):
        iid = tree.insert("", "end", values=(
            r["row"],
            f"{r['n_e']:.4g}",
            f"{r['B_T']:.4g}",
            f"{r['beta_n']:.4g}",
            f"{r['l_i']:.4g}",
            f"{r['beta_n_l_i']:.4g}",
            f"{r['R_0']:.4g}",
            f"{r['I_p']:.4g}",
            f"{r['delta_nom']:.3e}",
            f"{r['minus']:.3e}",
            f"{r['plus']:.3e}",
            f"{r['sigma']:.3e}",
        ))
        iid_to_index[iid] = idx

    tree_scroll_y.pack(side="right", fill="y")
    tree_scroll_x.pack(side="bottom", fill="x")
    tree.pack(side="left", fill="both", expand=True)

    # Summary label
    summary_frame = tk.Frame(result_frame)
    summary_frame.pack(fill="x", pady=4)
    tk.Label(
        summary_frame,
        text=f"Processed {len(batch_results)} row(s)  |  Scaling: {s}  |  "
             f"MC samples: {nsample:,}  |  dist: {dist}  |  bounds: {bc['summary']}",
        font=("TkDefaultFont", 9, "italic"),
    ).pack(side="left", padx=8)

    tk.Button(
        summary_frame, text="Export Results to CSV",
        command=export_batch_results,
    ).pack(side="right", padx=8)

    tk.Button(
        summary_frame, text="Plot Selected Row(s)",
        command=lambda: plot_selected_rows(tree, iid_to_index),
    ).pack(side="right", padx=8)

    have_times = all(r.get("time_ms") is not None for r in batch_results)
    tk.Button(
        summary_frame, text="Plot δ vs time",
        command=plot_delta_vs_time,
        state="normal" if have_times else "disabled",
    ).pack(side="right", padx=8)

    # Update the stored widget ref so single-mode can clear it later
    result_canvas_widget = container


def export_batch_results():
    if not batch_results:
        messagebox.showwarning("Export", "No results to export.")
        return

    filepath = filedialog.asksaveasfilename(
        title="Save Results CSV",
        defaultextension=".csv",
        filetypes=[("CSV files", "*.csv")],
    )
    if not filepath:
        return

    bc = batch_bound_config or _bound_config()

    # Computed columns the export always populates. When an input column has
    # the same name, the computed value wins.
    computed = [
        ("beta_n_l_i",   lambda r: r["beta_n_l_i"]),
        ("delta_nominal", lambda r: r["delta_nom"]),
        (bc["neg_csv"],  lambda r: r["minus"]),
        (bc["pos_csv"],  lambda r: r["plus"]),
        (bc["sym_csv"],  lambda r: r["sigma"]),
    ]

    # Preserve every input column in its original order, then append any
    # computed columns that weren't already present.
    input_cols = list(batch_input_fieldnames or [])
    appended   = [name for name, _ in computed if name not in input_cols]
    fieldnames = ["row"] + input_cols + appended

    try:
        with open(filepath, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for r in batch_results:
                raw = r.get("raw_row") or {}
                out = {"row": r["row"]}
                for c in input_cols:
                    out[c] = raw.get(c, "")
                for name, getter in computed:
                    out[name] = getter(r)
                writer.writerow(out)
        messagebox.showinfo("Export", f"Results saved to:\n{filepath}")
    except Exception as e:
        messagebox.showerror("Export Error", str(e))


# ─────────────────── Subplot windows ─────────────────────

_PALETTE = ["steelblue", "darkorange", "seagreen", "crimson",
            "purple", "olive", "teal", "saddlebrown"]


def _row_label(r):
    parts = [f"row {r['row']}"]
    if r.get("shot"):
        parts.append(f"shot {r['shot']}")
    if r.get("time_ms") is not None:
        parts.append(f"t={r['time_ms']:.0f} ms")
    return "  ".join(parts)


def _open_plot_window(title, fig):
    win = tk.Toplevel(root)
    win.title(title)
    canvas = FigureCanvasTkAgg(fig, master=win)
    canvas.draw()
    canvas.get_tk_widget().pack(fill="both", expand=True)


def plot_selected_rows(tree, iid_to_index):
    iids = tree.selection()
    if not iids:
        messagebox.showinfo(
            "Plot Selected",
            "Select one or more rows in the table first.\n"
            "(Click a row, then ⌘-click / Shift-click others to extend.)")
        return

    indices = [iid_to_index[i] for i in iids if i in iid_to_index]
    if not indices:
        return

    mpl.rcParams["mathtext.fontset"] = "dejavuserif"
    fig = Figure(figsize=(8.5, 4.5), dpi=120)
    ax = fig.add_subplot(111)

    for k, idx in enumerate(indices):
        r = batch_results[idx]
        color = _PALETTE[k % len(_PALETTE)]
        be = r["bin_edges"]
        bc = 0.5 * (be[:-1] + be[1:])
        ax.fill_between(bc, r["pdf"], alpha=0.30, color=color)
        ax.plot(bc, r["pdf"], color=color, lw=1.2, label=_row_label(r))
        ax.axvline(r["delta_nom"], color=color, ls="-", lw=1.2, alpha=0.9)

    _draw_overlap_line(ax)
    ax.set_xlabel(r"$\delta$  (Error-field penetration threshold)")
    ax.set_ylabel("Probability density")
    ax.set_title(f"{len(indices)} selected row(s)", fontsize=10)
    ax.legend(fontsize=8, loc="best")
    fig.tight_layout()
    _open_plot_window("Selected rows — δ distributions", fig)


def plot_delta_vs_time():
    if not batch_results:
        return
    if not all(r.get("time_ms") is not None for r in batch_results):
        messagebox.showerror(
            "Plot δ vs time",
            "The loaded CSV does not have a `time_ms` column on every row.")
        return

    # Group by shot (None → single group "all").
    groups: dict[str, list[dict]] = {}
    for r in batch_results:
        key = r.get("shot") or "all"
        groups.setdefault(key, []).append(r)

    mpl.rcParams["mathtext.fontset"] = "dejavuserif"
    fig = Figure(figsize=(8.5, 4.5), dpi=120)
    ax = fig.add_subplot(111)

    for k, (shot, rs) in enumerate(groups.items()):
        rs_sorted = sorted(rs, key=lambda r: r["time_ms"])
        t = np.array([r["time_ms"] for r in rs_sorted])
        nom = np.array([r["delta_nom"] for r in rs_sorted])
        lo  = np.array([r["psigL"]     for r in rs_sorted])
        hi  = np.array([r["psigU"]     for r in rs_sorted])
        color = _PALETTE[k % len(_PALETTE)]
        label = f"shot {shot}" if shot != "all" else "δ_nominal"
        ax.plot(t, nom, marker="o", color=color, lw=1.4, label=label)
        ax.fill_between(t, lo, hi, color=color, alpha=0.20)

    _draw_overlap_line(ax, orient="h")
    ax.set_xlabel("time (ms)")
    ax.set_ylabel(r"$\delta_\mathrm{nominal}$")
    ax.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
    band_label = (batch_bound_config or _bound_config())["band_label"]
    ax.set_title(f"Nominal δ vs time ({band_label})", fontsize=10)
    ax.legend(fontsize=8, loc="best")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    _open_plot_window("δ vs time", fig)


# ─────────────────── Formula display ─────────────────────

def update_formula(event=None):
    global formula_canvas_widget

    if formula_canvas_widget is not None:
        formula_canvas_widget.destroy()
        formula_canvas_widget = None

    mpl.rcParams['mathtext.fontset'] = 'dejavuserif'
    latex = get_formula_latex(scaling_var.get())

    fig = Figure(figsize=(7, 1.2), dpi=120)
    ax = fig.add_subplot(111)
    ax.axis('off')
    ax.text(0.5, 0.5, f"${latex}$", ha='center', va='center', fontsize=14)

    canvas = FigureCanvasTkAgg(fig, master=formula_frame)
    canvas.draw()
    formula_canvas_widget = canvas.get_tk_widget()
    formula_canvas_widget.pack(fill="both", expand=True)


# ────────────────────── GUI layout ───────────────────────

root = tk.Tk()
root.title("Error Field Penetration Threshold Calculator (Monte Carlo)")
root.state("zoomed")
# ── Mode selection ───────────────────────────────────────
mode_frame = tk.LabelFrame(root, text="Input Mode", padx=8, pady=4)
mode_frame.grid(row=0, column=0, columnspan=3, sticky="ew", padx=6, pady=4)

mode_var = tk.StringVar(value="single")

def toggle_mode():
    is_single = mode_var.get() == "single"
    state_single = "normal" if is_single else "disabled"
    for w in (entry_density, entry_toroidal_field, entry_beta_n,
              entry_l_i, entry_major_radius, entry_plasma_current):
        w.config(state=state_single)
    btn_calc_single.config(state=state_single)
    btn_load_csv.config(state="disabled" if is_single else "normal")
    # Disable preset buttons in batch mode
    for b in preset_buttons:
        b.config(state=state_single)

tk.Radiobutton(
    mode_frame, text="Single Point", variable=mode_var,
    value="single", command=toggle_mode,
).pack(side="left", padx=10)
tk.Radiobutton(
    mode_frame, text="Batch (CSV Upload)", variable=mode_var,
    value="batch", command=toggle_mode,
).pack(side="left", padx=10)

# ── Input fields ─────────────────────────────────────────
input_frame = tk.LabelFrame(root, text="Single-Point Inputs", padx=8, pady=4)
input_frame.grid(row=1, column=0, columnspan=3, sticky="ew", padx=6, pady=4)

r = 0
tk.Label(input_frame, text="n_e [10¹⁹ m⁻³]").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_density = tk.Entry(input_frame)
entry_density.grid(row=r, column=1, padx=4, pady=2)

r += 1
tk.Label(input_frame, text="|B_T| [T]").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_toroidal_field = tk.Entry(input_frame)
entry_toroidal_field.grid(row=r, column=1, padx=4, pady=2)

r += 1
tk.Label(input_frame, text="beta_n").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_beta_n = tk.Entry(input_frame)
entry_beta_n.grid(row=r, column=1, padx=4, pady=2)

r += 1
tk.Label(input_frame, text="l_i").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_l_i = tk.Entry(input_frame)
entry_l_i.grid(row=r, column=1, padx=4, pady=2)

r += 1
tk.Label(input_frame, text="R_0 [m]").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_major_radius = tk.Entry(input_frame)
entry_major_radius.grid(row=r, column=1, padx=4, pady=2)

r += 1
tk.Label(input_frame, text="|I_p| [MA]").grid(row=r, column=0, sticky="e", padx=4, pady=2)
entry_plasma_current = tk.Entry(input_frame)
entry_plasma_current.grid(row=r, column=1, padx=4, pady=2)

# ── Settings ─────────────────────────────────────────────
settings_frame = tk.LabelFrame(root, text="Settings", padx=8, pady=4)
settings_frame.grid(row=2, column=0, columnspan=3, sticky="ew", padx=6, pady=4)

tk.Label(settings_frame, text="Scaling").grid(row=0, column=0, sticky="e", padx=4, pady=2)
scaling_var = tk.StringVar(value="2026 O,L OLS")
scaling_dropdown = ttk.Combobox(
    settings_frame, textvariable=scaling_var,
    values=["2026 O,L OLS", "2026 O,L WLS", "2020 O,L,H WLS", "2020 O,L WLS"],
    state="readonly", width=20)
scaling_dropdown.grid(row=0, column=1, padx=4, pady=2)
scaling_dropdown.bind("<<ComboboxSelected>>", update_formula)

tk.Label(settings_frame, text="MC Distribution").grid(row=1, column=0, sticky="e", padx=4, pady=2)
dist_var = tk.StringVar(value="normal")
ttk.Combobox(
    settings_frame, textvariable=dist_var,
    values=["normal", "flat", "normal truncated"],
    state="readonly", width=20,
).grid(row=1, column=1, padx=4, pady=2)

tk.Label(settings_frame, text="MC Samples").grid(row=2, column=0, sticky="e", padx=4, pady=2)
nsample_var = tk.StringVar(value="1000000")
tk.Entry(settings_frame, textvariable=nsample_var, width=22).grid(row=2, column=1, padx=4, pady=2)

# Bound-type selector (±1σ vs custom CDF lower / upper percentile)
bound_mode_var = tk.StringVar(value="sigma")
lower_pct_var  = tk.StringVar(value="15.87")
upper_pct_var  = tk.StringVar(value="84.13")


def _populate_sigma_pcts():
    """Sigma mode → CDF 15.87 / 84.13 (the percentile equivalent of ±1σ)."""
    lower_pct_var.set("15.87")
    upper_pct_var.set("84.13")


tk.Label(settings_frame, text="Bound type").grid(row=3, column=0, sticky="e", padx=4, pady=2)
_bound_row = tk.Frame(settings_frame)
_bound_row.grid(row=3, column=1, sticky="w", padx=4, pady=2)
tk.Radiobutton(
    _bound_row, text="±1σ", variable=bound_mode_var, value="sigma",
    command=_populate_sigma_pcts,
).pack(side="left")
tk.Radiobutton(
    _bound_row, text="Custom CDF:", variable=bound_mode_var, value="cdf",
).pack(side="left", padx=(10, 4))
tk.Label(_bound_row, text="lower").pack(side="left")
tk.Entry(_bound_row, textvariable=lower_pct_var, width=6).pack(side="left")
tk.Label(_bound_row, text="%   upper").pack(side="left")
tk.Entry(_bound_row, textvariable=upper_pct_var, width=6).pack(side="left")
tk.Label(_bound_row, text="%").pack(side="left")

# Dominant-mode overlap reference line
overlap_enabled_var = tk.BooleanVar(value=False)
overlap_value_var   = tk.StringVar(value="")
overlap_label_var   = tk.StringVar(value="Dominant mode overlap")

tk.Checkbutton(
    settings_frame, text="Overlap δ:", variable=overlap_enabled_var,
).grid(row=4, column=0, sticky="e", padx=4, pady=2)

_overlap_row = tk.Frame(settings_frame)
_overlap_row.grid(row=4, column=1, sticky="w", padx=4, pady=2)
tk.Entry(_overlap_row, textvariable=overlap_value_var, width=10).pack(side="left")
tk.Label(_overlap_row, text="  Label:").pack(side="left")
tk.Entry(_overlap_row, textvariable=overlap_label_var, width=22).pack(side="left")

# ── Action buttons ───────────────────────────────────────
btn_frame = tk.Frame(root)
btn_frame.grid(row=3, column=0, columnspan=3, pady=6)

btn_calc_single = tk.Button(
    btn_frame, text="Calculate (Single Point)",
    command=calculate_threshold_single)
btn_calc_single.pack(side="left", padx=10)

btn_load_csv = tk.Button(
    btn_frame, text="Load CSV & Calculate Batch",
    command=load_csv_and_calculate, state="disabled")
btn_load_csv.pack(side="left", padx=10)
def populate_defaults(defaults):
    """Fill single-point entries with the given default values."""
    mode_var.set("single")
    toggle_mode()
    for entry, val in defaults.items():
        entry.delete(0, tk.END)
        entry.insert(0, val)


ITER_DEFAULTS = {
    entry_density:        "9.8",    # n_e [10¹⁹ m⁻³]
    entry_toroidal_field: "5.3",    # |B_T| [T]
    entry_beta_n:         "1.8",    # β_n
    entry_l_i:            "1.0",    # l_i
    entry_major_radius:   "6.2",    # R₀ [m]
    entry_plasma_current: "14.9",   # |I_p| [MA]
}

SPARC_L_DEFAULTS = {
    entry_density:        "17.3",   # n_e [10¹⁹ m⁻³]
    entry_toroidal_field: "12.16",  # |B_T| [T]
    entry_beta_n:         "0.17",   # β_n
    entry_l_i:            "0.74",   # l_i
    entry_major_radius:   "1.85",   # R₀ [m]
    entry_plasma_current: "8.7",    # |I_p| [MA]
}

SPARC_H_DEFAULTS = {
    entry_density:        "28.8",   # n_e [10¹⁹ m⁻³]
    entry_toroidal_field: "12.16",  # |B_T| [T]
    entry_beta_n:         "0.98",   # β_n
    entry_l_i:            "0.72",   # l_i
    entry_major_radius:   "1.85",   # R₀ [m]
    entry_plasma_current: "8.7",    # |I_p| [MA]
}
preset_buttons = []

preset_buttons.append(tk.Button(
    btn_frame, text="ITER Defaults",
    command=lambda: populate_defaults(ITER_DEFAULTS),
))
preset_buttons[-1].pack(side="left", padx=10)

preset_buttons.append(tk.Button(
    btn_frame, text="SPARC L-mode Defaults",
    command=lambda: populate_defaults(SPARC_L_DEFAULTS),
))
preset_buttons[-1].pack(side="left", padx=10)

preset_buttons.append(tk.Button(
    btn_frame, text="SPARC H-mode Defaults",
    command=lambda: populate_defaults(SPARC_H_DEFAULTS),
))
preset_buttons[-1].pack(side="left", padx=10)

# ── Formula display ──────────────────────────────────────
formula_frame = tk.Frame(root)
formula_frame.grid(row=4, column=0, columnspan=3, sticky="nsew")

# ── Results area ─────────────────────────────────────────
result_frame = tk.Frame(root)
result_frame.grid(row=5, column=0, columnspan=3, sticky="nsew")

root.grid_rowconfigure(5, weight=1)
root.grid_columnconfigure(1, weight=1)

toggle_mode()
update_formula()
root.mainloop()