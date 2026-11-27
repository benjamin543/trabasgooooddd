import json
from eqcalc import __version__, design, engine, verification
from eqcalc.materials import MATERIALS


def _design(p: dict) -> dict:
    fam = p["familia"]
    eq = {"familia": fam, "tag": "CALC", "material": p["material"], "temp_diseno": float(p["temp_diseno"]),
          "p_diseno": float(p.get("p_diseno", 0)), "ca": float(p.get("ca", 0)),
          "e_junta": float(p["e_junta"]) if p.get("e_junta") not in (None, "") else None,
          "tol_fabricacion": float(p.get("tol_fabricacion", 0)), "t_estructural": float(p.get("t_estructural", 0))}
    if fam == "tuberia":
        eq["diametro_ext"] = float(p["diametro_ext"])
    elif fam == "recipiente":
        eq["diametro_int"] = float(p["diametro_int"])
    else:
        if p.get("nivel_prueba") is not None:
            eq["nivel_prueba"] = float(p["nivel_prueba"])
        eq.update(diametro=float(p["diametro"]), nivel_diseno=float(p["nivel_diseno"]), g_esp=float(p["g_esp"]),
                  cursos=[{"n": int(p["curso"]), "h_base": float(p["h_base"]), "altura": 2.4, "t_nominal": 0}])
    r = design.required_thickness(eq, int(p["curso"]) if fam == "tanque" else None)
    return engine._pack_req(r) | {k: r.get(k) for k in ("t_req_calculado", "t_dis_api650", "t_prueba_api650") if k in r}


def api(op: str, payload: str = "{}", hoy: str = "") -> str:
    try:
        if op == "evaluate":
            data = engine.evaluate_project(json.loads(payload), hoy or None)
        elif op == "design":
            data = _design(json.loads(payload))
        elif op == "verification":
            data = verification.run_verification()
        elif op == "catalog":
            data = engine.catalog()
        elif op == "version":
            data = {"eqcalc": __version__}
        else:
            data = {"error": f"OperaciÃ³n desconocida: {op}"}
    except Exception as ex:  # los errores de cÃ¡lculo se devuelven a la interfaz, no se ocultan
        data = {"error": f"{type(ex).__name__}: {ex}"}
    return json.dumps(data)


