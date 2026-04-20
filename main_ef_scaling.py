"""
This python script launches a GUI which users can input the parameters:
density (n_e), toroidal field (B_T), normalized beta (beta_n), internal
inductance (l_i), major radius (R_0), and plasma current (I_p) and the
empirical error field penetration threshold is calculated using Monte Carlo
uncertainty propagation.

If a scaling uses beta_n/l_i, the ratio is computed internally from the
two separate inputs.
"""
import tkinter as tk
from tkinter import messagebox
from tkinter import ttk
import math
import numpy as np

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
import matplotlib as mpl

formula_canvas_widget = None
result_canvas_widget = None


def get_formula_latex(name: str) -> str:
    if name == "2026 O,L WLS":
        return (
            r"\delta = 10^{-4.26\pm0.09}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.13\pm0.06}"
            r"\,|I_p|^{-1.01\pm0.07}\,R_0^{1.57\pm0.15}"
            r"\,n_e^{0.56\pm0.08}\,|B_T|^{0.30\pm0.10}"
        )
    if name == "2026 O,L OLS":
        return (
            r"\delta = 10^{-4.31\pm0.03}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.25\pm0.02}"
            r"\,|I_p|^{-0.97\pm0.02}\,R_0^{1.88\pm0.04}"
            r"\,n_e^{0.77\pm0.02}\,|B_T|^{0.20\pm0.03}"
        )
    if name == "2020 O,L,H WLS":
        return (
            r"\delta = 10^{-3.65\pm0.03}"
            r"\,n_e^{0.58\pm0.06}\,B_T^{-1.13\pm0.07}"
            r"\,R_0^{0.10\pm0.07}"
            r"\left(\frac{\beta_n}{l_i}\right)^{-0.20\pm0.05}"
        )
    if name == "2020 O,L WLS":
        return (
            r"\delta = 10^{-3.49\pm0.05}"
            r"\,n_e^{0.65\pm0.06}\,B_T^{-1.17\pm0.07}"
            r"\,R_0^{0.17\pm0.07}"
            r"\left(\frac{\beta_n}{l_i}\right)^{0.11\pm0.07}"
        )


# ── Scaling parameters: {key: (nominal, uncertainty)} ──
# 'C' is the log10 coefficient; all others are exponents.
# 'bnli_exp' flags that the scaling uses beta_n / l_i (computed internally).
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
        "C":        (-3.65, 0.03),
        "ne_exp":   ( 0.58, 0.06),
        "BT_exp":   (-1.13, 0.07),
        "R_exp":    ( 0.10, 0.07),
        "bnli_exp": (-0.20, 0.05),
        "ip_exp":   ( 0.00, 0.00),
    },
    "2020 O,L WLS": {
        "C":        (-3.49, 0.05),
        "ne_exp":   ( 0.65, 0.06),
        "BT_exp":   (-1.17, 0.07),
        "R_exp":    ( 0.17, 0.07),
        "bnli_exp": ( 0.11, 0.07),
        "ip_exp":   ( 0.00, 0.00),
    },
}

# Map scaling-dict keys → physical variable names in test_dict
PARAM_KEY_MAP = {
    "bnli_exp": "beta_n_l_i",   # ratio computed before MC call
    "ip_exp":   "I_p",
    "R_exp":    "R_0",
    "ne_exp":   "n_e",
    "BT_exp":   "B_T",
}


def monte_carlo_threshold(test_dict, scaling_title,
                          dist="normal", nsample=int(1e6), bins=1000):
    """
    Monte Carlo uncertainty propagation for the error-field penetration
    threshold.

    Parameters
    ----------
    test_dict : dict
        Must contain: n_e, B_T, beta_n, l_i, R_0, I_p.
        beta_n / l_i is computed internally when the scaling requires it.
    scaling_title : str
        Key into the SCALINGS dict.
    dist : str
        'normal', 'flat', or 'normal truncated'
    nsample : int
        Number of Monte Carlo samples.
    bins : int
        Number of histogram bins for the PDF.

    Returns
    -------
    delta_nominal, delta_distrib, pdf, bin_edges, psigL, psigU
    """
    nsample = int(nsample)
    params = SCALINGS[scaling_title]
    length = len(params)

    # ── Build an internal working copy with beta_n/l_i pre-computed ──
    work = dict(test_dict)
    if "bnli_exp" in params:
        if work["l_i"] == 0:
            raise ValueError("l_i must be non-zero (division by zero).")
        work["beta_n_l_i"] = work["beta_n"] / work["l_i"]

    # ── 1. Draw random deviates ──────────────────────────────────────
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

    # ── 2. Build MC-sampled exponent arrays ──────────────────────────
    alpha_nom = {}
    alpha_mc  = {}

    for idx, (key, (val, unc)) in enumerate(params.items()):
        alpha_nom[key] = val
        alpha_mc[key]  = val + unc * rands[idx]

    # ── 3. Compute nominal δ and full MC distribution ────────────────
    delta_nominal = np.float64(1.0)
    delta_distrib = np.ones(nsample, dtype=np.float64)

    for key in params:
        if key == "C":
            delta_nominal = delta_nominal * 10.0 ** alpha_nom[key]
            delta_distrib = delta_distrib * 10.0 ** alpha_mc[key]
        else:
            phys_key = PARAM_KEY_MAP[key]
            x = work[phys_key]
            delta_nominal = delta_nominal * x ** alpha_nom[key]
            delta_distrib = delta_distrib * x ** alpha_mc[key]

    # ── 4. Statistics ────────────────────────────────────────────────
    pdf, bin_edges = np.histogram(delta_distrib, bins=bins, density=True)
    psigL, psigU = np.percentile(delta_distrib, [15.87, 84.13])

    return delta_nominal, delta_distrib, pdf, bin_edges, psigL, psigU


def calculate_threshold():
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
        "n_e":    n_e,
        "B_T":    abs(B_T),
        "beta_n": beta_n,
        "l_i":    l_i,
        "R_0":    R_0,
        "I_p":    abs(I_p),
    }

    s       = scaling_var.get()
    dist    = dist_var.get()
    nsample = int(float(nsample_var.get()))

    try:
        (delta_nominal, delta_distrib,
         pdf, bin_edges, psigL, psigU) = monte_carlo_threshold(
            test_dict, s, dist=dist, nsample=nsample
        )
    except Exception as e:
        messagebox.showerror("Calculation Error", str(e))
        return

    sigma_approx = (psigU - psigL) / 2.0

    # ── Update result plot ───────────────────────────────────────────
    if result_canvas_widget is not None:
        result_canvas_widget.destroy()
        result_canvas_widget = None

    mpl.rcParams['mathtext.fontset'] = 'dejavuserif'

    fig = Figure(figsize=(7, 3.5), dpi=120)
    ax = fig.add_subplot(111)

    bin_centres = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    ax.fill_between(bin_centres, pdf, alpha=0.35, color="steelblue")
    ax.plot(bin_centres, pdf, color="steelblue", lw=1.2)

    ax.axvline(delta_nominal, color="k", ls="-",  lw=1.5, label="Nominal")
    ax.axvline(psigL,         color="r", ls="--", lw=1.2,
               label=rf"$-1\sigma$ ({psigL:.2e})")
    ax.axvline(psigU,         color="r", ls="--", lw=1.2,
               label=rf"$+1\sigma$ ({psigU:.2e})")

    ax.set_xlabel(r"$\delta$  (Error-field penetration threshold)")
    ax.set_ylabel("Probability density")
    ax.set_title(
        rf"$\delta = {delta_nominal:.3e}$"
        rf"$\;(-{delta_nominal - psigL:.2e}\;/\;+{psigU - delta_nominal:.2e})$"
        f"\n{s}  |  MC samples: {nsample:,}  |  dist: {dist}"
        f"  |  $\\beta_n/l_i$ = {beta_n / l_i:.3f}",
        fontsize=10,
    )
    ax.legend(fontsize=8)
    fig.tight_layout()

    canvas = FigureCanvasTkAgg(fig, master=result_frame)
    canvas.draw()
    result_canvas_widget = canvas.get_tk_widget()
    result_canvas_widget.pack(fill="both", expand=True)

    print(
        f"{delta_nominal:.3e} "
        f"(-{delta_nominal - psigL:.3e} / +{psigU - delta_nominal:.3e}) "
        f"~ +/- {sigma_approx:.3e}: "
        f"Nominal Value (-x,+y of 1 sigma) ~ +/- 1 sigma"
    )


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


# ────────────────────── GUI layout ──────────────────────
root = tk.Tk()
root.title("Error Field Penetration Threshold Calculator (Monte Carlo)")

row = 0
tk.Label(root, text="n_e [10^19 m^-3]").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_density = tk.Entry(root)
entry_density.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="|B_T| [T]").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_toroidal_field = tk.Entry(root)
entry_toroidal_field.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="β_n").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_beta_n = tk.Entry(root)
entry_beta_n.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="l_i").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_l_i = tk.Entry(root)
entry_l_i.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="R0 [m]").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_major_radius = tk.Entry(root)
entry_major_radius.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="|Ip| [MA]").grid(row=row, column=0, sticky="e", padx=4, pady=2)
entry_plasma_current = tk.Entry(root)
entry_plasma_current.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="Scaling").grid(row=row, column=0, sticky="e", padx=4, pady=2)
scaling_var = tk.StringVar(value="2026 O,L OLS")
scaling_dropdown = ttk.Combobox(
    root,
    textvariable=scaling_var,
    values=[
        "2026 O,L OLS",
        "2026 O,L WLS",
        "2020 O,L,H WLS",
        "2020 O,L WLS",
    ],
    state="readonly",
    width=20,
)
scaling_dropdown.grid(row=row, column=1, padx=4, pady=2)
scaling_dropdown.bind("<<ComboboxSelected>>", update_formula)

row += 1
tk.Label(root, text="MC Distribution").grid(row=row, column=0, sticky="e", padx=4, pady=2)
dist_var = tk.StringVar(value="normal")
dist_dropdown = ttk.Combobox(
    root,
    textvariable=dist_var,
    values=["normal", "flat", "normal truncated"],
    state="readonly",
    width=20,
)
dist_dropdown.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Label(root, text="MC Samples").grid(row=row, column=0, sticky="e", padx=4, pady=2)
nsample_var = tk.StringVar(value="1000000")
entry_nsample = tk.Entry(root, textvariable=nsample_var)
entry_nsample.grid(row=row, column=1, padx=4, pady=2)

row += 1
tk.Button(root, text="Calculate (Monte Carlo)", command=calculate_threshold).grid(
    row=row, column=0, columnspan=2, pady=6
)

row += 1
formula_frame = tk.Frame(root)
formula_frame.grid(row=row, column=0, columnspan=2, sticky="nsew")

row += 1
result_frame = tk.Frame(root)
result_frame.grid(row=row, column=0, columnspan=2, sticky="nsew")

root.grid_rowconfigure(row, weight=1)
root.grid_columnconfigure(1, weight=1)

update_formula()
root.mainloop()