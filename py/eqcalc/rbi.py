"""Módulo RBI por adelgazamiento generalizado – MODELO ACADÉMICO SIMPLIFICADO.

Referencias: API RP 580 (proceso RBI); API RP 581 (2016, con enmiendas hasta 2020), método cuantitativo:
  - Parte 2 §4.5.7  Factor de daño por adelgazamiento: Ec. (2.12)–(2.20)
  - Parte 2 Tabla 4.5 (probabilidades a priori) y Tabla 4.6 (probabilidades condicionales por eficacia)
  - Parte 2 Tabla 3.1 (frecuencias genéricas de falla), Ec. (2.9)–(2.10) (factor de sistemas de gestión)
  - Parte 1 Tabla 4.1M (categorías de probabilidad y de consecuencia, SI)

Simplificaciones declaradas:
  * un único mecanismo (adelgazamiento general, sin revestimiento ⇒ age_rc = 0; sin corrosión localizada);
  * velocidad de corrosión del material base = velocidad adoptada de las mediciones (no se estima por mecanismo);
  * las consecuencias (área CA [m²] y económica CE [moneda]) son DATOS DE ENTRADA, no se modela la liberación;
  * asignación de niveles de riesgo de la matriz 5×5 académica (no reproduce la figura oficial);
  * factores FOM, FIP, FDL, FWD, FAM, FSM por defecto = 1.
El factor de daño (Df) NO es una probabilidad: la frecuencia de falla es fF = gff_total · Df · F_MS [1/año].
Una inspección NO recupera espesor: sólo reduce la incertidumbre sobre la velocidad de corrosión
(actualización bayesiana de los estados de daño 1, 2 y 4 veces la velocidad estimada).
"""
from __future__ import annotations

import math

COV_DT, COV_SF, COV_P = 0.20, 0.20, 0.05          # API 581 §4.5.7 STEP 12
DS = (1.0, 2.0, 4.0)                              # factores de velocidad de los estados de daño 1, 2, 3
NORM_DF = 1.56e-4                                 # Ec. (2.19)

PRIOR = {  # Tabla 4.5
    "baja": (0.5, 0.3, 0.2),
    "media": (0.7, 0.2, 0.1),
    "alta": (0.8, 0.15, 0.05),
}
CONDICIONAL = {  # Tabla 4.6: (Co1, Co2, Co3) por eficacia de inspección
    "E": (0.33, 0.33, 0.33),   # nula o ineficaz
    "D": (0.40, 0.33, 0.27),   # poco eficaz
    "C": (0.50, 0.30, 0.20),   # medianamente eficaz
    "B": (0.70, 0.20, 0.10),   # normalmente eficaz
    "A": (0.90, 0.09, 0.01),   # altamente eficaz
}
GFF_TOTAL = {  # Tabla 3.1 [fallas/año]
    "tuberia": 3.06e-5,        # PIPE-8 y mayores (para ≤6 in también 3.06e-5 en total)
    "recipiente": 3.06e-5,     # DRUM, COLBTM, FILTER, REACTOR...
    "tanque": 1.00e-4,         # Tank650, COURSE-1-10
}
# Tabla 4.1M
CAT_PROB_LIMITES = (1.0, 10.0, 100.0, 1000.0)          # Df_total: ≤1, ≤10, ≤100, ≤1000, >1000
CAT_CONS_LIMITES_M2 = (9.29, 92.9, 929.0, 9290.0)     # A..E
NIVELES_RIESGO = ("Bajo", "Medio", "Medio-Alto", "Alto")
# Matriz académica 5×5: fila = categoría de probabilidad 5..1, columnas A..E
MATRIZ = {
    5: ("Medio-Alto", "Medio-Alto", "Alto", "Alto", "Alto"),
    4: ("Medio", "Medio-Alto", "Medio-Alto", "Alto", "Alto"),
    3: ("Medio", "Medio", "Medio-Alto", "Medio-Alto", "Alto"),
    2: ("Bajo", "Medio", "Medio", "Medio-Alto", "Medio-Alto"),
    1: ("Bajo", "Bajo", "Medio", "Medio", "Medio-Alto"),
}


def norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def flow_stress(YS: float, TS: float, E: float) -> float:
    """Ec. (2.13): FS = (YS + TS)/2 · E · 1,1  [MPa]."""
    return (YS + TS) / 2.0 * E * 1.1


def art_parameter(cr: float, age_tk: float, t_rdi: float, age_rc: float = 0.0) -> float:
    """Ec. (2.12): Art = máx[ Cr·(age_tk − age_rc)/t_rdi , 0 ]."""
    return max(cr * (age_tk - age_rc) / t_rdi, 0.0)


def strength_ratio(S: float, E: float, FS: float, t_min: float, t_rdi: float) -> float:
    """Ec. (2.14): SR_p = (S·E/FS) · máx(t_min, t_c)/t_rdi."""
    return (S * E / FS) * t_min / t_rdi


def count_inspections(eficacias: list[str]) -> dict:
    cuenta = {k: 0 for k in "ABCDE"}
    for e in eficacias:
        if e in cuenta:
            cuenta[e] += 1
    return cuenta


def posterior(confianza: str, cuenta: dict) -> tuple[float, float, float]:
    """Ec. (2.16)–(2.17): I_i = Pr_i·ΠCo_i^N ; Po_i = I_i/ΣI."""
    pri = PRIOR[confianza]
    I = []
    for i in range(3):
        v = pri[i]
        for eff, n in cuenta.items():
            if n:
                v *= CONDICIONAL[eff][i] ** n
        I.append(v)
    s = sum(I)
    return tuple(x / s for x in I)


def damage_factor_base(art: float, sr: float, po: tuple) -> dict:
    """Ec. (2.18)–(2.19): β_i y Df_B."""
    betas, phis = [], []
    for D in DS:
        num = 1.0 - D * art - sr
        den = math.sqrt((D * art * COV_DT) ** 2 + ((1.0 - D * art) * COV_SF) ** 2 + (sr * COV_P) ** 2)
        b = num / den
        betas.append(b)
        phis.append(norm_cdf(-b))
    dfb = sum(p * f for p, f in zip(po, phis)) / NORM_DF
    return {"beta": betas, "phi": phis, "df_base": dfb}


def thinning_df(cr: float, age_tk: float, t_rdi: float, t_min: float, S: float, E: float, YS: float, TS: float,
                confianza: str, eficacias: list[str], fom: float = 1.0, fip: float = 1.0, fdl: float = 1.0,
                fwd: float = 1.0, fam: float = 1.0, fsm: float = 1.0) -> dict:
    """Factor de daño por adelgazamiento, Ec. (2.20): Df = máx[ DfB·FIP·FDL·FWD·FAM·FSM / FOM ; 0,1 ]."""
    if t_rdi <= 0 or t_min <= 0:
        raise ValueError("Espesores deben ser > 0.")
    FS = flow_stress(YS, TS, E)
    art = art_parameter(cr, age_tk, t_rdi)
    sr = strength_ratio(S, E, FS, t_min, t_rdi)
    cuenta = count_inspections(eficacias)
    po = posterior(confianza, cuenta)
    base = damage_factor_base(art, sr, po)
    df = max(base["df_base"] * fip * fdl * fwd * fam * fsm / fom, 0.1)
    return {"FS": FS, "art": art, "sr": sr, "inspecciones": cuenta, "po": po, **base, "df": df}


def management_factor(score_pct: float) -> float:
    """Ec. (2.10): F_MS = 10^(−0,02·pscore + 1); pscore = 50 % ⇒ F_MS = 1,0."""
    return 10.0 ** (-0.02 * score_pct + 1.0)


def prob_category(df_total: float) -> int:
    for i, lim in enumerate(CAT_PROB_LIMITES, start=1):
        if df_total <= lim:
            return i
    return 5


def cons_category(ca_m2: float) -> str:
    for letra, lim in zip("ABCD", CAT_CONS_LIMITES_M2):
        if ca_m2 <= lim:
            return letra
    return "E"


def risk_level(cat_p: int, cat_c: str) -> str:
    return MATRIZ[cat_p]["ABCDE".index(cat_c)]


def rbi_case(familia: str, cr: float, age_tk: float, t_rdi: float, t_min: float, S: float, E: float,
             YS: float, TS: float, ca_m2: float, ce: float, confianza: str, eficacias: list[str],
             score_gestion: float = 50.0, gff: float | None = None, **ajustes) -> dict:
    """Caso RBI completo: Df, fF, RA = fF·CA [m²/año], RE = fF·CE [moneda/año], categoría y nivel de riesgo."""
    d = thinning_df(cr, age_tk, t_rdi, t_min, S, E, YS, TS, confianza, eficacias, **ajustes)
    g = GFF_TOTAL[familia] if gff is None else gff
    fms = management_factor(score_gestion)
    ff = g * d["df"] * fms
    cp, cc = prob_category(d["df"]), cons_category(ca_m2)
    return {**d, "gff": g, "fms": fms, "ff": ff, "ra": ff * ca_m2, "re": ff * ce,
            "cat_prob": cp, "cat_cons": cc, "nivel": risk_level(cp, cc)}


def what_if_inspection(base_args: dict, eficacias: list[str]) -> list[dict]:
    """Efecto de UNA inspección adicional de cada eficacia sobre Df (no cambia el espesor medido)."""
    res = []
    for eff in "EDCBA":
        c = rbi_case(**base_args, eficacias=eficacias + [eff])
        res.append({"eficacia": eff, "df": c["df"], "ff": c["ff"], "ra": c["ra"], "re": c["re"], "nivel": c["nivel"]})
    return res
