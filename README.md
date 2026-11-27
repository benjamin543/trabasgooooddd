# Cota UT

Proyecto final de Mantenimiento a Equipos Estáticos (MAN040-B), UTFSM, sede Viña del Mar. Integrantes: Nicolas Marin, Benjamin Castillo, Jose Pacheco y Tomas Quijada.

[Abrir la aplicación en GitHub Pages](https://benjamin543.github.io/trabasgooooddd/)

Desde Planta, selecciona un TAG y consulta sus antecedentes. En Esquema, selecciona un CML para abrir la proyección del TML. Registra una campaña en Historial, cambia presión o nivel en Parámetros de diseño y modifica las consecuencias en RBI. Respaldo exporta e importa el proyecto, incluidos adjuntos. Verificación compara cinco casos con resultados independientes. El cuaderno de campo acepta localmente el Excel de la Tarea 3. Los equipos de demostración son ficticios.

El motor Python se encuentra en `py/eqcalc`. La página usa PyScript y Pyodide. La primera carga requiere acceso a sus recursos en línea. Para trabajar sin Internet, ejecuta `python local.py` con Python 3.10 o posterior desde una copia del repositorio y abre el enlace de la consola. Para verificar el motor, ejecuta `python -m pytest -q`.

Los umbrales, alcance y referencias se explican en Fundamentos y en cada cálculo. Las estimaciones académicas cubren adelgazamiento general y la siguiente UT. La matriz 5 × 5 y las consecuencias son supuestos del caso. El proyecto incorpora y adapta el motor y las herramientas del [repositorio de referencia de la asignatura](https://github.com/bastianAJM1/equipos-estaticos).

