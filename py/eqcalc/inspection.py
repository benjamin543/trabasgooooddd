"""Próxima inspección (medición de espesores) según API 510 / 570 / 653 y estado del equipo (enunciado 4.5).

Alcance declarado: sólo la PRÓXIMA MEDICIÓN DE ESPESORES. Quedan pendientes (datos no modelados): inspección
visual externa, inspección interna/abierta de recipientes (API 510 §6.4), inspección interna de fondo de
tanque (API 653 §6.4), dispositivos de alivio de presión, CUI, etc.
Los intervalos máximos deben verificarse contra la edición vigente adoptada por el grupo.
"""
from __future__ import annotations

from datetime import date, timedelta

from .corrosion import DIAS_ANIO, parse_date

# API 570 Tabla 2: intervalo máximo de medición de espesores por clase (años)
API570_MAX_POR_CLASE = {1: 5.0, 2: 10.0, 3: 10.0, "inyeccion": 3.0}
API510_MAX = 10.0
API653_MAX_CR_CONOCIDA = 15.0
API653_MAX_CR_DESCONOCIDA = 5.0
INTERVALO_SIN_DATOS = 5.0   # criterio conservador cuando no hay velocidad de corrosión


def _regla_vida_media(vr: float, tope: float) -> tuple[float, str]:
    """RL ≥ 4 a: mín(RL/2, tope). RL < 4 a: mín(RL, 2 años) (API 510 §6.4.1 / API 570 §6.3.3)."""
    if vr < 4.0:
        iv = min(vr, 2.0)
        return iv, f"VR = {vr:.2f} a < 4 a: intervalo = mín(VR; 2 a) = {iv:.2f} a"
    iv = min(vr / 2.0, tope)
    gob = "VR/2" if vr / 2.0 <= tope else f"máximo normativo ({tope:g} a)"
    return iv, f"mín(VR/2 = {vr / 2.0:.2f} a; {tope:g} a) → gobierna {gob}"


def next_inspection(familia: str, clase_570, vr, cr_conocida: bool, fecha_ref, hoy: date) -> dict | None:
    """Devuelve tipo de inspección, fecha de referencia, intervalo, fecha límite y criterio gobernante."""
    ref = parse_date(fecha_ref)
    if familia == "recipiente":
        norma, tipo, tope = "API 510 §6.4.1", "Medición de espesores (UT) en servicio", API510_MAX
    elif familia == "tuberia":
        tope = API570_MAX_POR_CLASE.get(clase_570, 10.0)
        norma = f"API 570 §6.3 y Tabla 2 (clase {clase_570})"
        tipo = "Medición de espesores (UT) del circuito"
    elif familia == "tanque":
        norma, tipo = "API 653 §6.3.3 (UT externa del manto)", "Medición UT externa del manto"
        tope = API653_MAX_CR_CONOCIDA if cr_conocida else API653_MAX_CR_DESCONOCIDA
    else:
        raise ValueError(f"Familia desconocida: {familia}")

    if familia == "tuberia" and str(clase_570) == "1":
        if vr is None:
            return None
        iv = min(vr / 2, 5.0)
        criterio = "Clase 1, criterio docente: menor entre la mitad de la VR y cinco años."
        try:
            aniversario = ref.replace(year=ref.year + 5)
        except ValueError:  # 29 de febrero
            aniversario = ref.replace(year=ref.year + 5, day=28)
        limite = min(aniversario, ref + timedelta(days=int(iv * DIAS_ANIO)))
    elif vr is None and not cr_conocida:
        iv = min(INTERVALO_SIN_DATOS, tope)
        criterio = f"Sin velocidad de corrosión: intervalo conservador mín({INTERVALO_SIN_DATOS:g} a; máx. normativo {tope:g} a) = {iv:g} a"
    elif vr is None:   # CR nula: sin límite por vida remanente
        iv, criterio = tope, f"CR nula: gobierna el intervalo máximo normativo = {tope:g} a"
    elif familia == "tanque":
        iv = min(vr / 2.0, tope)
        criterio = f"API 653: mín(VR/2 = {vr / 2.0:.2f} a; {tope:g} a) → {'VR/2' if vr / 2.0 <= tope else 'máximo normativo'}"
    else:
        iv, criterio = _regla_vida_media(vr, tope)
    if not (familia == "tuberia" and str(clase_570) == "1"):
        limite = ref + timedelta(days=round(iv * DIAS_ANIO))
    return {
        "tipo": tipo, "norma": norma, "fecha_ref": ref.isoformat(), "intervalo_anios": iv,
        "fecha_limite": limite.isoformat(), "criterio": criterio,
        "dias_restantes": (limite - hoy).days, "vencida": limite < hoy,
    }


ESTADOS = {
    "bajo_minimo": {"etiqueta": "Espesor bajo el mínimo", "nivel": 4},
    "vencida": {"etiqueta": "Inspección vencida", "nivel": 3},
    "alerta": {"etiqueta": "Alerta", "nivel": 2},
    "info_insuficiente": {"etiqueta": "Información insuficiente", "nivel": 1},
    "normal": {"etiqueta": "Normal", "nivel": 0},
}


def classify(bajo_minimo: bool, vencida: bool, en_alerta: bool, suficiente: bool) -> str:
    """Precedencia: bajo mínimo > vencida > alerta > información insuficiente > normal."""
    if bajo_minimo:
        return "bajo_minimo"
    if vencida:
        return "vencida"
    if en_alerta:
        return "alerta"
    if not suficiente:
        return "info_insuficiente"
    return "normal"
