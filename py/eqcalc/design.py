"""Espesores de diseño y de evaluación por familia.

Distinción de espesores (enunciado 4.2):
  nominal        t_nom   espesor de la placa/tubo instalado (dato).
  requerido      t_req   espesor mínimo por cálculo de presión/carga, SIN sobreespesor por corrosión.
  diseño         t_dis = t_req + CA      (CA = sobreespesor por corrosión).
  mínimo admisible en servicio t_adm = máx(t_req, t_estructural)  → "espesor de retiro".
  medido         t_med   lectura UT.
  de alerta      t_alt = t_adm + CR·plazo   (margen por pérdida prevista en el plazo de intervención).
La tolerancia de fabricación (p. ej. 12,5 % en tubería, B31.3) sólo afecta el pedido de material:
t_pedido = t_dis / (1 − tol); NO reduce el espesor requerido en servicio.
"""
from __future__ import annotations

from .materials import allowable_stress, get_material, MaterialError

T_ESTRUCTURAL_TANQUE = 2.5  # mm (0,10 in), API 653 §4.3.3.1


class DesignError(ValueError):
    pass


def _e(nombre, valor, unidad, nota=""):
    return {"nombre": nombre, "valor": valor, "unidad": unidad, "nota": nota}


def pipe_b313(P, D, material, T, E=None, CA=0.0, tol_fabricacion=12.5, t_estructural=0.0, Y=0.4, W=1.0):
    """Tubería recta bajo presión interna. ASME B31.3 §304.1.2 Ec. (3a): t = P·D / [2(S·E·W + P·Y)]."""
    if P <= 0 or D <= 0:
        raise DesignError("P y D deben ser > 0.")
    mat = get_material(material)
    S = allowable_stress(material, T)
    E = mat["E_defecto"] if E is None else E
    if not (0 < E <= 1):
        raise DesignError("El factor de calidad E debe cumplir 0 < E ≤ 1.")
    t = P * D / (2.0 * (S * E * W + P * Y))
    t_adm = max(t, t_estructural)
    t_dis = t + CA
    return {
        "familia": "tuberia", "norma_diseno": "ASME B31.3 §304.1.2 Ec. (3a)", "norma_servicio": "API 570",
        "ecuacion": "t = P·D / [2·(S·E·W + P·Y)]",
        "entradas": [_e("P", P, "MPa"), _e("D (exterior)", D, "mm"), _e("S a T", round(S, 2), "MPa", f"{material} a {T:g} °C"),
                     _e("E (calidad)", E, "-"), _e("W (junta)", W, "-", "T < 510 °C"), _e("Y", Y, "-", "ferrítico ≤ 482 °C")],
        "t_req": t, "t_estructural": t_estructural, "t_adm": t_adm, "t_dis": t_dis,
        "t_pedido": t_dis / (1 - tol_fabricacion / 100.0), "tol_fabricacion_pct": tol_fabricacion,
        "S": S, "E": E, "CA": CA,
        "notas": [f"t_req = {t:.3f} mm (sin CA). Espesor de diseño = t_req + CA = {t_dis:.3f} mm.",
                  f"Con tolerancia de fabricación {tol_fabricacion:g} %: pedido mínimo = {t_dis / (1 - tol_fabricacion / 100.0):.3f} mm."],
    }


def vessel_uG27(P, Di, material, T, E=None, CA=0.0, tol_fabricacion=0.0, t_estructural=0.0):
    """Envolvente cilíndrica, presión interna. ASME VIII-1 UG-27(c)(1): t = P·R / (S·E − 0.6·P).

    R = radio interior en condición corroída = Di/2 + CA.
    """
    if P <= 0 or Di <= 0:
        raise DesignError("P y Di deben ser > 0.")
    mat = get_material(material)
    S = allowable_stress(material, T)
    E = mat["E_defecto"] if E is None else E
    if not (0 < E <= 1):
        raise DesignError("La eficiencia de junta E debe cumplir 0 < E ≤ 1.")
    R = Di / 2.0 + CA
    den = S * E - 0.6 * P
    if den <= 0:
        raise DesignError("S·E − 0.6·P ≤ 0: fuera del alcance de UG-27(c)(1).")
    t = P * R / den
    notas = [f"R corroído = Di/2 + CA = {R:.2f} mm.",
             f"t_req = {t:.3f} mm (sin CA). Espesor de diseño = t_req + CA = {t + CA:.3f} mm."]
    if t > R / 2.0 or P > 0.385 * S * E:
        notas.append("ADVERTENCIA: se excede t ≤ R/2 o P ≤ 0,385·S·E; UG-27(c)(1) deja de ser aplicable (usar Apéndice 1-2).")
    t_adm = max(t, t_estructural)
    return {
        "familia": "recipiente", "norma_diseno": "ASME VIII Div.1 UG-27(c)(1)", "norma_servicio": "API 510",
        "ecuacion": "t = P·R / (S·E − 0,6·P)",
        "entradas": [_e("P", P, "MPa"), _e("Di", Di, "mm"), _e("R corroído", round(R, 3), "mm", "Di/2 + CA"),
                     _e("S a T", round(S, 2), "MPa", f"{material} a {T:g} °C (ASME II-D)"), _e("E", E, "-")],
        "t_req": t, "t_estructural": t_estructural, "t_adm": t_adm, "t_dis": t + CA,
        "t_pedido": (t + CA) / (1 - tol_fabricacion / 100.0), "tol_fabricacion_pct": tol_fabricacion,
        "S": S, "E": E, "CA": CA, "notas": notas,
    }


def tank_shell_course(D, H, G, material, E=None, CA=0.0, curso=1, es_curso_inferior=None, tol_fabricacion=0.0):
    """Virola del manto de un tanque atmosférico (método de un pie).

    Diseño API 650 §5.6.3.2:   t_d = 4,9·D·(H−0,3)·G / S_d + CA      (prueba: t_t = 4,9·D·(H−0,3) / S_t)
    En servicio API 653 §4.3.3.1: t_min = 4,9·D·(H−0,3)·G / (S·E), con
        S = mín(0,80·Y ; 0,426·T)  para 1.ª y 2.ª virola,
        S = mín(0,88·Y ; 0,472·T)  para las demás;  t_min ≥ 2,5 mm.
    D [m], H [m] = altura de líquido sobre el fondo de la virola, G = densidad relativa.
    """
    if D <= 0 or G <= 0:
        raise DesignError("D y G deben ser > 0.")
    mat = get_material(material)
    if mat["familia"] != "tanque":
        raise DesignError(f"{material} no es un material de tanque del catálogo.")
    E = mat["E_defecto"] if E is None else E
    if not (0 < E <= 1):
        raise DesignError("La eficiencia de junta E debe cumplir 0 < E ≤ 1.")
    inferior = (curso <= 2) if es_curso_inferior is None else es_curso_inferior
    Y, T = mat["YS"], mat["TS"]
    S653 = min(0.80 * Y, 0.426 * T) if inferior else min(0.88 * Y, 0.472 * T)
    Hn = max(H - 0.3, 0.0)
    base = 4.9 * D * Hn
    t_d = base * G / mat["Sd"]
    t_t = base / mat["St"]
    t_653 = base * G / (S653 * E)
    t_req = max(t_653, T_ESTRUCTURAL_TANQUE)
    return {
        "familia": "tanque", "norma_diseno": "API 650 §5.6.3.2 (método de un pie)", "norma_servicio": "API 653 §4.3.3.1",
        "ecuacion": "t_min = 4,9·D·(H−0,3)·G / (S·E)",
        "entradas": [_e("D", D, "m"), _e("H (nivel sobre la virola)", round(H, 3), "m"), _e("G", G, "-"),
                     _e("S (API 653)", round(S653, 2), "MPa", "mín(0,80·Y;0,426·T)" if inferior else "mín(0,88·Y;0,472·T)"),
                     _e("E", E, "-"), _e("Virola", curso, "-")],
        "t_req": t_req, "t_req_calculado": t_653, "t_estructural": T_ESTRUCTURAL_TANQUE, "t_adm": t_req,
        "t_dis_api650": t_d + CA, "t_prueba_api650": t_t, "t_dis": t_d + CA,
        "t_pedido": (t_d + CA) / (1 - tol_fabricacion / 100.0) if tol_fabricacion else t_d + CA,
        "tol_fabricacion_pct": tol_fabricacion, "S": S653, "E": E, "CA": CA,
        "notas": [f"t_min (API 653) = {t_653:.3f} mm; mínimo estructural {T_ESTRUCTURAL_TANQUE} mm → t_adm = {t_req:.3f} mm.",
                  f"Diseño API 650: t_d = {t_d:.3f} + CA = {t_d + CA:.3f} mm; prueba hidrostática: t_t = {t_t:.3f} mm."],
    }


def required_thickness(eq: dict, curso: int | None = None) -> dict:
    """Despacha el cálculo según la familia del equipo (dict del modelo de datos)."""
    fam = eq["familia"]
    T = eq["temp_diseno"]
    mat = get_material(eq["material"])
    if fam != mat["familia"] or not mat["T_min"] <= T <= mat["T_max"]:
        raise DesignError("Material o temperatura fuera del catálogo de la familia.")
    if eq.get("ca", 0) < 0 or not 0 <= eq.get("tol_fabricacion", 0) < 100:
        raise DesignError("CA debe ser no negativa y la tolerancia debe estar entre 0 y menos de 100 %.")
    if fam == "tuberia":
        return pipe_b313(eq["p_diseno"], eq["diametro_ext"], eq["material"], T, eq.get("e_junta"),
                         eq.get("ca", 0.0), eq.get("tol_fabricacion", 12.5), eq.get("t_estructural", 0.0))
    if fam == "recipiente":
        return vessel_uG27(eq["p_diseno"], eq["diametro_int"], eq["material"], T, eq.get("e_junta"),
                           eq.get("ca", 0.0), eq.get("tol_fabricacion", 0.0), eq.get("t_estructural", 0.0))
    if fam == "tanque":
        cursos = eq.get("cursos") or []
        c = next((x for x in cursos if x["n"] == (curso or 1)), None)
        if c is None:
            raise DesignError(f"El tanque {eq.get('tag')} no tiene la virola {curso}.")
        H = eq["nivel_diseno"] - c["h_base"]
        return tank_shell_course(eq["diametro"], H, eq["g_esp"], eq["material"], eq.get("e_junta"),
                                 eq.get("ca", 0.0), c["n"], None, eq.get("tol_fabricacion", 0.0))
    raise DesignError(f"Familia desconocida: {fam}")
