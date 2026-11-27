"""Mediciones, velocidad de corrosión y vida remanente (enunciado 4.4)."""
from __future__ import annotations

from datetime import date
from math import isfinite

DIAS_ANIO = 365.25
EVENTOS_REINICIO = ("reparacion", "reemplazo", "cambio_punto")  # rompen la comparabilidad de la serie


def parse_date(s) -> date:
    if isinstance(s, date):
        return s
    return date.fromisoformat(str(s)[:10])


def years_between(d0: date, d1: date) -> float:
    return (d1 - d0).days / DIAS_ANIO


def clean_series(lecturas: list[dict], corte=None) -> tuple[list[dict], list[str]]:
    """Ordena por fecha, descarta duplicados/inconsistencias y devuelve advertencias."""
    avisos: list[str] = []
    validas = []
    for r in lecturas:
        try:
            fecha = date.fromisoformat(r["fecha"])
        except (KeyError, ValueError, TypeError):
            avisos.append("Fecha inválida: lectura excluida del cálculo.")
            continue
        if corte and fecha > corte:
            avisos.append(f"{fecha}: posterior al corte de evaluación.")
            continue
        espesor = r.get("espesor")
        if not isinstance(espesor, (float, int)) or not isfinite(espesor) or espesor <= 0 or r.get("unidad", "mm") != "mm":
            avisos.append(f"{fecha}: espesor no positivo, inválido o unidad distinta de mm.")
            continue
        validas.append(r)
    orden = sorted(validas, key=lambda r: r["fecha"])
    limpia: list[dict] = []
    for r in orden:
        if r["espesor"] is None or r["espesor"] <= 0:
            avisos.append(f"Lectura del {r['fecha']} descartada: espesor no positivo.")
            continue
        if limpia and parse_date(r["fecha"]) <= parse_date(limpia[-1]["fecha"]):
            avisos.append(f"Fecha inconsistente/duplicada ({r['fecha']}): lectura descartada del cálculo.")
            continue
        limpia.append(r)
    return limpia, avisos


def comparable_segment(serie: list[dict]) -> tuple[list[dict], list[str]]:
    """Segmento comparable: desde el último evento de reinicio (reparación, reemplazo, cambio de punto)."""
    avisos: list[str] = []
    inicio = 0
    for i, r in enumerate(serie):
        if r.get("evento") in EVENTOS_REINICIO:
            inicio = i
            avisos.append(f"{r['fecha']}: {r['evento'].replace('_', ' ')}; la serie comparable se reinicia en esa lectura.")
    return serie[inicio:], avisos


def corrosion_rates(segmento: list[dict]) -> dict:
    """Velocidades de corrosión [mm/año]: corto plazo (2 últimas), largo plazo (primera→última) y adoptada.

    Criterio de adopción: la MAYOR de ambas (conservador); si ninguna es positiva → 0 (velocidad nula).
    """
    n = len(segmento)
    res = {"n": n, "cr_corto": None, "cr_largo": None, "cr_adoptada": None, "criterio": "", "avisos": []}
    if n < 2:
        res["criterio"] = "Datos insuficientes: se requieren ≥ 2 lecturas comparables."
        return res
    ult, pen, pri = segmento[-1], segmento[-2], segmento[0]
    ya = years_between(parse_date(pen["fecha"]), parse_date(ult["fecha"]))
    yl = years_between(parse_date(pri["fecha"]), parse_date(ult["fecha"]))
    res["cr_corto"] = (pen["espesor"] - ult["espesor"]) / ya
    res["cr_largo"] = (pri["espesor"] - ult["espesor"]) / yl
    cand = [c for c in (res["cr_corto"], res["cr_largo"]) if c is not None]
    mayor = max(cand)
    if mayor <= 1e-9:
        res["cr_adoptada"] = 0.0
        res["criterio"] = "Velocidad nula o negativa (el espesor no disminuye): se adopta CR = 0; la VR no es evaluable con esta tendencia; verificar comparabilidad."
        if min(cand) < -0.05:
            res["avisos"].append("Aumento de espesor entre campañas: revisar error de medición, cambio de punto o reparación no registrada.")
    else:
        res["cr_adoptada"] = mayor
        gob = "corto plazo" if res["cr_corto"] >= res["cr_largo"] else "largo plazo"
        res["criterio"] = f"Se adopta la mayor entre corto y largo plazo (conservador): {gob}."
        if res["cr_corto"] is not None and res["cr_largo"] > 0 and res["cr_corto"] > 2 * res["cr_largo"]:
            res["avisos"].append("La velocidad de corto plazo duplica la de largo plazo: posible aceleración del daño.")
    return res


def remaining_life(t_med: float, t_adm: float, cr: float | None) -> float | None:
    """VR = (t_med − t_adm)/CR [años]. 0 si ya está bajo el mínimo; None si CR ≤ 0 o desconocida."""
    margen = t_med - t_adm
    if margen <= 0:
        return 0.0
    if cr is None or cr <= 1e-9:
        return None
    return margen / cr


def alert_thickness(t_adm: float, cr: float | None, plazo: float) -> float:
    """t_alerta = t_adm + CR·plazo de intervención (si CR desconocida: sólo t_adm)."""
    return t_adm + (cr or 0.0) * plazo


def analyze_tml(lecturas: list[dict], t_adm: float, plazo: float, corte=None) -> dict:
    serie, avisos = clean_series(lecturas, corte)
    seg, av2 = comparable_segment(serie)
    avisos += av2
    cr = corrosion_rates(seg)
    avisos += cr["avisos"]
    out = {"serie_comparable": [{"fecha": r["fecha"], "espesor": r["espesor"]} for r in seg], "n_lecturas": len(serie), "avisos": avisos, **{k: cr[k] for k in ("cr_corto", "cr_largo", "cr_adoptada", "criterio")},
           "n_comparables": cr["n"], "t_med": None, "fecha_ult": None, "vr": None, "t_alerta": None, "bajo_minimo": False,
           "suficiente": cr["cr_adoptada"] is not None}
    if serie:
        ult = serie[-1]
        out["t_med"] = ult["espesor"]
        out["fecha_ult"] = ult["fecha"]
        out["bajo_minimo"] = ult["espesor"] <= t_adm
        out["vr"] = remaining_life(ult["espesor"], t_adm, cr["cr_adoptada"]) if out["suficiente"] or out["bajo_minimo"] else None
        out["t_alerta"] = alert_thickness(t_adm, cr["cr_adoptada"], plazo)
        if out["bajo_minimo"]:
            avisos.append(f"Espesor medido {ult['espesor']:.2f} mm ≤ mínimo admisible {t_adm:.2f} mm.")
    return out
