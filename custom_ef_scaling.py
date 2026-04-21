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
_updating_exponents = False

# ── Exponent editor constants ────────────────────────────
EXP_KEYS = ["C", "bnli_exp", "ip_exp", "R_exp", "ne_exp", "BT_exp"]
EXP_LABELS = {
    "C":        "C (log₁₀)",
    "bnli_exp": "β_n/l_i exp",
    "ip_exp":   "|I_p| exp",
    "R_exp":    "R₀ exp",
    "ne_exp":   "n_e exp",
    "BT_exp":   "|B_T| exp",
}


def get_formula_latex(name: str) -> str:
    if name == "Custom":
        p = SCALINGS.get("Custom", SCALINGS["2026 O,L OLS"])
        C_v, C_u = p["C"]
        bnli_v, bnli_u = p["bnli_exp"]
        ip_v, ip_u = p["ip_exp"]
        R_v, R_u = p["R_exp"]
        ne_v, ne_u = p["ne_exp"]
        BT_v, BT_u = p["BT_exp"]
        return (
            r"\delta_\text{Custom} = 10^{"
            + f"{C_v:g}" + r"\pm" + f"{C_u:g}" + r"}"
            r"\left(\frac{\beta_n}{l_i}\right)^{"
            + f"{bnli_v:g}" + r"\pm" + f"{bnli_u:g}" + r"}"
            r"\,|I_p|^{" + f"{ip_v:g}" + r"\pm" + f"{ip_u:g}" + r"}"
            r"\,R_0^{" + f"{R_v:g}" + r"\pm" + f"{R_u:g}" + r"}"
            r"\,n_e^{" + f"{ne_v:g}" + r"\pm" + f"{ne_u:g}" + r"}"
            r"\,|B_T|^{" + f"{BT_v:g}" + r"\pm" + f"{BT_u:g}" + r"}"
        )
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

# Initialize Custom scaling as a copy of the default
SCALINGS["Custom"] = dict(SCALINGS["2026 O,L OLS"])

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
                          dist="normal", nsample=int(1e6), bins=1000):
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
    psigL, psigU = np.percentile(delta_distrib, [15.87, 84.13])

    return delta_nominal, delta_distrib, pdf, bin_edges, psigL, psigU


# ─────────────────── Exponent editor helpers ─────────────

def populate_exponent_entries(name):
    """Fill exponent entry fields from the named scaling."""
    global _updating_exponents
    _updating_exponents = True
    params = SCALINGS[name]
    for key in EXP_KEYS:
        val, unc = params[key]
        exp_val_vars[key].set(f"{val:g}")
        exp_unc_vars[key].set(f"{unc:g}")
    _updating_exponents = False


def on_exponent_changed(*args):
    """Called when any exponent entry is edited by the user."""
    if _updating_exponents:
        return
    try:
        custom = {}
        for key in EXP_KEYS:
            v = float(exp_val_vars[key].get())
            u = float(exp_unc_vars[key].get())
            custom[key] = (v, u)
    except ValueError:
        return  # incomplete input; wait for valid numbers
    SCALINGS["Custom"] = custom
    scaling_var.set("Custom")
    update_formula()


def on_scaling_selected(event=None):
    """Called when the user picks a scaling from the dropdown."""
    name = scaling_var.get()
    if name != "Custom":
        populate_exponent_entries(name)
    update_formula()


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

    try:
        (delta_nominal, delta_distrib,
         pdf, bin_edges, psigL, psigU) = monte_carlo_threshold(
            test_dict, s, dist=dist, nsample=nsample)
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
    ax.axvline(psigL, color="r", ls="--", lw=1.2, label=rf"$-1\sigma$ ({psigL:.2e})")
    ax.axvline(psigU, color="r", ls="--", lw=1.2, label=rf"$+1\sigma$ ({psigU:.2e})")
    ax.set_xlabel(r"$\delta$  (Error-field penetration threshold)")
    ax.set_ylabel("Probability density")
    ax.set_title(
        rf"$\delta = {delta_nominal:.3e}$"
        rf"$\;(-{delta_nominal - psigL:.2e}\;/\;+{psigU - delta_nominal:.2e})$"
        f"\n{s}  |  MC: {nsample:,}  |  dist: {dist}",
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
    global batch_results, result_canvas_widget

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
            missing = REQUIRED_COLUMNS - col_map.keys()
            if missing:
                raise ValueError(
                    f"CSV is missing required columns: {', '.join(sorted(missing))}\n"
                    f"Found columns: {', '.join(raw_fieldnames)}\n"
                    f"Required: {', '.join(sorted(REQUIRED_COLUMNS))}"
                )
            rows = list(reader)
    except Exception as e:
        messagebox.showerror("CSV Error", str(e))
        return

    if len(rows) == 0:
        messagebox.showerror("CSV Error", "CSV file contains no data rows.")
        return

    s       = scaling_var.get()
    dist    = dist_var.get()
    nsample = int(float(nsample_var.get()))

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

            (delta_nom, _, _, _, psigL, psigU) = monte_carlo_threshold(
                test_dict, s, dist=dist, nsample=nsample)

            minus = delta_nom - psigL
            plus  = psigU - delta_nom
            sigma = (plus + minus) / 2.0

            batch_results.append({
                "row":       i,
                "n_e":       n_e,
                "B_T":       B_T,
                "beta_n":    beta_n,
                "l_i":       l_i,
                "beta_n_l_i": beta_n / l_i,
                "R_0":       R_0,
                "I_p":       I_p,
                "delta_nom": delta_nom,
                "minus":     minus,
                "plus":      plus,
                "sigma":     sigma,
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
               "R_0", "I_p", "δ_nom", "−1σ", "+1σ", "≈σ")

    container = tk.Frame(result_frame)
    container.pack(fill="both", expand=True)

    tree_scroll_y = ttk.Scrollbar(container, orient="vertical")
    tree_scroll_x = ttk.Scrollbar(container, orient="horizontal")
    tree = ttk.Treeview(
        container, columns=columns, show="headings",
                yscrollcommand=tree_scroll_y.set,
        xscrollcommand=tree_scroll_x.set,
        height=min(len(batch_results), 20),
    )
    tree_scroll_y.config(command=tree.yview)
    tree_scroll_x.config(command=tree.xview)

    for col in columns:
        tree.heading(col, text=col)
        tree.column(col, width=90, anchor="center")

    for r in batch_results:
        tree.insert("", "end", values=(
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

    tree_scroll_y.pack(side="right", fill="y")
    tree_scroll_x.pack(side="bottom", fill="x")
    tree.pack(side="left", fill="both", expand=True)

    # Summary label
    summary_frame = tk.Frame(result_frame)
    summary_frame.pack(fill="x", pady=4)
    tk.Label(
        summary_frame,
        text=f"Processed {len(batch_results)} row(s)  |  Scaling: {s}  |  "
             f"MC samples: {nsample:,}  |  dist: {dist}",
        font=("TkDefaultFont", 9, "italic"),
    ).pack(side="left", padx=8)

    tk.Button(
        summary_frame, text="Export Results to CSV",
        command=export_batch_results,
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

    fieldnames = [
        "row", "n_e", "B_T", "beta_n", "l_i", "beta_n_l_i",
        "R_0", "I_p", "delta_nominal", "minus_1sigma",
        "plus_1sigma", "approx_sigma",
    ]

    try:
        with open(filepath, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in batch_results:
                writer.writerow({
                    "row":            r["row"],
                    "n_e":            r["n_e"],
                    "B_T":            r["B_T"],
                    "beta_n":         r["beta_n"],
                    "l_i":            r["l_i"],
                    "beta_n_l_i":     r["beta_n_l_i"],
                    "R_0":            r["R_0"],
                    "I_p":            r["I_p"],
                    "delta_nominal":  r["delta_nom"],
                    "minus_1sigma":   r["minus"],
                    "plus_1sigma":    r["plus"],
                    "approx_sigma":   r["sigma"],
                })
        messagebox.showinfo("Export", f"Results saved to:\n{filepath}")
    except Exception as e:
        messagebox.showerror("Export Error", str(e))


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

# ── Top-level container for inputs + exponent editor side-by-side ──
top_container = tk.Frame(root)
top_container.grid(row=1, column=0, columnspan=3, sticky="ew", padx=6, pady=4)

# ── Input fields (left side) ────────────────────────────
input_frame = tk.LabelFrame(top_container, text="Single-Point Inputs", padx=8, pady=4)
input_frame.pack(side="left", fill="both", expand=False, padx=(0, 4))

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

# ── Exponent editor (right side) ─────────────────────────
exp_frame = tk.LabelFrame(top_container, text="Scaling Exponents (edit → Custom)", padx=8, pady=4)
exp_frame.pack(side="left", fill="both", expand=True, padx=(4, 0))

tk.Label(exp_frame, text="Parameter", font=("TkDefaultFont", 9, "bold")).grid(
    row=0, column=0, padx=4, pady=2)
tk.Label(exp_frame, text="Value", font=("TkDefaultFont", 9, "bold")).grid(
    row=0, column=1, padx=4, pady=2)
tk.Label(exp_frame, text="± Uncert.", font=("TkDefaultFont", 9, "bold")).grid(
    row=0, column=2, padx=4, pady=2)

exp_val_vars = {}
exp_unc_vars = {}

for i, key in enumerate(EXP_KEYS):
    row_idx = i + 1
    tk.Label(exp_frame, text=EXP_LABELS[key]).grid(row=row_idx, column=0, sticky="e", padx=4, pady=2)

    v = tk.StringVar()
    u = tk.StringVar()
    exp_val_vars[key] = v
    exp_unc_vars[key] = u

    e_val = tk.Entry(exp_frame, textvariable=v, width=10)
    e_val.grid(row=row_idx, column=1, padx=4, pady=2)

    e_unc = tk.Entry(exp_frame, textvariable=u, width=10)
    e_unc.grid(row=row_idx, column=2, padx=4, pady=2)

    v.trace_add("write", on_exponent_changed)
    u.trace_add("write", on_exponent_changed)

# ── Settings ─────────────────────────────────────────────
settings_frame = tk.LabelFrame(root, text="Settings", padx=8, pady=4)
settings_frame.grid(row=2, column=0, columnspan=3, sticky="ew", padx=6, pady=4)

tk.Label(settings_frame, text="Scaling").grid(row=0, column=0, sticky="e", padx=4, pady=2)
scaling_var = tk.StringVar(value="2026 O,L OLS")
scaling_dropdown = ttk.Combobox(
    settings_frame, textvariable=scaling_var,
    values=["2026 O,L OLS", "2026 O,L WLS", "2020 O,L,H WLS", "2020 O,L WLS", "Custom"],
    state="readonly", width=20)
scaling_dropdown.grid(row=0, column=1, padx=4, pady=2)
scaling_dropdown.bind("<<ComboboxSelected>>", on_scaling_selected)

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

# ── Initialize exponent fields from default scaling ──────
populate_exponent_entries(scaling_var.get())

toggle_mode()
update_formula()
root.mainloop()

