"""Matplotlib rendering engine for the EF Penetration Threshold web GUI.

Loaded into Pyodide. Three entry points:
    render_overplot(traces, settings)        → δ-distribution overlay
    render_delta_vs_time(rows, settings)     → stacked time-series subplots
    save_figure(traces, settings, fmt)       → returns bytes for download

Data is passed in as plain Python dicts/lists (after `to_py()`). Each
function returns a base64 data-URL string the JS side can drop into an
<img>'s src.
"""
from __future__ import annotations

import base64
import io
import math
from contextlib import contextmanager

import numpy as np
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt

# ── Defaults / fallbacks ────────────────────────────────────────────
DEFAULT_PALETTE = [
    "#4C72B0", "#DD8452", "#55A467", "#C44E52", "#8172B2",
    "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD",
]

LEGEND_LOCATIONS = (
    "best", "upper right", "upper left", "lower left", "lower right",
    "right", "center left", "center right", "lower center",
    "upper center", "center", "none",
)


def _coalesce(*vals):
    for v in vals:
        if v is not None:
            return v
    return None


def _color_for(idx: int, overrides) -> str:
    if overrides:
        c = overrides.get(str(idx)) or overrides.get(idx)
        if c:
            return c
    return DEFAULT_PALETTE[idx % len(DEFAULT_PALETTE)]


@contextmanager
def _styled(settings):
    """Apply matplotlib rcParams from settings for the lifetime of a plot."""
    rc = {
        "font.family":    settings.get("fontFamily", "serif"),
        "font.size":      settings.get("baseFontSize", 11),
        "axes.titlesize": settings.get("titleSize", 13),
        "axes.labelsize": settings.get("axisLabelSize", 12),
        "xtick.labelsize": settings.get("tickSize", 10),
        "ytick.labelsize": settings.get("tickSize", 10),
        "legend.fontsize": settings.get("legendSize", 10),
        "axes.grid":       bool(settings.get("grid", False)),
        "grid.color":      settings.get("gridColor", "#dddddd"),
        "grid.alpha":      settings.get("gridAlpha", 0.5),
        "grid.linestyle":  settings.get("gridStyle", "-"),
        "axes.spines.top":   bool(settings.get("spineTop", True)),
        "axes.spines.right": bool(settings.get("spineRight", True)),
        "axes.edgecolor":  settings.get("axisColor", "#000000"),
        "xtick.direction": settings.get("tickDir", "out"),
        "ytick.direction": settings.get("tickDir", "out"),
        "figure.facecolor": settings.get("bgColor", "#ffffff"),
        "axes.facecolor":   settings.get("axesBgColor", settings.get("bgColor", "#ffffff")),
        "savefig.facecolor": settings.get("bgColor", "#ffffff"),
        "mathtext.fontset": settings.get("mathFontset", "dejavuserif"),
    }
    with matplotlib.rc_context(rc):
        yield


def _fig_to_data_url(fig, dpi: int, fmt: str = "png", tight: bool = True) -> str:
    buf = io.BytesIO()
    kwargs = {"format": fmt, "dpi": dpi, "facecolor": fig.get_facecolor()}
    if tight:
        kwargs["bbox_inches"] = "tight"
    fig.savefig(buf, **kwargs)
    plt.close(fig)
    mime = {"png": "image/png", "svg": "image/svg+xml", "pdf": "application/pdf"}[fmt]
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _apply_axis_limits(ax, settings, axis: str):
    lo = settings.get(f"{axis}Min")
    hi = settings.get(f"{axis}Max")
    if lo is not None and lo != "":
        try:
            lo_v = float(lo)
            getattr(ax, f"set_{axis}lim")(left=lo_v) if axis == "x" else ax.set_ylim(bottom=lo_v)
        except (TypeError, ValueError):
            pass
    if hi is not None and hi != "":
        try:
            hi_v = float(hi)
            getattr(ax, f"set_{axis}lim")(right=hi_v) if axis == "x" else ax.set_ylim(top=hi_v)
        except (TypeError, ValueError):
            pass


def _apply_panel_y_limits(ax, settings, panel_key: str):
    """Per-panel y limits used by the stacked δ-vs-time view.

    `settings["yLimits"]` is a dict like {"delta": {"min": "...", "max": "..."}}.
    """
    yl = (settings.get("yLimits") or {}).get(panel_key) or {}
    lo = yl.get("min")
    hi = yl.get("max")
    try:
        if lo is not None and lo != "":
            ax.set_ylim(bottom=float(lo))
    except (TypeError, ValueError):
        pass
    try:
        if hi is not None and hi != "":
            ax.set_ylim(top=float(hi))
    except (TypeError, ValueError):
        pass


def _apply_scales(ax, settings):
    if settings.get("xScale") == "log":
        ax.set_xscale("log")
    if settings.get("yScale") == "log":
        ax.set_yscale("log")


def _apply_tick_format(ax, settings, axis: str, style: str | None = None):
    """Apply user choice of tick label format. 'auto' leaves the default in
    place; 'sci' forces scientific (useMathText); 'plain' forces plain.

    If `style` is None, falls back to settings[f"{axis}TickFormat"].
    """
    if style is None:
        style = settings.get(f"{axis}TickFormat", "auto")
    if style in ("auto", "", None):
        return
    # ticklabel_format raises on log scale; skip in that case.
    scale_name = (ax.get_xscale() if axis == "x" else ax.get_yscale())
    if scale_name != "linear":
        return
    try:
        if style == "sci":
            ax.ticklabel_format(
                axis=axis, style="sci",
                useMathText=True, scilimits=(0, 0),
            )
        elif style == "plain":
            ax.ticklabel_format(axis=axis, style="plain", useOffset=False)
    except Exception:
        # matplotlib may refuse on non-ScalarFormatter; ignore silently.
        pass


def _panel_y_tick_format(settings, panel_key: str):
    """Per-panel y tick format with fall-through to the global yTickFormat."""
    by = (settings.get("yTickFormats") or {})
    return by.get(panel_key) or settings.get("yTickFormat", "auto")


def _compute_cdf(centers, pdf):
    """Return CDF in percent (0–100) from a binned PDF and bin centers.

    Uses trapezoidal accumulation over the centres; normalises to the final
    integral so noisy tails still hit 100 % at the right edge.
    """
    centers = np.asarray(centers, dtype=float)
    pdf = np.asarray(pdf, dtype=float)
    if centers.size < 2:
        return None
    dx = np.diff(centers)
    inc = (pdf[:-1] + pdf[1:]) * 0.5 * dx
    cdf = np.concatenate([[0.0], np.cumsum(inc)])
    if cdf[-1] > 0:
        cdf = cdf / cdf[-1] * 100.0
    return cdf


_OUTSIDE_LEGEND = {
    # User-facing key → (matplotlib loc, bbox_to_anchor)
    "outside right":  ("center left",  (1.02, 0.5)),
    "outside left":   ("center right", (-0.02, 0.5)),
    "outside top":    ("lower center", (0.5, 1.02)),
    "outside bottom": ("upper center", (0.5, -0.18)),
}


def _apply_legend(ax, settings, default_loc="best"):
    if not settings.get("legendShow", True):
        return
    loc = settings.get("legendLoc", default_loc)
    if loc == "none":
        return
    kwargs = dict(
        frameon=bool(settings.get("legendFrame", True)),
        fontsize=settings.get("legendSize", 10),
        ncol=int(settings.get("legendNCol", 1) or 1),
    )
    if loc in _OUTSIDE_LEGEND:
        mpl_loc, anchor = _OUTSIDE_LEGEND[loc]
        kwargs["loc"] = mpl_loc
        kwargs["bbox_to_anchor"] = anchor
        kwargs["borderaxespad"] = 0.0
    else:
        kwargs["loc"] = loc
    leg = ax.legend(**kwargs)
    if leg and settings.get("legendFrame", True):
        leg.get_frame().set_edgecolor(settings.get("legendEdge", "#888888"))
        leg.get_frame().set_alpha(float(settings.get("legendAlpha", 0.9)))


# ── δ-distribution overlay (single point / selected rows) ──────────
def render_overplot(traces, settings) -> str:
    traces = list(traces)
    if not traces:
        return ""
    show_cdf = bool(settings.get("showCdf", False))

    # Pre-compute CDFs (needed for both the optional bottom subplot AND for
    # the per-trace overlap-penetration probability in the title).
    cdfs = []
    for t in traces:
        cdfs.append(_compute_cdf(t["centers"], t["pdf"]))

    with _styled(settings):
        figw = float(settings.get("width") or 7.0)
        figh = float(settings.get("height") or 4.2)
        dpi  = int(settings.get("dpi", 120))

        if show_cdf:
            fig, (ax, ax_cdf) = plt.subplots(
                2, 1, sharex=True,
                figsize=(figw, figh * 1.85),
                dpi=dpi,
                gridspec_kw={"height_ratios": [1.0, 0.85], "hspace": 0.10},
            )
        else:
            fig, ax = plt.subplots(figsize=(figw, figh), dpi=dpi)
            ax_cdf = None

        overrides = settings.get("colorOverrides") or {}
        line_w = float(settings.get("lineWidth", 1.2))
        nom_w  = float(settings.get("nomLineWidth", 2.0))
        sig_w  = float(settings.get("sigLineWidth", 1.2))
        fill_a = float(settings.get("fillOpacity", 0.20))
        sig_style = settings.get("sigLineStyle", "--")
        nom_style = settings.get("nomLineStyle", "-")
        normalize = bool(settings.get("normalizePdf", True))
        show_nom   = bool(settings.get("showNomLine", True))
        show_sigma = bool(settings.get("showSigmaLines", True))

        for i, t in enumerate(traces):
            color = _color_for(i, overrides)
            centers = np.asarray(t["centers"], dtype=float)
            pdf     = np.asarray(t["pdf"], dtype=float)
            if normalize and pdf.max() > 0:
                y = pdf / pdf.max()
            else:
                y = pdf
            label = t.get("label", f"trace {i+1}")

            ax.fill_between(centers, y, color=color, alpha=fill_a)
            ax.plot(centers, y, color=color, lw=line_w, label=label)
            if show_nom:
                ax.axvline(t["deltaNom"], color=color, lw=nom_w, ls=nom_style)
            if show_sigma:
                ax.axvline(t["psigL"], color=color, lw=sig_w, ls=sig_style)
                ax.axvline(t["psigU"], color=color, lw=sig_w, ls=sig_style)

            # CDF panel — same colour, lighter dashed for nominal line.
            if ax_cdf is not None and cdfs[i] is not None:
                ax_cdf.plot(centers, cdfs[i], color=color, lw=line_w, label=label)
                if show_nom:
                    ax_cdf.axvline(
                        t["deltaNom"], color=color, lw=nom_w, ls=nom_style, alpha=0.7,
                    )

        # Overlap reference line + per-trace penetration probability stats.
        ov = settings.get("overlap")
        ov_value = None
        ov_label = None
        if ov and ov.get("value") is not None:
            try:
                ov_value = float(ov["value"])
                ov_label = ov.get("label") or "Dominant mode overlap"
                ov_color = settings.get("overlapColor", "seagreen")
                ov_style = settings.get("overlapStyle", ":")
                ov_lw    = float(settings.get("overlapWidth", 1.6))
                ax.axvline(
                    ov_value, color=ov_color, ls=ov_style, lw=ov_lw,
                    label=f"{ov_label} ({ov_value:.2e})",
                )
                if ax_cdf is not None:
                    ax_cdf.axvline(ov_value, color=ov_color, ls=ov_style, lw=ov_lw)
            except (TypeError, ValueError):
                ov_value = None

        ax.set_ylabel(settings.get("yLabel") or "Probability density [a.u.]")
        if ax_cdf is None:
            ax.set_xlabel(settings.get("xLabel") or r"$\delta$ (Dominant EF / $B_T$)")
        else:
            ax_cdf.set_xlabel(settings.get("xLabel") or r"$\delta$ (Dominant EF / $B_T$)")
            ax_cdf.set_ylabel("Probability [%]")
            ax_cdf.set_ylim(0, 100)
            # Suppress x ticks on top panel — sharex still works.
            plt.setp(ax.get_xticklabels(), visible=False)

        title = settings.get("title")
        if title is None:
            parts = []
            for t in traces:
                m = t["deltaNom"] - t["psigL"]
                p = t["psigU"] - t["deltaNom"]
                parts.append(
                    f"{t.get('label','')}: δ_nom={t['deltaNom']:.2e} (−{m:.1e}/+{p:.1e})"
                )
            title = "\n".join(parts)
        if title:
            ax.set_title(title, fontsize=settings.get("titleSize", 13))

        _apply_scales(ax, settings)
        _apply_axis_limits(ax, settings, "x")
        _apply_panel_y_limits(ax, settings, "delta")
        _apply_axis_limits(ax, settings, "y")
        _apply_tick_format(ax, settings, "x")
        _apply_tick_format(ax, settings, "y", _panel_y_tick_format(settings, "delta"))
        _apply_legend(ax, settings)
        if ax_cdf is not None:
            _apply_tick_format(ax_cdf, settings, "x")

        return _fig_to_data_url(
            fig,
            int(settings.get("dpi", 120)),
            settings.get("format", "png"),
            tight=bool(settings.get("tightLayout", True)),
        )


# ── δ vs time, optionally with stacked subplots ────────────────────
PANEL_LABELS = {
    "delta":  (r"$\delta_\mathrm{nominal}$", None),
    "I_p":    (r"$|I_p|$", "MA"),
    "B_T":    (r"$|B_T|$", "T"),
    "n_e":    (r"$n_e$", r"$10^{19}\,\mathrm{m}^{-3}$"),
    "beta_n": (r"$\beta_n$", None),
    "l_i":    (r"$l_i$", None),
    "R_0":    (r"$R_0$", "m"),
    "bnli":   (r"$\beta_n / l_i$", None),
}


def render_delta_vs_time(rows, settings) -> str:
    rows = list(rows)
    if not rows:
        return ""
    if not all(r.get("time_ms") is not None for r in rows):
        raise ValueError("every row must have a finite time_ms for δ vs time")

    extras = list(settings.get("stack", []) or [])
    panels = [{"key": "delta"}] + [{"key": k} for k in extras]
    N = len(panels)

    # group by shot (None → "all")
    groups = {}
    for r in rows:
        key = r.get("shot") or "all"
        groups.setdefault(key, []).append(r)

    with _styled(settings):
        figw = float(settings.get("width") or 7.5)
        figh = float(settings.get("height") or max(3.4, 2.2 * N))
        fig, axes = plt.subplots(
            N, 1, sharex=True,
            figsize=(figw, figh),
            dpi=int(settings.get("dpi", 120)),
            gridspec_kw={"hspace": float(settings.get("stackHspace", 0.10))},
        )
        if N == 1:
            axes = [axes]

        overrides = settings.get("colorOverrides") or {}
        marker = settings.get("marker", "o")
        msize  = float(settings.get("markerSize", 5.5))
        line_w = float(settings.get("lineWidth", 1.4))
        fill_a = float(settings.get("fillOpacity", 0.20))
        show_nom   = bool(settings.get("showNomLine", True))
        show_sigma = bool(settings.get("showSigmaLines", True))

        for gi, (shot, rs) in enumerate(groups.items()):
            rs = sorted(rs, key=lambda r: r["time_ms"])
            ts = np.array([r["time_ms"] for r in rs], dtype=float)
            color = _color_for(gi, overrides)
            label = "δ_nominal" if shot == "all" else f"shot {shot}"

            for pi, panel in enumerate(panels):
                ax = axes[pi]
                key = panel["key"]
                if key == "delta":
                    nom = np.array([r["deltaNom"] for r in rs])
                    lo  = np.array([r["psigL"]    for r in rs])
                    hi  = np.array([r["psigU"]    for r in rs])
                    if show_sigma:
                        ax.fill_between(ts, lo, hi, color=color, alpha=fill_a)
                    if show_nom:
                        ax.plot(ts, nom, color=color, lw=line_w,
                                marker=marker, markersize=msize, label=label)
                    else:
                        # Keep an invisible artist so the legend still has an
                        # entry when the user hides the nominal line.
                        ax.plot([], [], color=color, lw=line_w,
                                marker=marker, markersize=msize, label=label)
                else:
                    vals = np.array([r.get(key, np.nan) for r in rs], dtype=float)
                    ax.plot(ts, vals, color=color, lw=line_w,
                            marker=marker, markersize=msize)

        # Overlap reference (on δ panel only)
        ov = settings.get("overlap")
        if ov and ov.get("value") is not None:
            try:
                yv = float(ov["value"])
                lbl = ov.get("label") or "Dominant mode overlap"
                axes[0].axhline(
                    yv,
                    color=settings.get("overlapColor", "seagreen"),
                    ls=settings.get("overlapStyle", ":"),
                    lw=float(settings.get("overlapWidth", 1.6)),
                    label=f"{lbl} ({yv:.2e})",
                )
            except (TypeError, ValueError):
                pass

        # Per-panel y labels, scales, and (per-panel) limits.
        for pi, panel in enumerate(panels):
            ax = axes[pi]
            key = panel["key"]
            label_tex, unit = PANEL_LABELS.get(key, (key, None))
            ylab = label_tex if not unit else f"{label_tex} ({unit})"
            ax.set_ylabel(ylab)
            if pi == 0 and settings.get("yScale") == "log":
                ax.set_yscale("log")
            _apply_panel_y_limits(ax, settings, key)

        axes[-1].set_xlabel(settings.get("xLabel") or "time (ms)")
        _apply_axis_limits(axes[-1], settings, "x")
        if settings.get("xScale") == "log":
            axes[-1].set_xscale("log")
        _apply_tick_format(axes[-1], settings, "x")
        for pi, panel in enumerate(panels):
            _apply_tick_format(
                axes[pi], settings, "y",
                _panel_y_tick_format(settings, panel["key"]),
            )
        # Line up the y-axis labels across all stacked subplots so they
        # don't drift in and out depending on tick-label width.
        try:
            fig.align_ylabels(list(axes))
        except Exception:
            pass

        title = settings.get("title")
        if title is None:
            title = (
                "Nominal δ vs time (±1σ band)"
                if N == 1
                else "Nominal δ vs time (±1σ band) — stacked subplots"
            )
        if title:
            fig.suptitle(title, fontsize=settings.get("titleSize", 13))

        _apply_legend(axes[0], settings)

        return _fig_to_data_url(
            fig,
            int(settings.get("dpi", 120)),
            settings.get("format", "png"),
            tight=bool(settings.get("tightLayout", True)),
        )
