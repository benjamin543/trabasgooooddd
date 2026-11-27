"""Casos de verificación independiente (enunciado §6).

Cada caso documenta: entradas, referencia normativa, procedimiento manual y resultado esperado, calculado
FUERA del programa (a mano / con otra formulación numérica, p. ej. statistics.NormalDist para el RBI).
`run_verification()` evalúa el programa con las mismas entradas y compara con tolerancia relativa.
"""
from __future__ import annotations

from . import corrosion as cor
from . import design as dsg
from . import rbi as rb

CASOS = [
    {
        "id": "V1", "familia": "Tubería (API 570 / B31.3)",
        "titulo": "Espesor requerido de tubería a presión interna",
        "referencia": "ASME B31.3 §304.1.2 Ec. (3a)",
        "entradas": "P = 6,0 MPa; D = 219,1 mm; S = 138 MPa (A106-B, 200 °C); E = 1; W = 1; Y = 0,4",
        "manual": "t = 6,0·219,1 / [2·(138·1·1 + 6,0·0,4)] = 1314,6 / 280,8",
        "magnitud": "t_req [mm]", "esperado": 4.68162, "tol": 1e-4,
    },
    {
        "id": "V2", "familia": "Recipiente (API 510 / ASME VIII-1)",
        "titulo": "Espesor requerido de envolvente cilíndrica",
        "referencia": "ASME VIII Div.1 UG-27(c)(1)",
        "entradas": "P = 1,2 MPa; Di = 1800 mm; CA = 3 mm ⇒ R = 903 mm; S = 137,9 MPa; E = 0,85",
        "manual": "t = 1,2·903 / (137,9·0,85 − 0,6·1,2) = 1083,6 / 116,495",
        "magnitud": "t_req [mm]", "esperado": 9.30169, "tol": 1e-4,
    },
    {
        "id": "V3", "familia": "Tanque (API 653 / API 650)",
        "titulo": "Espesor mínimo de la 1.ª virola del manto",
        "referencia": "API 653 §4.3.3.1 (S = mín(0,80·Y; 0,426·T) para 1.ª y 2.ª virola)",
        "entradas": "D = 20 m; H = 12 m; G = 0,85; Y = 250 MPa; T = 400 MPa ⇒ S = mín(200; 170,4) = 170,4 MPa; E = 0,85",
        "manual": "t = 4,9·20·(12 − 0,3)·0,85 / (170,4·0,85) = 974,61 / 144,84",
        "magnitud": "t_min [mm]", "esperado": 6.72887, "tol": 1e-4,
    },
    {
        "id": "V4", "familia": "Corrosión y vida remanente",
        "titulo": "Velocidad de corrosión y vida remanente",
        "referencia": "API 510 §7.1.1 / API 570 §7.1.1 (CR = Δt/Δtiempo; VR = (t_act − t_req)/CR)",
        "entradas": "t = 10,0 mm (2018-01-01) y 8,0 mm (2022-01-01); t_req = 5,0 mm",
        "manual": "CR = (10 − 8)/4 a = 0,5 mm/año;  VR = (8 − 5)/0,5 = 6,0 años",
        "magnitud": "VR [años]", "esperado": 6.0, "tol": 1e-3,
    },
    {
        "id": "V5", "familia": "Módulo RBI (API 581)",
        "titulo": "Factor de daño por adelgazamiento y riesgo",
        "referencia": "API RP 581 Parte 2 §4.5.7 Ec. (2.12)–(2.20), Tablas 3.1, 4.5 y 4.6",
        "entradas": ("Cr = 0,4 mm/año; age_tk = 5 a; t_rdi = 10 mm; t_min = 6 mm; S = 137,9 MPa; E = 0,85; YS = 260; TS = 485 MPa; "
                     "confianza media (0,7/0,2/0,1); 1 inspección eficacia C (0,5/0,3/0,2); gff = 3,06E-05; F_MS = 1; "
                     "CA = 350 m²; CE = 900 000 USD"),
        "manual": ("FS = (260+485)/2·0,85·1,1 = 348,29; Art = 0,4·5/10 = 0,20; SR = (137,9·0,85/348,29)·6/10 = 0,2019; "
                   "Po = (0,8140; 0,1395; 0,0465); β = (3,620; 2,753; −0,012); Df = ΣPo·Φ(−β)/1,56E-04 = 153,87; "
                   "fF = 3,06E-05·153,87 = 4,708E-03 1/año; RA = fF·CA; RE = fF·CE"),
        "magnitud": "Df [-]", "esperado": 153.8712, "tol": 1e-4,
        "extra": [("fF [1/año]", 4.70846e-3, 1e-4), ("RA [m²/año]", 1.647961, 1e-4), ("RE [USD/año]", 4237.614, 1e-4)],
    },
]


def _calc_v1():
    return dsg.pipe_b313(6.0, 219.1, "A106-B", 200.0, 1.0, 1.5)["t_req"]


def _calc_v2():
    return dsg.vessel_uG27(1.2, 1800.0, "SA-516-70", 150.0, 0.85, 3.0)["t_req"]


def _calc_v3():
    return dsg.tank_shell_course(20.0, 12.0, 0.85, "A36", 0.85, 0.0, 1)["t_req_calculado"]


def _calc_v4():
    serie = [{"fecha": "2018-01-01", "espesor": 10.0, "evento": ""}, {"fecha": "2022-01-01", "espesor": 8.0, "evento": ""}]
    r = cor.analyze_tml(serie, 5.0, 2.0)
    return r["vr"]


def _calc_v5():
    c = rb.rbi_case("recipiente", 0.4, 5.0, 10.0, 6.0, 137.9, 0.85, 260.0, 485.0, 350.0, 900000.0, "media", ["C"])
    return c["df"], [c["ff"], c["ra"], c["re"]]


def run_verification() -> list[dict]:
    out = []
    for caso in CASOS:
        extra = []
        if caso["id"] == "V1":
            prog = _calc_v1()
        elif caso["id"] == "V2":
            prog = _calc_v2()
        elif caso["id"] == "V3":
            prog = _calc_v3()
        elif caso["id"] == "V4":
            prog = _calc_v4()
        else:
            prog, valores = _calc_v5()
            for (nombre, esp, tol), v in zip(caso["extra"], valores):
                extra.append({"magnitud": nombre, "esperado": esp, "programa": v, "error_rel":abs(v-esp)/abs(esp),
                              "ok": abs(v - esp) <= tol * abs(esp)})
        ok = abs(prog - caso["esperado"]) <= caso["tol"] * abs(caso["esperado"])
        out.append({**{k: caso[k] for k in ("id", "familia", "titulo", "referencia", "entradas", "manual", "magnitud", "esperado")},
                    "error_rel": abs(prog-caso["esperado"])/abs(caso["esperado"]), "programa": prog, "ok": ok, "extra": extra})
    return out
