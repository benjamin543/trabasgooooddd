"""Motor de evaluación: integra diseño, mediciones, inspección y RBI para todo el proyecto."""
from __future__ import annotations

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


def supported(eq, cml):
    name = cml.get("geometria", cml.get("componente", "")).strip().casefold()
    if eq["familia"] == "tuberia":
        return name in {"recto", "tramo recto", "tramo recto a", "tramo recto b"}
    if eq["familia"] == "recipiente":
        return name in {"envolvente", "envolvente cilíndrica"}
    return cml.get("curso") is not None and name in {"virola", f"virola {cml['curso']}"}


def mawp(eq, req, t):
    """Presión interna del punto con espesor UT actual, sin reserva futura."""
    if not t or t < req["t_estructural"]:
        return None
    se = req["S"] * req["E"]
    if eq["familia"] == "tuberia" and t < eq["diametro_ext"] / 6:
        p = 2 * se * t / (eq["diametro_ext"] - 0.8 * t)
        return p if p <= 0.385 * se else None
    if eq["familia"] == "recipiente":
        radius = eq["diametro_int"] / 2 + req["CA"]
        p = se * t / (radius + 0.6 * t)
        return p if t <= radius / 2 or p <= 0.385 * se else None
    return None


def evaluate_equipment(eq: dict, cmls: list, tmls: list, lecturas: list, hoy: date) -> dict:
    out = {"id": eq["id"], "tag": eq["tag"], "familia": eq["familia"], "avisos": [], "errores": [], "tmls": []}
    plazo = eq.get("plazo_intervencion", 2.0)
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
    out["excluidos"] = []
    for cml in mis_cmls:
        if not supported(eq, cml):
            motivo = f"{cml['codigo']} · {cml.get('componente')}: geometría sin ecuación implementada."
            out["excluidos"].append(cml["codigo"])
            out["avisos"].append(motivo)
            continue
        curso = _component_key(eq, cml)
        try:
            req = req_for(curso if curso is not None else (1 if eq["familia"] == "tanque" else None))
        except (dsg.DesignError, MaterialError, KeyError, ValueError) as ex:
            out["excluidos"].append(cml["codigo"])
            out["errores"].append(f"{cml['codigo']}: {ex}")
            continue
        for tml in [t for t in tmls if t["cml_id"] == cml["id"]]:
            lects = [r for r in lecturas if r["tml_id"] == tml["id"]]
            a = cor.analyze_tml(lects, req["t_adm"], plazo, hoy, exigir_incertidumbre=True)
            item = {"cml_id": cml["id"], "cml": cml["codigo"], "tml_id": tml["id"], "tml": tml["codigo"], "curso": curso,
                    "t_adm": req["t_adm"], "t_req": req["t_req"], **a}
            item["mawp_punto_mpa"] = mawp(eq, req, a["t_med"]) if eq["familia"] != "tanque" else None
            if a["fecha_ult"]:
                ni = ins.next_inspection(eq["familia"], clase, a["vr"], a["suficiente"], a["fecha_ult"], hoy)
                if not a["suficiente"] and a["n_comparables"] >= 2:
                    ni = None
                item["inspeccion"] = ni
                alerta = (not a["bajo_minimo"]) and a["t_med"] <= a["t_alerta"] and a["suficiente"]
                item["estado"] = ins.classify(a["bajo_minimo"], bool(ni and ni["vencida"]), alerta, a["suficiente"] and ni is not None)
            else:
                item["inspeccion"] = None
                item["estado"] = "info_insuficiente"
                item["avisos"].append("Sin mediciones registradas: se requiere una medición base.")
            out["tmls"].append(item)

    if not out["tmls"]:
        out.pop("requerido", None)
        out.update(estado="info_insuficiente", gobernante=None, inspeccion=None, rbi=None)
        out["avisos"].append("El equipo no tiene CML/TML con mediciones.")
        return out

    def gkey(t):
        return (-ins.ESTADOS[t["estado"]]["nivel"], t["vr"] if t["vr"] is not None else float("inf"),
                (t["t_med"] - t["t_adm"]) if t["t_med"] is not None else float("inf"))
    gob = sorted(out["tmls"], key=gkey)[0]
    out["gobernante"] = f"{gob['cml']} / {gob['tml']}"
    out["gobernante_ref"] = {"cml_id": gob["cml_id"], "tml_id": gob["tml_id"]}
    out["estado"] = "info_insuficiente" if out["excluidos"] and gob["estado"] == "normal" else gob["estado"]
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
    out["vr_al_corte"] = gob["vr_al_corte"]
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
    keys = ("t_dis_api650", "t_prueba_api650", "t_nom_min_api650", "familia", "norma_diseno", "norma_servicio", "ecuacion", "entradas", "t_req", "t_adm", "t_dis", "t_pedido",
            "tol_fabricacion_pct", "S", "E", "CA", "notas", "t_estructural")
    return {k: r.get(k) for k in keys}


def _evaluate_rbi(eq, out, gob, lecturas, tmls, mis_cmls, hoy, req_for):
    cfg = eq.get("rbi") or {}
    mat = get_material(eq["material"])
    req = req_for(gob["curso"] if gob["curso"] is not None else (1 if eq["familia"] == "tanque" else None))
    supuestos = []
    cr = gob["cr_adoptada"]
    if cr is None:
        return {"error": "Sin tasa comparable en el punto gobernante. Verificar UT antes del RBI."}
    if not all(isinstance(cfg.get(k), (int,float)) for k in ("ce","ca_m2","score_gestion")):
        return {"error": "Ingrese consecuencias y puntuación de gestión numéricas."}
    if cfg.get("moneda") != "USD" or not str(cfg.get("base_valoracion") or "").strip():
        return {"error": "Se requiere base de valoración y consecuencias expresadas en USD."}
    supuestos.append(f"RBI limitado al punto {out['gobernante']}. Factores de ajuste unitarios; mecanismo único.")
    if eq["familia"] == "tanque" and not 1 <= gob["curso"] <= 10:
        return {"error": "GFF disponible sólo para COURSE-1-10."}
    componente = cfg.get("componente_gff")
    compat = {"tuberia": {"PIPE-4": 114.3, "PIPE-6": 168.3, "PIPE-8": 219.1}, "recipiente": {"DRUM": None}, "tanque": {"COURSE-1-10": None}}
    tipos = compat[eq["familia"]]
    if componente not in tipos or (tipos[componente] and abs(eq["diametro_ext"] - tipos[componente]) > 0.1):
        return {"error": "Seleccionar y corroborar el componente de la Tabla 3.1 para este equipo."}
    supuestos.append(f"GFF de {componente}, Tabla 3.1.")
    modo = cfg.get("base_espesor", "medido")
    efmap = cfg.get("eficacias", {}) or {}
    just = cfg.get("justificaciones", {})
    def eficacia(fecha):
        return efmap.get(fecha, "E") if str(just.get(fecha) or "").strip() else "E"
    fechas = [r["fecha"] for r in gob["serie_comparable"]]
    supuestos.append("Cada campaña sin justificación recibe eficacia E (sin crédito).")
    if modo not in ("nominal", "medido"):
        return {"error": "Base RBI desconocida."}
    if modo == "nominal":
        if gob["n_comparables"] < gob["n_lecturas"]:
            return {"error": "Tras un reinicio utilice espesor medido."}
        t_rdi = float(_nominal_for(eq, gob["curso"]))
        age = cor.years_between(cor.parse_date(eq["fecha_instalacion"]), hoy)
        eficacias = [eficacia(f) for f in fechas]
        supuestos.append("Base de espesor: nominal (espesor suministrado) y edad desde la instalación (API 581 §4.5.5).")
    else:
        if gob["fecha_ult"] is None:
            return {"error": "Se requiere una lectura medida para evaluar RBI."}
        t_rdi = gob["t_med"]
        age = cor.years_between(cor.parse_date(gob["fecha_ult"]), hoy)
        eficacias = [eficacia(gob["fecha_ult"])]
        supuestos.append("Base de espesor: último espesor medido; se acredita sólo la campaña que lo establece (API 581 §4.5.5).")
    if age < 0:
        return {"error": "Fecha base posterior a la evaluación."}
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
                                "ff", "prob_1a", "ra", "re", "cat_prob", "cat_cons", "nivel")},
    }


def validar_relaciones(state):
    grupos = {}
    for tabla in ("equipos", "cmls", "tmls", "lecturas", "adjuntos"):
        filas = state.get(tabla, [])
        ids = [r["id"] for r in filas]
        if any(type(i) is not int or i <= 0 for i in ids) or len(set(ids)) != len(ids):
            raise ValueError(f"Identificador inválido o duplicado en {tabla}.")
        grupos[tabla] = {r["id"]: r for r in filas}
    tags = [str(e.get("tag") or "").strip().upper() for e in grupos["equipos"].values()]
    if "" in tags or len(tags) != len(set(tags)):
        raise ValueError("TAG vacío o duplicado.")
    for hija, padre, campo in (("cmls","equipos","equipo_id"), ("tmls","cmls","cml_id"),
                                ("lecturas","tmls","tml_id"), ("adjuntos","equipos","equipo_id")):
        if any(r.get(campo) not in grupos[padre] for r in grupos[hija].values()):
            raise ValueError(f"Relación inválida en {hija}.")
    for c in grupos["cmls"].values():
        adj = c.get("adjunto_id")
        if adj is not None and grupos["adjuntos"].get(adj, {}).get("equipo_id") != c["equipo_id"]:
            raise ValueError("Adjunto de otro equipo o ausente.")
    for l in grupos["lecturas"].values():
        c = grupos["cmls"][grupos["tmls"][l["tml_id"]]["cml_id"]]
        instalacion = grupos["equipos"][c["equipo_id"]].get("fecha_instalacion")
        if instalacion and cor.parse_date(l["fecha"]) < cor.parse_date(instalacion):
            raise ValueError("UT anterior a la instalación.")


def evaluate_project(state: dict, hoy_iso: str | None = None) -> dict:
    validar_relaciones(state)
    hoy = cor.parse_date(hoy_iso) if hoy_iso else date.today()
    equipos = state.get("equipos", [])
    res = [evaluate_equipment(eq, state.get("cmls", []), state.get("tmls", []), state.get("lecturas", []), hoy)
           for eq in equipos]
    # Prioridad de inspección: nivel de riesgo (área) → RA; ranking económico por RE.
    ranked = [r for r in res if r.get("rbi") and "ra" in r["rbi"]]
    for i, r in enumerate(sorted(ranked, key=lambda r: (r["estado"] != "bajo_minimo", -NIVEL_ORDEN[r["rbi"]["nivel"]], -r["rbi"]["ra"], r["tag"])), 1):
        r["rbi"]["prioridad_area"] = i
    for i, r in enumerate(sorted(ranked, key=lambda r: (-r["rbi"]["re"], r["tag"])), 1):
        r["rbi"]["prioridad_economica"] = i
    resumen = {k: sum(1 for r in res if r.get("estado") == k) for k in ins.ESTADOS}
    recomendaciones = {
        "bajo_minimo": "Escalar de inmediato al responsable de integridad para decidir condiciones seguras de operación y reparación.",
        "vencida": "Regularizar la inspección vencida y verificar el espesor actual.",
        "alerta": "Programar UT confirmatoria y preparar intervención.",
        "info_insuficiente": "Completar antecedentes, confirmar geometría y obtener UT comparable.",
        "normal": "Mantener seguimiento UT en la fecha planificada."}
    plan = []
    for r in res:
        for t in r["tmls"]:
            ni = t["inspeccion"] or {}
            plan.append(dict(tag=r["tag"], punto=t["cml"] + " / " + t["tml"], estado=t["estado"],
                             fecha=hoy.isoformat() if t["bajo_minimo"] else ni.get("fecha_limite"),
                             tipo=ni.get("tipo", "Confirmación UT"), accion=recomendaciones[t["estado"]]))
        for c in r.get("excluidos", []):
            plan.append(dict(tag=r["tag"], punto=c, estado="info_insuficiente", fecha=None,
                             tipo="Revisión de geometría", accion="Obtener evaluación específica del componente."))
        if not r["tmls"] and not r.get("excluidos"):
            plan.append(dict(tag=r["tag"], punto="Equipo", estado="info_insuficiente", fecha=None,
                             tipo="Revisión técnica", accion=recomendaciones["info_insuficiente"]))
    plan.sort(key=lambda x: (-ins.ESTADOS[x["estado"]]["nivel"], x["fecha"] or "9999", x["tag"]))
    return {"plan": plan, "hoy": hoy.isoformat(), "equipos": res, "resumen": resumen,
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
