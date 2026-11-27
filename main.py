from pyodide.ffi import create_proxy
from pyscript import window
from eqcalc.api import api

window.pyApi = create_proxy(api)
window.dispatchEvent(window.CustomEvent.new("py-ready"))
