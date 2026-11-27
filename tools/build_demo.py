"""Genera data/demo.json: caso demostrativo con antecedentes FICTICIOS.

Ejecutar desde la raíz del repo:  python tools/build_demo.py
"""
import base64
import json
import os
from urllib.parse import quote

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "demo.json")

STYLE = ('<style>text{font-family:Arial,sans-serif;font-size:13px;fill:#334155}'
         '.l{stroke:#1e293b;stroke-width:3;fill:none}.f{fill:#e2e8f0;stroke:#1e293b;stroke-width:3}'
         '.d{stroke:#64748b;stroke-width:1;stroke-dasharray:5 4;fill:none}.t{font-weight:bold;font-size:16px}</style>')


def svg_wrap(title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">{STYLE}'
            f'<rect width="800" height="450" fill="#f8fafc"/><text x="20" y="30" class="t">{title}</text>{body}</svg>')


def pipe_svg():
    body = ('<path class="l" d="M60 330 H300 V160 H560 V330 H740"/>'
            '<path class="l" d="M60 340 H290 V170 H570 V340 H740" opacity="0"/>'
            '<line class="l" x1="430" y1="160" x2="430" y2="90"/><rect x="415" y="70" width="30" height="20" class="f"/>'
            '<text x="452" y="84">Derivación 2"</text>'
            '<text x="90" y="360">Tramo recto A (aguas arriba)</text>'
            '<text x="310" y="140">Codo 90° (extradós)</text><text x="600" y="360">Tramo recto B</text>'
            '<text x="300" y="400">Flujo →  (esquema isométrico no a escala)</text>'
            '<path d="M100 330 l-18 0" class="d"/>')
    return svg_wrap("L-101 · Línea 8\" · circuito PC-01 (esquema)", body)


def vessel_svg():
    body = ('<rect x="200" y="110" width="400" height="230" class="f"/>'
            '<ellipse cx="200" cy="225" rx="45" ry="115" class="f"/><ellipse cx="600" cy="225" rx="45" ry="115" class="f"/>'
            '<rect x="200" y="110" width="400" height="230" fill="#e2e8f0" stroke="none"/>'
            '<line x1="200" y1="110" x2="600" y2="110" class="l"/><line x1="200" y1="340" x2="600" y2="340" class="l"/>'
            '<rect x="260" y="340" width="20" height="50" class="f"/><rect x="520" y="340" width="20" height="50" class="f"/>'
            '<text x="330" y="230">Envolvente cilíndrica</text><text x="148" y="378">Cabezal izq.</text>'
            '<text x="580" y="378">Cabezal der.</text><text x="300" y="420">Recipiente horizontal (esquema no a escala)</text>')
    return svg_wrap("V-201 · Separador de producción (esquema)", body)


def tank_svg():
    body = ""
    for i in range(5):
        y = 330 - (i + 1) * 54
        body += f'<rect x="250" y="{y}" width="300" height="54" class="f"/><text x="165" y="{y + 32}">Virola {i + 1}</text>'
    body += ('<rect x="240" y="330" width="320" height="14" fill="#94a3b8" stroke="#1e293b" stroke-width="2"/>'
             '<line x1="250" y1="60" x2="550" y2="60" class="l"/>'
             '<text x="330" y="400">Tanque atmosférico vertical (manto, esquema no a escala)</text>')
    return svg_wrap("T-301 · Tanque API 650 · manto (esquema)", body)


def data_url(svg):
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode()


state = {
    "version": 1,
    "meta": {"nombre": "Caso demostrativo (datos ficticios)", "creado": "2026-11-24"},
    "seq": {"equipo": 0, "cml": 0, "tml": 0, "lectura": 0, "adjunto": 0},
    "equipos": [], "cmls": [], "tmls": [], "lecturas": [], "adjuntos": [],
}
S = state["seq"]


def nid(k):
    S[k] += 1
    return S[k]


def add_eq(**kw):
    eq = {"id": nid("equipo"), **kw}
    state["equipos"].append(eq)
    return eq


def add_att(eq, nombre, svg):
    a = {"id": nid("adjunto"), "equipo_id": eq["id"], "nombre": nombre, "tipo": "svg", "dataUrl": data_url(svg)}
    state["adjuntos"].append(a)
    return a


def add_cml(eq, att, codigo, componente, ubicacion, x, y, tmls, curso=None):
    c = {"id": nid("cml"), "equipo_id": eq["id"], "codigo": codigo, "componente": componente, "ubicacion": ubicacion,
         "curso": curso, "adjunto_id": att["id"] if att else None, "x": x, "y": y}
    state["cmls"].append(c)
    for tcode, (pos, lects) in tmls.items():
        t = {"id": nid("tml"), "cml_id": c["id"], "codigo": tcode, "posicion": pos}
        state["tmls"].append(t)
        for fecha, esp, *resto in lects:
            ev = resto[0] if resto else ""
            state["lecturas"].append({"id": nid("lectura"), "tml_id": t["id"], "fecha": fecha, "espesor": esp, "unidad": "mm",
                                      "tecnica": "UT", "obs": "", "evento": ev})


RBI_BASE = {"moneda": "USD", "base_valoracion": "Costo directo de reparación + pérdida de producción, escenario de ruptura/pérdida de contención (valor ficticio)",
            "escenario": "Pérdida de contención por adelgazamiento general", "confianza": "media", "score_gestion": 50,
            "eficacia_defecto": "C", "base_espesor": "medido", "eficacias": {}}

# ---------------- Tubería: alerta ----------------
l101 = add_eq(tag="L-101", descripcion="Línea de proceso 8\" – salida de bomba", familia="tuberia", planta="Planta Demo", area="Área 10 – Proceso",
              sistema="Sistema 10-A Hidrocarburo", componente="Circuito PC-01", circuito="PC-01", servicio="Hidrocarburo líquido", fluido="Nafta",
              material="A106-B", codigo_diseno="ASME B31.3", codigo_servicio="API 570", clase_570=2, temp_diseno=200, temp_oper=160,
              p_diseno=6.0, p_oper=4.8, diametro_ext=219.1, espesor_nominal=8.18, ca=1.5, e_junta=1.0, tol_fabricacion=12.5,
              t_estructural=0.0, fecha_instalacion="2012-09-01", plazo_intervencion=2.0, cr_asumida=0.2,
              rbi={**RBI_BASE, "ca_m2": 60.0, "ce": 250000})
a = add_att(l101, "Esquema isométrico L-101", pipe_svg())
add_cml(l101, a, "CML-01", "Codo 90°", "Aguas abajo de válvula de control", 36, 25, {
    "T1": ("Extradós", [("2018-04-10", 8.00), ("2022-04-12", 6.60), ("2026-04-15", 5.20)]),
    "T2": ("Intradós", [("2018-04-10", 8.05), ("2022-04-12", 7.40), ("2026-04-15", 6.90)])})
add_cml(l101, a, "CML-02", "Tramo recto A", "Aguas arriba del codo", 18, 73, {
    "T1": ("12 en punto", [("2018-04-10", 8.10), ("2022-04-12", 7.70), ("2026-04-15", 7.30)])})
add_cml(l101, a, "CML-03", "Tramo recto B", "Después de la derivación", 82, 73, {
    "T1": ("6 en punto", [("2018-04-10", 8.10), ("2022-04-12", 7.80), ("2026-04-15", 7.50)])})

# ---------------- Tubería: información insuficiente ----------------
l102 = add_eq(tag="L-102", descripcion="Línea 4\" – recirculación (nueva)", familia="tuberia", planta="Planta Demo", area="Área 10 – Proceso",
              sistema="Sistema 10-A Hidrocarburo", componente="Circuito PC-02", circuito="PC-02", servicio="Hidrocarburo líquido", fluido="Nafta",
              material="A106-B", codigo_diseno="ASME B31.3", codigo_servicio="API 570", clase_570=2, temp_diseno=150, temp_oper=120,
              p_diseno=3.0, p_oper=2.2, diametro_ext=114.3, espesor_nominal=6.02, ca=1.5, e_junta=1.0, tol_fabricacion=12.5,
              t_estructural=0.0, fecha_instalacion="2026-01-15", plazo_intervencion=2.0, cr_asumida=0.2,
              rbi={**RBI_BASE, "ca_m2": 25.0, "ce": 80000})
add_cml(l102, a and None, "CML-01", "Tramo recto", "Succión de bomba P-102", None, None,
        {"T1": ("12 en punto", [("2026-03-20", 5.95)])})

# ---------------- Recipiente: espesor bajo el mínimo ----------------
v201 = add_eq(tag="V-201", descripcion="Separador horizontal de producción", familia="recipiente", planta="Planta Demo", area="Área 20 – Separación",
              sistema="Sistema 20-B Separación", componente="Envolvente y cabezales", servicio="Mezcla agua/hidrocarburo", fluido="Agua amarga",
              material="SA-516-70", codigo_diseno="ASME VIII Div.1", codigo_servicio="API 510", temp_diseno=150, temp_oper=90,
              p_diseno=1.2, p_oper=0.9, diametro_int=1800, espesor_nominal=16.0, ca=3.0, e_junta=0.85, tol_fabricacion=0.0,
              t_estructural=0.0, fecha_instalacion="2008-03-01", plazo_intervencion=2.0, cr_asumida=0.2,
              rbi={**RBI_BASE, "ca_m2": 350.0, "ce": 900000})
a = add_att(v201, "Esquema recipiente V-201", vessel_svg())
add_cml(v201, a, "CML-01", "Envolvente", "Cuarto inferior, zona de interfaz agua", 50, 63, {
    "T1": ("0°", [("2012-05-08", 15.80), ("2018-05-10", 12.00), ("2024-05-14", 9.10)]),
    "T2": ("90°", [("2012-05-08", 15.85), ("2018-05-10", 13.10), ("2024-05-14", 10.90)])})
add_cml(v201, a, "CML-02", "Envolvente", "Zona superior (fase vapor)", 50, 30, {
    "T1": ("180°", [("2012-05-08", 15.90), ("2018-05-10", 15.20), ("2024-05-14", 14.60)])})
add_cml(v201, a, "CML-03", "Cabezal izquierdo", "Zona de transición", 24, 50, {
    "T1": ("Corona", [("2012-05-08", 15.00), ("2018-05-10", 14.10), ("2024-05-14", 13.20)])})

# ---------------- Recipiente: inspección vencida ----------------
v202 = add_eq(tag="V-202", descripcion="Acumulador de condensado", familia="recipiente", planta="Planta Demo", area="Área 20 – Separación",
              sistema="Sistema 20-B Separación", componente="Envolvente", servicio="Condensado", fluido="Condensado",
              material="SA-516-70", codigo_diseno="ASME VIII Div.1", codigo_servicio="API 510", temp_diseno=120, temp_oper=80,
              p_diseno=1.0, p_oper=0.7, diametro_int=1200, espesor_nominal=14.0, ca=3.0, e_junta=0.85, tol_fabricacion=0.0,
              t_estructural=0.0, fecha_instalacion="2008-03-01", plazo_intervencion=2.0, cr_asumida=0.2,
              rbi={**RBI_BASE, "ca_m2": 40.0, "ce": 120000})
a = add_att(v202, "Esquema recipiente V-202", vessel_svg())
add_cml(v202, a, "CML-01", "Envolvente", "Zona inferior", 50, 62, {
    "T1": ("0°", [("2008-03-01", 14.0), ("2012-04-05", 13.5), ("2016-04-08", 13.0)])})
add_cml(v202, a, "CML-02", "Envolvente", "Zona media", 50, 45, {
    "T1": ("90°", [("2008-03-01", 14.0), ("2012-04-05", 13.6), ("2016-04-08", 13.2)])})
add_cml(v202, a, "CML-03", "Cabezal derecho", "Corona", 76, 50, {
    "T1": ("Corona", [("2008-03-01", 13.0), ("2012-04-05", 12.7), ("2016-04-08", 12.4)])})

# ---------------- Tanque: normal ----------------
cursos = [{"n": i + 1, "h_base": round(i * 2.4, 2), "altura": 2.4, "t_nominal": t} for i, t in enumerate([14, 12, 10, 8, 6])]
t301 = add_eq(tag="T-301", descripcion="Tanque de almacenamiento de diésel", familia="tanque", planta="Planta Demo", area="Área 30 – Almacenamiento",
              sistema="Sistema 30-C Combustibles", componente="Manto (virolas 1–5)", servicio="Almacenamiento", fluido="Diésel",
              material="A36", codigo_diseno="API 650", codigo_servicio="API 653", temp_diseno=60, temp_oper=30,
              p_diseno=0.0, p_oper=0.0, diametro=20.0, nivel_diseno=12.0, g_esp=0.85, cursos=cursos, espesor_nominal=14.0, ca=1.5,
              e_junta=0.85, tol_fabricacion=0.0, t_estructural=2.5, fecha_instalacion="2010-06-01", plazo_intervencion=3.0, cr_asumida=0.1,
              rbi={**RBI_BASE, "ca_m2": 1500.0, "ce": 1200000, "confianza": "alta"})
a = add_att(t301, "Esquema manto T-301", tank_svg())
add_cml(t301, a, "CML-01", "Virola 1", "Cota 0–2,4 m", 70, 63, {
    "T1": ("N", [("2010-06-01", 14.0), ("2018-05-20", 13.5), ("2026-05-22", 12.9)]),
    "T2": ("S", [("2010-06-01", 14.0), ("2018-05-20", 13.6), ("2026-05-22", 13.1)])}, curso=1)
add_cml(t301, a, "CML-02", "Virola 2", "Cota 2,4–4,8 m", 70, 51, {
    "T1": ("N", [("2010-06-01", 12.0), ("2018-05-20", 11.7), ("2026-05-22", 11.2)])}, curso=2)
add_cml(t301, a, "CML-03", "Virola 3", "Cota 4,8–7,2 m", 70, 40, {
    "T1": ("N", [("2010-06-01", 10.0), ("2018-05-20", 9.8), ("2026-05-22", 9.5)])}, curso=3)
add_cml(t301, a, "CML-04", "Virola 5", "Cota 9,6–12 m", 70, 17, {
    "T1": ("N", [("2010-06-01", 6.0), ("2018-05-20", 5.9), ("2026-05-22", 5.8)])}, curso=5)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
print("demo.json:", os.path.getsize(OUT), "bytes;", len(state["equipos"]), "equipos,", len(state["tmls"]), "TML,", len(state["lecturas"]), "lecturas")
