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

    if familia == "tuberia":
        if str(clase_570).isdigit():
            clase_570 = int(clase_570)
        if clase_570 not in API570_MAX_POR_CLASE:
            return None
        tope = API570_MAX_POR_CLASE[clase_570]
    if not cr_conocida or vr is None:
        if familia != "tanque":
            return None
        iv = API653_MAX_CR_DESCONOCIDA
        criterio = "UT externa de manto con tasa desconocida. Confirmar antes la tendencia."
    else:
        iv = min(vr / 2, tope)
        criterio = "Plan académico conservador: menor entre media vida desde UT y tope de familia."
    if familia == "recipiente":
        tipo = "Seguimiento UT de envolvente (plan académico)"
        norma = "Referencia API 510; UT puntual no acredita inspección interna o en servicio"
    try:
        aniversario = ref.replace(year=ref.year + int(iv))
    except ValueError:
        aniversario = ref.replace(year=ref.year + int(iv), day=28)
    limite = aniversario if float(iv).is_integer() else ref + timedelta(days=int(iv * DIAS_ANIO))
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
