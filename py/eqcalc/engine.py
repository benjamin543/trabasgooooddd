"""Motor de evaluación: integra diseño, mediciones, inspección y RBI para todo el proyecto."""
from __future__ import annotations

import json
from datetime import date

from . import corrosion as cor
from . import design as dsg
from . import inspection as ins
from . import rbi as rb
from .materials import MATERIALS, MaterialError, get_material

NIVEL_ORDEN = {"Alto": 3, "Medio-Alto": 2, "Medio": 1, "Bajo": 0}
HORIZONTES_PRONOSTICO = (0, 1, 3, 5)


def _inf(x):
    return None if x is None else float(x)


def _component_key(eq, cml):
    return cml.get("curso") if eq["familia"] == "tanque" else None


def evaluate_equipment(eq: dict, cmls: list, tmls: list, lecturas: list, hoy: date) -> dict:
    out = {"id": eq["id"], "tag": eq["tag"], "familia": eq["familia"], "avisos": [], "errores": [], "tmls": []}
    plazo = float(eq.get("plazo_intervencion", 2.0))
    clase = eq.get("clase_570", 2)
    req_cache: dict = {}

    def req_for(curso):
        if curso not in req_cache:
            req_cache[curso] = dsg.required_thickness(eq, curso)
        return req_cache[curso]

    try:
        base_req = req_for(1 if eq["familia"] == "tanque" else None)
    except (dsg.DesignError, MaterialError, KeyError, ValueError) as ex:
        out["errores"].append(f"Cálculo de espesor: {ex}")
        out["estado"] = "info_insuficiente"
        return out
    out["requerido"] = _pack_req(base_req)

    mis_cmls = [c for c in cmls if c["equipo_id"] == eq["id"]]
    for cml in mis_cmls:
        curso = _component_key(eq, cml)
        try:
            req = req_for(curso if curso is not None else (1 if eq["familia"] == "tanque" else None))
        except (dsg.DesignError, MaterialError, KeyError, ValueError) as ex:
            out["errores"].append(f"{cml['codigo']}: {ex}")
            continue
        for tml in [t for t in tmls if t["cml_id"] == cml["id"]]:
            lects = [r for r in lecturas if r["tml_id"] == tml["id"]]
            a = cor.analyze_tml(lects, req["t_adm"], plazo, hoy)
            item = {"cml_id": cml["id"], "cml": cml["codigo"], "tml_id": tml["id"], "tml": tml["codigo"], "curso": curso,
                    "t_adm": req["t_adm"], "t_req": req["t_req"], **a}
            if a["fecha_ult"]:
                ni = ins.next_inspection(eq["familia"], clase, a["vr"], a["suficiente"], a["fecha_ult"], hoy)
                item["inspeccion"] = ni
                alerta = (not a["bajo_minimo"]) and a["t_med"] <= a["t_alerta"] and a["suficiente"]
                item["estado"] = ins.classify(a["bajo_minimo"], bool(ni and ni["vencida"]), alerta, a["suficiente"] and ni is not None)
            else:
                item["inspeccion"] = None
                item["estado"] = "info_insuficiente"
                item["avisos"].append("Sin mediciones registradas: se requiere una medición base.")
            out["tmls"].append(item)

    if not out["tmls"]:
        out.update(estado="info_insuficiente", gobernante=None, inspeccion=None, rbi=None)
        out["avisos"].append("El equipo no tiene CML/TML con mediciones.")
        return out

    def gkey(t):
        return (-ins.ESTADOS[t["estado"]]["nivel"], t["vr"] if t["vr"] is not None else float("inf"),
                (t["t_med"] - t["t_adm"]) if t["t_med"] is not None else float("inf"))
    gob = sorted(out["tmls"], key=gkey)[0]
    out["gobernante"] = f"{gob['cml']} / {gob['tml']}"
    out["gobernante_ref"] = {"cml_id": gob["cml_id"], "tml_id": gob["tml_id"]}
    out["estado"] = gob["estado"]
    out["requerido"] = _pack_req(req_for(gob["curso"] if gob["curso"] is not None else (1 if eq["familia"] == "tanque" else None)))
    out["espesores"] = {
        "nominal": _nominal_for(eq, gob["curso"]), "requerido": gob["t_req"], "minimo_admisible": gob["t_adm"],
        "medido": gob["t_med"], "alerta": gob["t_alerta"], "plazo_intervencion": plazo,
    }
    con_datos = [t for t in out["tmls"] if t["inspeccion"]]
    if con_datos:
        prox = min(con_datos, key=lambda t: t["inspeccion"]["fecha_limite"])
        out["inspeccion"] = {**prox["inspeccion"], "tml": f"{prox['cml']} / {prox['tml']}"}
    else:
        out["inspeccion"] = None
    out["cr_adoptada"] = gob["cr_adoptada"]
    out["vr"] = gob["vr"]
    for t in out["tmls"]:
        out["avisos"] += [f"{t['cml']}/{t['tml']}: {m}" for m in t["avisos"]]
    out["rbi"] = _evaluate_rbi(eq, out, gob, lecturas, tmls, mis_cmls, hoy, req_for)
    return out


def _nominal_for(eq, curso):
    if eq["familia"] == "tanque":
        c = next((x for x in eq.get("cursos", []) if x["n"] == curso), None)
        return c["t_nominal"] if c else eq.get("espesor_nominal")
    return eq.get("espesor_nominal")


def _pack_req(r: dict) -> dict:
    keys = ("familia", "norma_diseno", "norma_servicio", "ecuacion", "entradas", "t_req", "t_adm", "t_dis", "t_pedido",
            "tol_fabricacion_pct", "S", "E", "CA", "notas", "t_estructural")
    return {k: r.get(k) for k in keys}


def _evaluate_rbi(eq, out, gob, lecturas, tmls, mis_cmls, hoy, req_for):
    cfg = eq.get("rbi") or {}
    mat = get_material(eq["material"])
    req = req_for(gob["curso"] if gob["curso"] is not None else (1 if eq["familia"] == "tanque" else None))
    supuestos = []
    cr = gob["cr_adoptada"]
    if cr is None:
        cr = float(eq.get("cr_asumida", 0.2))
        supuestos.append(f"Información insuficiente: se asume CR = {cr:g} mm/año (dato de entrada 'cr_asumida').")
    modo = cfg.get("base_espesor", "medido")
    efmap = cfg.get("eficacias", {}) or {}
    defecto = cfg.get("eficacia_defecto", "C")
    ids_tml = {t["id"] for t in tmls if any(c["id"] == t["cml_id"] for c in mis_cmls)}
    vigentes, _ = cor.clean_series([r for r in lecturas if r["tml_id"] in ids_tml], hoy)
    fechas = sorted({r["fecha"] for r in vigentes})
    if modo == "nominal":
        t_rdi = float(_nominal_for(eq, gob["curso"]))
        age = cor.years_between(cor.parse_date(eq["fecha_instalacion"]), hoy)
        eficacias = [efmap.get(f, defecto) for f in fechas]
        supuestos.append("Base de espesor: nominal (espesor suministrado) y edad desde la instalación (API 581 §4.5.5).")
    else:
        if gob["fecha_ult"] is None:
            return {"error": "Se requiere una lectura medida para evaluar RBI."}
        t_rdi = gob["t_med"]
        age = cor.years_between(cor.parse_date(gob["fecha_ult"]), hoy)
        eficacias = [efmap.get(gob["fecha_ult"], defecto)]
        supuestos.append("Base de espesor: último espesor medido; se acredita sólo la campaña que lo establece (API 581 §4.5.5).")
    age = max(age, 0.0)
    args = dict(familia=eq["familia"], cr=cr, age_tk=age, t_rdi=t_rdi, t_min=req["t_adm"], S=req["S"], E=req["E"],
                YS=mat["YS"], TS=mat["TS"], ca_m2=float(cfg.get("ca_m2", 0.0)), ce=float(cfg.get("ce", 0.0)),
                confianza=cfg.get("confianza", "media"), score_gestion=float(cfg.get("score_gestion", 50.0)))
    try:
        caso = rb.rbi_case(**args, eficacias=eficacias)
        pronostico = []
        for h in HORIZONTES_PRONOSTICO:
            c = rb.rbi_case(**{**args, "age_tk": age + h}, eficacias=eficacias)
            pronostico.append({"anios": h, "df": c["df"], "ff": c["ff"], "ra": c["ra"], "nivel": c["nivel"]})
        wi = rb.what_if_inspection(args, eficacias)
    except (ValueError, ZeroDivisionError) as ex:
        return {"error": f"RBI: {ex}"}
    return {
        "moneda": cfg.get("moneda", "USD"), "base_valoracion": cfg.get("base_valoracion", ""),
        "escenario": cfg.get("escenario", ""), "ca_m2": args["ca_m2"], "ce": args["ce"], "cr_usada": cr,
        "t_rdi": t_rdi, "age_tk": age, "t_min": req["t_adm"], "eficacias": eficacias, "confianza": args["confianza"],
        "supuestos": supuestos, "pronostico": pronostico, "what_if": wi,
        **{k: caso[k] for k in ("FS", "art", "sr", "inspecciones", "po", "beta", "phi", "df_base", "df", "gff", "fms",
                                "ff", "ra", "re", "cat_prob", "cat_cons", "nivel")},
    }


def evaluate_project(state: dict, hoy_iso: str | None = None) -> dict:
    hoy = cor.parse_date(hoy_iso) if hoy_iso else date.today()
    equipos = state.get("equipos", [])
    res = [evaluate_equipment(eq, state.get("cmls", []), state.get("tmls", []), state.get("lecturas", []), hoy)
           for eq in equipos]
    # Prioridad de inspección: nivel de riesgo (área) → RA; ranking económico por RE.
    ranked = [r for r in res if r.get("rbi") and "ra" in r["rbi"]]
    for i, r in enumerate(sorted(ranked, key=lambda r: (-NIVEL_ORDEN[r["rbi"]["nivel"]], -r["rbi"]["ra"], r["tag"])), 1):
        r["rbi"]["prioridad_area"] = i
    for i, r in enumerate(sorted(ranked, key=lambda r: (-r["rbi"]["re"], r["tag"])), 1):
        r["rbi"]["prioridad_economica"] = i
    resumen = {k: sum(1 for r in res if r.get("estado") == k) for k in ins.ESTADOS}
    return {"hoy": hoy.isoformat(), "equipos": res, "resumen": resumen,
            "matriz": _matrix(ranked), "estados": ins.ESTADOS}


def _matrix(ranked):
    celdas = {}
    for r in ranked:
        celdas.setdefault((r["rbi"]["cat_prob"], r["rbi"]["cat_cons"]), []).append(r["tag"])
    return [{"p": p, "c": c, "nivel": rb.risk_level(p, c), "tags": celdas.get((p, c), [])}
            for p in (5, 4, 3, 2, 1) for c in "ABCDE"]


def catalog() -> dict:
    return {k: {kk: vv for kk, vv in v.items() if kk != "S_tabla"} | {"S_tabla": v.get("S_tabla", [])}
            for k, v in MATERIALS.items()}
