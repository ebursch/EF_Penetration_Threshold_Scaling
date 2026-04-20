"""
This python script launches a GUI which users can input the parameters: density (n_e), toroidal field (B_T), normalized beta (beta_n/l_i), major radius (R_0), and plasma current (I_p) and the empirical error field penetration threshold is calculated.
"""
import tkinter as tk
from tkinter import messagebox
from tkinter import ttk
import math

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
import matplotlib as mpl

formula_canvas_widget = None

def get_formula_latex(name: str) -> str:
    if name == "2026 O,L WLS":
        return r"\delta = 10^{-4.26}\left(\frac{\beta_n}{l_i}\right)^{0.13}\,|I_p|^{-1.01}\,R_0^{1.57}\,n_e^{0.56}\,|B_T|^{0.30}"
    if name == "2026 O,L OLS":
        return r"\delta = 10^{-4.31}\left(\frac{\beta_n}{l_i}\right)^{0.25}\,|I_p|^{-0.97}\,R_0^{1.88}\,n_e^{0.77}\,|B_T|^{0.20}"
    if name == "2020 O,L,H WLS":
        return r"\delta = 10^{-3.65}\,n_e^{0.58}\,B_T^{-1.13}\,R_0^{0.10}\left(\frac{\beta_n}{l_i}\right)^{-0.20}"
    if name == "2020 O,L WLS":
        return r"\delta = 10^{-3.49}\,n_e^{0.65}\,B_T^{-1.17}\,R_0^{0.17}\left(\frac{\beta_n}{l_i}\right)^{0.11}"

def calculate_threshold():
    try:
        n_e = float(entry_density.get())
        B_T = float(entry_toroidal_field.get())
        beta_n_l_i = float(entry_beta_n_l_i.get())
        R_0 = float(entry_major_radius.get())
        I_p = float(entry_plasma_current.get())

        s = scaling_var.get()

        if s == "2026 O,L WLS":
            coeff = 10 ** -4.26
            b_exp = 0.13
            ip_exp = -1.01
            R_exp = 1.57
            ne_exp = 0.56
            BT_exp = 0.30

        elif s == "2026 O,L OLS":
            coeff = 10 ** -4.31
            b_exp = 0.25
            ip_exp = -0.97
            R_exp = 1.88
            ne_exp = 0.77
            BT_exp = 0.20

        elif s == "2020 O,L,H WLS":
            coeff = 10 ** -3.65
            ne_exp = 0.58
            BT_exp = -1.13
            R_exp = 0.10
            b_exp = -0.20
            ip_exp = 0.0

        else:  # 2020 O,L WLS
            coeff = 10 ** -3.49
            ne_exp = 0.65
            BT_exp = -1.17
            R_exp = 0.17
            b_exp = 0.11
            ip_exp = 0.0

        delta = (
            coeff
            * (beta_n_l_i ** b_exp)
            * (abs(I_p) ** ip_exp)
            * (R_0 ** R_exp)
            * (n_e ** ne_exp)
            * (abs(B_T) ** BT_exp)
        )

        messagebox.showinfo("Threshold", f"{delta:.2e}")

    except ValueError:
        messagebox.showerror("Input Error", "Invalid numerical input.")

def update_formula(event=None):
    global formula_canvas_widget

    if formula_canvas_widget is not None:
        formula_canvas_widget.destroy()
        formula_canvas_widget = None

    mpl.rcParams['mathtext.fontset'] = 'dejavuserif'

    latex = get_formula_latex(scaling_var.get())

    fig = Figure(figsize=(6, 1.0), dpi=120)
    ax = fig.add_subplot(111)
    ax.axis('off')
    ax.text(0.5, 0.5, f"${latex}$", ha='center', va='center', fontsize=16)

    canvas = FigureCanvasTkAgg(fig, master=formula_frame)
    canvas.draw()
    formula_canvas_widget = canvas.get_tk_widget()
    formula_canvas_widget.pack(fill="both", expand=True)

root = tk.Tk()
root.title("Error Field Penetration Threshold Calculator")

tk.Label(root, text="n_e [10^19 m^-3]").grid(row=0, column=0)
entry_density = tk.Entry(root)
entry_density.grid(row=0, column=1)

tk.Label(root, text="|BT| [T]").grid(row=1, column=0)
entry_toroidal_field = tk.Entry(root)
entry_toroidal_field.grid(row=1, column=1)

tk.Label(root, text="beta_n/l_i").grid(row=2, column=0)
entry_beta_n_l_i = tk.Entry(root)
entry_beta_n_l_i.grid(row=2, column=1)

tk.Label(root, text="R0 [m]").grid(row=3, column=0)
entry_major_radius = tk.Entry(root)
entry_major_radius.grid(row=3, column=1)

tk.Label(root, text="|Ip| [MA]").grid(row=4, column=0)
entry_plasma_current = tk.Entry(root)
entry_plasma_current.grid(row=4, column=1)

scaling_var = tk.StringVar(value="2026 O,L OLS")
scaling_dropdown = ttk.Combobox(
    root,
    textvariable=scaling_var,
    values=[
        "2026 O,L OLS",
        "2026 O,L WLS",
        "2020 O,L,H WLS",
        "2020 O,L WLS"
    ],
    state="readonly"
)
scaling_dropdown.grid(row=5, column=1)
scaling_dropdown.bind("<<ComboboxSelected>>", update_formula)

tk.Button(root, text="Calculate", command=calculate_threshold).grid(row=6, column=0, columnspan=2)

formula_frame = tk.Frame(root)
formula_frame.grid(row=7, column=0, columnspan=2, sticky="nsew")

update_formula()
root.mainloop()