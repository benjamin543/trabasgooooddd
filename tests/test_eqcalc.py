"""Pruebas del núcleo de cálculo. Ejecutar:  python -m pytest -q   (desde la raíz del repo)."""
import json
import math
import os
import sys
from datetime import date
from statistics import NormalDist

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py"))

from eqcalc import corrosion as cor          # noqa: E402
from eqcalc import design as dsg             # noqa: E402
from eqcalc import inspection as ins         # noqa: E402
from eqcalc import rbi as rb                 # noqa: E402
from eqcalc.engine import evaluate_project   # noqa: E402
from eqcalc.materials import MaterialError, allowable_stress  # noqa: E402
from eqcalc.verification import run_verification  # noqa: E402

DEMO = os.path.join(os.path.dirname(__file__), "..", "data", "demo.json")
N = NormalDist()


# ------------------------------------------------------------------ materiales
def test_esfuerzo_admisible_interpola_y_limita():
    assert allowable_stress("A106-B", 200) == pytest.approx(138.0)
    assert allowable_stress("A106-B", 357) == pytest.approx(116.6)
    with pytest.raises(MaterialError):
        allowable_stress("A106-B", 450)       # fuera del intervalo declarado: no extrapola
    with pytest.raises(MaterialError):
        allowable_stress("INEXISTENTE", 100)


# ------------------------------------------------------------------ diseño
def test_tuberia_b313_caso_a_mano():
    r = dsg.pipe_b313(6.0, 219.1, "A106-B", 200, 1.0, 1.5)
    assert r["t_req"] == pytest.approx(6.0 * 219.1 / (2 * (138 + 6.0 * 0.4)))
    assert r["t_req"] == pytest.approx(4.68162, abs=1e-4)
    assert r["t_dis"] == pytest.approx(r["t_req"] + 1.5)
    assert r["t_pedido"] == pytest.approx((r["t_req"] + 1.5) / 0.875)   # tolerancia 12,5 %


def test_recipiente_ug27_caso_a_mano():
    r = dsg.vessel_uG27(1.2, 1800, "SA-516-70", 150, 0.85, 3.0)
    assert r["t_req"] == pytest.approx(1.2 * 903 / (137.9 * 0.85 - 0.72))
    assert r["t_req"] == pytest.approx(9.30169, abs=1e-4)


def test_recipiente_presion_excesiva():
    with pytest.raises(dsg.DesignError):
        dsg.vessel_uG27(200.0, 1800, "SA-516-70", 150, 0.85, 3.0)


def test_tanque_api653_primera_virola():
    r = dsg.tank_shell_course(20.0, 12.0, 0.85, "A36", 0.85, 0.0, 1)
    assert r["S"] == pytest.approx(170.4)
    assert r["t_req_calculado"] == pytest.approx(6.72887, abs=1e-4)
    r3 = dsg.tank_shell_course(20.0, 4.8, 0.85, "A36", 0.85, 0.0, 3)
    assert r3["S"] == pytest.approx(188.8)           # virolas superiores: mín(0,88·Y; 0,472·T)
    top = dsg.tank_shell_course(20.0, 0.2, 0.85, "A36", 0.85, 0.0, 5)
    assert top["t_adm"] == pytest.approx(2.5)        # mínimo estructural 2,5 mm


def test_efecto_variable_de_diseno_sobre_espesor():
    base = dsg.pipe_b313(6.0, 219.1, "A106-B", 200, 1.0)["t_req"]
    mas_p = dsg.pipe_b313(7.0, 219.1, "A106-B", 200, 1.0)["t_req"]
    mas_T = dsg.pipe_b313(6.0, 219.1, "A106-B", 380, 1.0)["t_req"]   # S baja con T
    assert mas_p > base and mas_T > base


# ------------------------------------------------------------------ corrosión / vida
def lect(f, e, ev=""):
    return {"fecha": f, "espesor": e, "evento": ev}


def test_cr_vr_caso_a_mano():
    r = cor.analyze_tml([lect("2018-01-01", 10.0), lect("2022-01-01", 8.0)], 5.0, 2.0)
    assert r["cr_adoptada"] == pytest.approx(0.5, abs=1e-3)
    assert r["vr"] == pytest.approx(6.0, abs=1e-2)
    assert r["t_alerta"] == pytest.approx(5.0 + 0.5 * 2.0, abs=1e-3)


def test_datos_insuficientes():
    r = cor.analyze_tml([lect("2024-01-01", 9.0)], 5.0, 2.0)
    assert not r["suficiente"] and r["vr"] is None and r["cr_adoptada"] is None


def test_fechas_inconsistentes_se_descartan():
    r = cor.analyze_tml([lect("2020-01-01", 10.0), lect("2020-01-01", 9.9), lect("2022-01-01", 9.0)], 5.0, 2.0)
    assert any("inconsistente" in a.lower() for a in r["avisos"])
    assert r["n_lecturas"] == 2


def test_velocidad_nula_y_negativa():
    r = cor.analyze_tml([lect("2020-01-01", 10.0), lect("2024-01-01", 10.0)], 5.0, 2.0)
    assert r["cr_adoptada"] == 0.0 and r["vr"] is None
    r2 = cor.analyze_tml([lect("2020-01-01", 9.0), lect("2024-01-01", 10.0)], 5.0, 2.0)
    assert r2["cr_adoptada"] == 0.0 and any("aumento" in a.lower() for a in r2["avisos"])


def test_reemplazo_reinicia_serie_comparable():
    r = cor.analyze_tml([lect("2016-01-01", 9.0), lect("2020-01-01", 6.0), lect("2021-01-01", 12.0, "reemplazo"),
                         lect("2025-01-01", 11.2)], 5.0, 2.0)
    assert r["n_comparables"] == 2
    assert r["cr_adoptada"] == pytest.approx(0.8 / 4.0, abs=1e-3)   # sólo la serie posterior al reemplazo


def test_bajo_minimo():
    r = cor.analyze_tml([lect("2020-01-01", 6.0), lect("2024-01-01", 4.9)], 5.0, 2.0)
    assert r["bajo_minimo"] and r["vr"] == 0.0


# ------------------------------------------------------------------ inspección
def test_api510_regla_vida_media():
    hoy = date(2026, 1, 1)
    r = ins.next_inspection("recipiente", None, 12.0, True, "2025-01-01", hoy)
    assert r["intervalo_anios"] == pytest.approx(6.0)
    r = ins.next_inspection("recipiente", None, 40.0, True, "2025-01-01", hoy)
    assert r["intervalo_anios"] == pytest.approx(10.0)          # tope API 510
    r = ins.next_inspection("recipiente", None, 3.0, True, "2025-01-01", hoy)
    assert r["intervalo_anios"] == pytest.approx(2.0)           # VR < 4 a: máx. 2 años


def test_api570_clase():
    hoy = date(2026, 1, 1)
    assert ins.next_inspection("tuberia", 1, 40.0, True, "2025-01-01", hoy)["intervalo_anios"] == pytest.approx(5.0)
    assert ins.next_inspection("tuberia", "inyeccion", 40.0, True, "2025-01-01", hoy)["intervalo_anios"] == pytest.approx(3.0)


def test_api653_tanque():
    hoy = date(2026, 1, 1)
    assert ins.next_inspection("tanque", None, 40.0, True, "2025-01-01", hoy)["intervalo_anios"] == pytest.approx(15.0)
    assert ins.next_inspection("tanque", None, None, False, "2025-01-01", hoy)["intervalo_anios"] == pytest.approx(5.0)


def test_vencida_y_clasificacion():
    r = ins.next_inspection("recipiente", None, 4.0, True, "2020-01-01", date(2026, 1, 1))
    assert r["vencida"]
    assert ins.classify(True, True, True, False) == "bajo_minimo"
    assert ins.classify(False, True, True, True) == "vencida"
    assert ins.classify(False, False, True, True) == "alerta"
    assert ins.classify(False, False, False, False) == "info_insuficiente"
    assert ins.classify(False, False, False, True) == "normal"


# ------------------------------------------------------------------ RBI (cálculo independiente con NormalDist)
def df_independiente(cr, age, t, tmin, S, E, YS, TS, pri, co):
    FS = (YS + TS) / 2 * E * 1.1
    art = cr * age / t
    sr = (S * E / FS) * tmin / t
    I = [p * c for p, c in zip(pri, co)]
    po = [x / sum(I) for x in I]
    tot = 0.0
    for p, D in zip(po, (1, 2, 4)):
        beta = (1 - D * art - sr) / math.sqrt((D * art * .2) ** 2 + ((1 - D * art) * .2) ** 2 + (sr * .05) ** 2)
        tot += p * N.cdf(-beta)
    return tot / 1.56e-4


def test_rbi_df_coincide_con_calculo_independiente():
    esperado = df_independiente(0.4, 5.0, 10.0, 6.0, 137.9, 0.85, 260, 485, (0.7, 0.2, 0.1), (0.5, 0.3, 0.2))
    assert esperado == pytest.approx(153.8712, abs=1e-3)
    c = rb.rbi_case("recipiente", 0.4, 5.0, 10.0, 6.0, 137.9, 0.85, 260.0, 485.0, 350.0, 900000.0, "media", ["C"])
    assert c["df"] == pytest.approx(esperado, rel=1e-9)
    assert c["ff"] == pytest.approx(3.06e-5 * esperado, rel=1e-9)
    assert c["ra"] == pytest.approx(c["ff"] * 350.0) and c["re"] == pytest.approx(c["ff"] * 900000.0)


def test_rbi_df_crece_con_la_edad_y_baja_con_inspeccion():
    args = dict(familia="recipiente", cr=0.4, t_rdi=10.0, t_min=6.0, S=137.9, E=0.85, YS=260.0, TS=485.0,
                ca_m2=100.0, ce=1e5, confianza="media")
    d = [rb.rbi_case(**args, age_tk=a, eficacias=["C"])["df"] for a in (0, 2, 4, 6)]
    assert d == sorted(d)
    sin_insp = rb.rbi_case(**args, age_tk=5, eficacias=[])["df"]
    con_A = rb.rbi_case(**args, age_tk=5, eficacias=["A"])["df"]
    con_E = rb.rbi_case(**args, age_tk=5, eficacias=["E"])["df"]
    assert con_A < con_E <= sin_insp * 1.0000001 or con_A < sin_insp   # una inspección eficaz reduce Df
    assert con_A < sin_insp


def test_rbi_inspeccion_no_recupera_espesor():
    args = dict(familia="recipiente", cr=0.4, age_tk=5, t_rdi=10.0, t_min=6.0, S=137.9, E=0.85, YS=260.0, TS=485.0,
                ca_m2=100.0, ce=1e5, confianza="media")
    c = rb.rbi_case(**args, eficacias=["A", "A"])
    assert c["art"] == pytest.approx(0.2) and c["sr"] == pytest.approx(0.2019, abs=1e-4)  # no cambian con la inspección


def test_rbi_categorias_y_matriz():
    assert [rb.prob_category(x) for x in (0.5, 1.0, 5, 10.1, 100, 500, 1500)] == [1, 1, 2, 3, 3, 4, 5]
    assert [rb.cons_category(x) for x in (5, 9.29, 50, 500, 5000, 20000)] == ["A", "A", "B", "C", "D", "E"]
    assert rb.risk_level(5, "E") == "Alto" and rb.risk_level(1, "A") == "Bajo"
    assert rb.management_factor(50.0) == pytest.approx(1.0)


def test_rbi_area_y_economico_por_separado():
    c = rb.rbi_case("tanque", 0.1, 3, 14, 6.7, 170.4, 0.85, 250, 400, 1500.0, 1.2e6, "alta", ["C"])
    assert c["ra"] != c["re"] and c["gff"] == pytest.approx(1e-4)


# ------------------------------------------------------------------ verificación independiente y demo
def test_casos_de_verificacion_pasan():
    res = run_verification()
    assert len(res) == 5
    for r in res:
        assert r["ok"], r["id"]
        assert all(x["ok"] for x in r["extra"]), r["id"]


def test_proyecto_demo_cubre_los_cinco_estados():
    with open(DEMO, encoding="utf-8") as f:
        estado = json.load(f)
    r = evaluate_project(estado, "2026-11-24")
    assert r["resumen"] == {"bajo_minimo": 1, "vencida": 1, "alerta": 1, "info_insuficiente": 1, "normal": 1}
    fams = {e["familia"] for e in r["equipos"]}
    assert fams == {"tuberia", "recipiente", "tanque"}
    for e in r["equipos"]:
        assert not e["errores"], e["tag"]
        assert e["rbi"] and "df" in e["rbi"]
    # Tres CML por familia y ≥ 3 campañas históricas en cada familia del caso demostrativo
    for fam in fams:
        eq_ids = [e["id"] for e in estado["equipos"] if e["familia"] == fam]
        cmls = [c for c in estado["cmls"] if c["equipo_id"] in eq_ids]
        assert len(cmls) >= 3, fam
        tml_ids = {t["id"] for t in estado["tmls"] if t["cml_id"] in {c["id"] for c in cmls}}
        por_tml = {}
        for l in estado["lecturas"]:
            if l["tml_id"] in tml_ids:
                por_tml[l["tml_id"]] = por_tml.get(l["tml_id"], 0) + 1
        assert max(por_tml.values()) >= 3, fam


def test_cambiar_consecuencia_cambia_riesgo():
    with open(DEMO, encoding="utf-8") as f:
        estado = json.load(f)
    a = evaluate_project(estado, "2026-11-24")
    v = next(e for e in estado["equipos"] if e["tag"] == "V-201")
    v["rbi"]["ca_m2"] = 5.0
    b = evaluate_project(estado, "2026-11-24")
    ra = next(e for e in a["equipos"] if e["tag"] == "V-201")["rbi"]
    rb_ = next(e for e in b["equipos"] if e["tag"] == "V-201")["rbi"]
    assert rb_["ra"] < ra["ra"] and rb_["cat_cons"] == "A" and ra["cat_cons"] != "A"
    assert rb_["df"] == pytest.approx(ra["df"])         # el factor de daño NO depende de la consecuencia

def test_proyeccion_respeta_reemplazo_y_retiro():
    medidas = [
        {"fecha": "2021-01-01", "espesor": 5.0},
        {"fecha": "2023-01-01", "espesor": 3.0, "evento": "reemplazo"},
    ]
    punto = cor.analyze_tml(medidas, 3.0, 1.0)
    assert punto["vr"] == 0
    assert punto["serie_comparable"] == [{"fecha": "2023-01-01", "espesor": 3.0}]


def test_clase_uno_plazo_docente_y_serie_no_evaluable():
    hoy = date(2026, 1, 1)
    assert ins.next_inspection("tuberia", 1, None, False, "2024-02-29", hoy) is None
    corto = ins.next_inspection("tuberia", 1, 3.0, True, "2024-02-29", hoy)
    assert corto["intervalo_anios"] == 1.5
    largo = ins.next_inspection("tuberia", 1, 14.0, True, "2024-02-29", hoy)
    assert largo["fecha_limite"] == "2029-02-28"

