/**
 * Controlador principal de la aplicación web (SPA) para Gestión de Integridad de Equipos Estáticos.
 * Toda la lógica de cálculo de ingeniería se ejecuta en Python (PyScript / Pyodide) vía window.pyApi().
 */
(() => {
  "use strict";

  const STORAGE_KEY = "eq_integrity_project_v1";
  const FAMILIAS = {
    tuberia: "Tubería (ASME B31.3 / API 570)",
    recipiente: "Recipiente (ASME VIII-1 / API 510)",
    tanque: "Tanque (API 650 / API 653)",
  };

  let state = null;       // Datos del proyecto (equipos, cmls, tmls, lecturas, adjuntos)
  let evalData = null;    // Resultado de pyApi("evaluate", ...)
  let catalog = null;     // Catálogo de materiales de pyApi("catalog")
  let verifData = null;   // Resultados de verificación independiente
  let evalHoy = "";       // Fecha de referencia opcional (YYYY-MM-DD)

  // Filtros en memoria para la vista Panel / Equipos
  const filters = { q: "", familia: "", planta: "", estado: "", cell: null };
  let eqSubTab = "resumen";
  let pickCmlId = null;
  let selectedPinCmlId = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n, dec = 2) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("es-CL", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function fmtExp(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const num = Number(n);
    if (num === 0) return "0";
    if (Math.abs(num) >= 0.01 && Math.abs(num) < 10000) return fmt(num, 3);
    return num.toExponential(2);
  }

  function toast(msg, isErr = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.style.background = isErr ? "#991b1b" : "#0f172a";
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function pyCall(op, payloadObj = {}, hoy = "") {
    if (typeof window.pyApi !== "function") {
      throw new Error("El motor Python (Pyodide) aún no está listo.");
    }
    const resStr = window.pyApi(op, JSON.stringify(payloadObj), hoy);
    const data = JSON.parse(resStr);
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data;
  }

  function saveLocal() {
    try {
      const previo = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (previo) {
        const cambios=[];
        for (const tabla of ["equipos","cmls","tmls","lecturas","adjuntos"]) {
          const antes=new Map(previo[tabla].map(r=>[r.id,r]));
          for(const fila of state[tabla]){
            const anterior=antes.get(fila.id);
            if(JSON.stringify(fila)!==JSON.stringify(anterior)){
              const campos=Object.keys(fila).filter(k=>JSON.stringify(fila[k])!==JSON.stringify(anterior?.[k]));
              cambios.push({tabla,id:fila.id,accion:anterior?"edición":"alta",campos});
            }
            antes.delete(fila.id);
          }
          for(const id of antes.keys()) cambios.push({tabla,id,accion:"baja"});
        }
        if(cambios.length)(state.historial ||= []).push({fecha:new Date().toISOString(),cambios});
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("No se pudo guardar en el navegador. Exporta un respaldo JSON.", true);
      throw e;
    }
  }

  function recalc(persist = true) {
    if (!state) return;
    evalData = pyCall("evaluate", state, evalHoy);
    if (persist) saveLocal();
  }

  function validateProject(p) {
    const fields=["equipos","cmls","tmls","lecturas","adjuntos"];
    for(const key of fields){
      if(!Array.isArray(p[key])||p[key].some(x=>!Number.isSafeInteger(x.id)||x.id<1)||new Set(p[key].map(x=>x.id)).size!==p[key].length)throw Error("Identificadores inválidos en "+key);
    }
    for(const [child,parent,field] of [["cmls","equipos","equipo_id"],["tmls","cmls","cml_id"],["lecturas","tmls","tml_id"],["adjuntos","equipos","equipo_id"]]){
      const ids=new Set(p[parent].map(x=>x.id));if(p[child].some(x=>!ids.has(x[field])))throw Error("Referencia ausente en "+child);
    }
    if(p.adjuntos.some(a=>!/^data:image\/(png|jpeg|svg\+xml|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.dataUrl)))throw Error("Imagen de respaldo inválida.");
    const tags=p.equipos.map(e=>String(e.tag||"").trim().toUpperCase());
    if(tags.includes("") || new Set(tags).size!==tags.length)throw Error("TAG vacío o duplicado.");
    for(const c of p.cmls)if(c.adjunto_id!=null && !p.adjuntos.some(a=>a.id===c.adjunto_id && a.equipo_id===c.equipo_id))throw Error("Esquema ajeno al CML.");
    const fechas=new Set();
    for(const l of p.lecturas){
      const clave=l.tml_id+"/"+l.fecha;
      if(!Number.isFinite(Date.parse(l.fecha)) || new Date(l.fecha).toISOString().slice(0,10)!==l.fecha || fechas.has(clave) || l.unidad!=="mm" || !Number.isFinite(l.espesor) || l.espesor<=0)throw Error("Fecha, unidad o espesor inválido.");
      fechas.add(clave);
    }
    p.seq=p.seq||{};for(const [i,key] of fields.entries()){const name=["equipo","cml","tml","lectura","adjunto"][i];p.seq[name]=p[key].reduce((m,x)=>Math.max(m,x.id),Number(p.seq[name])||0)}
  }

  function nextId(key) {
    state.seq = state.seq || {};
    state.seq[key] = (state.seq[key] || 0) + 1;
    return state.seq[key];
  }

  async function loadInitialProject() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.equipos)) {
          state = parsed;
          return;
        }
      } catch (_) { /* fallback to demo.json */ }
    }
    const resp = await fetch("./data/demo.json");
    if (!resp.ok) throw new Error("No se pudo cargar data/demo.json");
    state = await resp.json();
    saveLocal();
  }

  function badgeEstado(estado) {
    const info = evalData?.estados?.[estado];
    const label = info ? info.etiqueta : estado;
    return `<span class="badge s-${esc(estado)}">${esc(label)}</span>`;
  }

  function badgeNivel(nivel) {
    if (!nivel) return "—";
    return `<span class="badge l-${esc(nivel)}">${esc(nivel)}</span>`;
  }

  // -------------------- ROUTER --------------------
  function getRoute() {
    const hash = (location.hash || "#/planta").replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean);
    return { path: parts[0] || "planta", param: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function render() {
    const { path, param } = getRoute();
    $$("#nav a").forEach((a) => {
      a.classList.toggle("on", a.dataset.r === path);
    });
    const app = $("#app");
    try {
      if (path === "planta") renderPlanta(app);
      else if (path === "panel") renderPanel(app);
      else if (path === "equipos" && param) renderEquipoDetail(app, Number(param));
      else if (path === "equipos") renderEquipos(app);
      else if (path === "calc") renderCalc(app);
      else if (path === "verif") renderVerif(app);
      else if (path === "proyeccion") mostrarProyeccion(app, state, evalData, esc, fmt, (eqId,point) => { eqSubTab = "espesores"; location.hash = "#/equipos/" + eqId + "/" + point; });
      else if (path === "proyecto") renderProyecto(app);
      else if (path === "acerca") renderAcerca(app);
      else renderPanel(app);
    } catch (err) {
      app.innerHTML = `<div class="card note bad"><b>Error al renderizar vista:</b> ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  // -------------------- PANEL --------------------
  function renderPlanta(app) {
    const familias = [
      ["tuberia", "Tuberías", "Tramos rectos", "ASME B31.3 · API 570"],
      ["recipiente", "Recipientes", "Envolventes cilíndricas", "ASME VIII-1 · API 510"],
      ["tanque", "Tanques", "Virolas del manto", "API 650 · API 653"]
    ];
    app.innerHTML = `<div class="planta-intro"><div><small>MAN040-B · Proyecto final</small><h1>Atlas de integridad</h1><p>Seleccione un equipo para inspeccionar sus puntos de monitoreo y decidir la próxima campaña.</p></div><a href="#/panel" class="btn ghost">Panel de resultados →</a></div>
      <div class="family-grid">${familias.map(([key,title,geo,codes])=>{
        const equipos=state.equipos.filter(e=>e.familia===key);
        return `<section class="family"><div class="drawing">${croquisFamilia(key)}</div><div class="family-body"><small>${codes}</small><h2>${title}</h2><p>${geo}</p>${equipos.map(e=>`<a class="asset" href="#/equipos/${e.id}"><strong>${esc(e.tag)}</strong><span>${esc(e.descripcion)}</span>↗</a>`).join("") || "Sin equipos registrados"}</div></section>`;
      }).join("")}</div><div class="atlas-links"><a href="#/proyeccion"><b>Proyección de vida</b><span>Historial, umbrales y sensibilidad por punto.</span></a><a href="#/verif"><b>Banco de verificación</b><span>Resultados de referencia y cálculo Python.</span></a><a href="cuaderno.html"><b>Cuaderno de campo</b><span>Plano interactivo y libro local de la Tarea 3.</span></a></div>`;
  }

  function croquisFamilia(key) {
    const dibujo={
      tuberia:'<path d="M18 100l52-28 42 22 66-35V35l25-13 63 34" stroke-width="15"/><path d="M44 77l10 16m68-12 9 16m38-50h19m44-10-10 17" stroke-width="3"/>',
      recipiente:'<ellipse cx="75" cy="65" rx="21" ry="32"/><path d="M75 33h133a21 32 0 0 1 0 64H75m28 0-7 11h24l-5-11m63 0-7 11h24l-5-11m-70-64v-9h15v9m36 0v-9h12v9"/><path d="M100 34v61m80-61v61" stroke-dasharray="3 5"/>',
      tanque:'<ellipse cx="143" cy="36" rx="69" ry="14"/><path d="M74 36v58a69 14 0 0 0 138 0V36m-138 23a69 14 0 0 0 138 0m-138 20a69 14 0 0 0 138 0m-60-56v-7h-14v7m65 36v19m-99-20v19m43 17v14"/>'
    };
    return `<svg viewBox="0 0 285 128" aria-hidden="true"><g stroke="#b2d4dc" stroke-linejoin="round" stroke-linecap="round" fill="none" stroke-width="2">${dibujo[key]}</g></svg>`;
  }

  function renderPanel(app) {
    const res = evalData.resumen || {};
    const estadosOrder = ["bajo_minimo", "vencida", "alerta", "info_insuficiente", "normal"];
    const plantas = [...new Set(state.equipos.map((e) => e.planta).filter(Boolean))];

    const kpisHtml = estadosOrder.map((k) => {
      const info = evalData.estados[k];
      const sel = filters.estado === k ? "sel" : "";
      return `
        <div class="card kpi s-${k} ${sel}" data-estado="${k}">
          <span class="small mut">${esc(info.etiqueta)}</span>
          <b>${res[k] || 0}</b>
        </div>`;
    }).join("");

    // Matriz 5x5
    const cols = ["A", "B", "C", "D", "E"];
    let matrixHtml = `<div class="matrix">`;
    matrixHtml += `<div></div>` + cols.map((c) => `<div class="axis"><b>${c}</b></div>`).join("");
    for (let p = 5; p >= 1; p--) {
      matrixHtml += `<div class="axis"><b>P${p}</b></div>`;
      for (const c of cols) {
        const cell = evalData.matriz.find((m) => m.p === p && m.c === c) || { nivel: "Bajo", tags: [] };
        const isSel = filters.cell && filters.cell.p === p && filters.cell.c === c;
        const tagsHtml = cell.tags.length
          ? cell.tags.map((t) => `<span style="background:rgba(0,0,0,.22);padding:1px 4px;border-radius:3px;margin:1px;display:inline-block">${esc(t)}</span>`).join("")
          : `<span style="opacity:.55">${esc(cell.nivel)}</span>`;
        matrixHtml += `
          <div class="cell l-${esc(cell.nivel)}" data-p="${p}" data-c="${c}"
               style="cursor:pointer;${isSel ? "outline:3px solid #0f172a;z-index:2;" : ""}"
               title="Probabilidad ${p} · Consecuencia ${c} (${cell.nivel})">
            ${tagsHtml}
          </div>`;
      }
    }
    matrixHtml += `</div>
      <div class="small mut" style="margin-top:6px">
        Eje vertical: Probabilidad (1–5) · Eje horizontal: Consecuencia de área (A–E, API 581). Clic en celda para filtrar.
      </div>`;

    // Filtrado de equipos
    const rows = evalData.equipos.filter((ev) => {
      const eq = state.equipos.find((x) => x.id === ev.id);
      if (filters.estado && ev.estado !== filters.estado) return false;
      if (filters.familia && ev.familia !== filters.familia) return false;
      if (filters.planta && eq?.planta !== filters.planta) return false;
      if (filters.cell) {
        if (!ev.rbi || ev.rbi.cat_prob !== filters.cell.p || ev.rbi.cat_cons !== filters.cell.c) return false;
      }
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const text = `${ev.tag} ${eq?.descripcion || ""} ${eq?.circuito || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const tableRows = rows.map((ev) => {
      const eq = state.equipos.find((x) => x.id === ev.id) || {};
      const esp = ev.espesores || {};
      const insp = ev.inspeccion;
      const rbi = ev.rbi || {};
      return `
        <tr class="click" data-id="${ev.id}">
          <td><b>${esc(ev.tag)}</b><div class="small mut">${esc(eq.descripcion)}</div></td>
          <td>${esc(ev.familia)}<div class="small mut">${esc(eq.codigo_servicio || "")}</div></td>
          <td>${badgeEstado(ev.estado)}</td>
          <td class="small">${esc(ev.gobernante || "—")}</td>
          <td class="num">${fmt(esp.medido)} / ${fmt(esp.minimo_admisible)}</td>
          <td class="num">${fmt(ev.cr_adoptada, 3)}</td>
          <td class="num">${ev.vr !== null && ev.vr !== undefined ? fmt(ev.vr, 1) + " a" : "—"}</td>
          <td>${insp ? `${esc(insp.fecha_limite)}<div class="small mut">${insp.dias_restantes} d</div>` : "—"}</td>
          <td>${badgeNivel(rbi.nivel)}<div class="small mut">P${rbi.cat_prob || "?"}-${rbi.cat_cons || "?"} · #${rbi.prioridad_area || "—"}</div></td>
          <td class="num">${rbi.ra !== undefined ? fmt(rbi.ra, 3) : "—"}</td>
          <td class="num">${rbi.re !== undefined ? fmt(rbi.re, 0) : "—"}</td>
        </tr>`;
    }).join("");

    app.innerHTML = `
      <div class="row" style="margin-bottom:12px;align-items:center">
        <div>
          <h1>Panel de Integridad y Riesgo</h1>
          <p class="sub mb0">Proyecto: <b>${esc(state.meta?.nombre || "Sin nombre")}</b> · Fecha de evaluación: <b>${esc(evalData.hoy)}</b></p>
        </div>
        <div style="flex:0 0 180px">
          <label>Fecha de evaluación</label>
          <input type="date" id="hoy-input" value="${esc(evalHoy || evalData.hoy)}">
        </div>
        <button class="btn ghost" id="btn-hoy-reset" style="margin-top:16px">Hoy real</button>
      </div>

      <div class="grid g5">${kpisHtml}</div>
      <details class="card" open><summary><b>Plan consolidado de inspecciones</b></summary><div class="tw"><table><tr><th>Equipo y punto</th><th>Condición</th><th>Intervención</th><th>Fecha objetivo</th></tr>
      ${evalData.plan.map(p=>`<tr><td>${esc(p.tag)} · ${esc(p.punto)}</td><td>${badgeEstado(p.estado)}</td><td>${esc(p.tipo)}<br>${esc(p.accion)}</td><td>${esc(p.fecha || "Por definir")}</td></tr>`).join("")}</table></div></details>

      <div class="grid g2">
        <div class="card">
          <h2>Matriz de Riesgo RBI 5×5 (API RP 581)</h2>
          ${matrixHtml}
        </div>
        <div class="card">
          <h2>Priorización de Intervenciones</h2>
          <p class="small mut">Ordenado por nivel de riesgo (área) y riesgo económico anualizado.</p>
          <div class="tw">
            <table>
              <thead><tr><th># Área</th><th>Tag</th><th>Nivel</th><th class="num">RA [m²/a]</th><th class="num">RE [USD/a]</th><th>Próx. Insp.</th></tr></thead>
              <tbody>
                ${[...evalData.equipos]
                  .filter((e) => e.rbi && e.rbi.prioridad_area)
                  .sort((a, b) => a.rbi.prioridad_area - b.rbi.prioridad_area)
                  .map((e) => `
                    <tr class="click" data-id="${e.id}">
                      <td><b>#${e.rbi.prioridad_area}</b></td>
                      <td><b>${esc(e.tag)}</b></td>
                      <td>${badgeNivel(e.rbi.nivel)}</td>
                      <td class="num">${fmt(e.rbi.ra, 3)}</td>
                      <td class="num">${fmt(e.rbi.re, 0)}</td>
                      <td>${e.inspeccion ? esc(e.inspeccion.fecha_limite) : "—"}</td>
                    </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <div style="flex:2">
            <label>Buscar equipo</label>
            <input type="search" id="f-q" placeholder="Tag, descripción o circuito..." value="${esc(filters.q)}">
          </div>
          <div>
            <label>Familia</label>
            <select id="f-fam">
              <option value="">Todas</option>
              <option value="tuberia" ${filters.familia === "tuberia" ? "selected" : ""}>Tubería</option>
              <option value="recipiente" ${filters.familia === "recipiente" ? "selected" : ""}>Recipiente</option>
              <option value="tanque" ${filters.familia === "tanque" ? "selected" : ""}>Tanque</option>
            </select>
          </div>
          <div>
            <label>Planta</label>
            <select id="f-planta">
              <option value="">Todas</option>
              ${plantas.map((p) => `<option value="${esc(p)}" ${filters.planta === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
            </select>
          </div>
          <button class="btn ghost" id="f-clear">Limpiar filtros</button>
        </div>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Tag / Descripción</th><th>Familia / Norma</th><th>Estado</th><th>CML/TML Gob.</th>
                <th class="num">t_act / t_adm</th><th class="num">CR [mm/a]</th><th class="num">VR</th>
                <th>Próx. Insp.</th><th>Riesgo RBI</th><th class="num">RA [m²/a]</th><th class="num">RE [USD/a]</th>
              </tr>
            </thead>
            <tbody>${tableRows || `<tr><td colspan="11" class="mut">No hay equipos que coincidan con el filtro.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;

    // Event bindings
    $("#hoy-input").onchange = (e) => { evalHoy = e.target.value; recalc(false); render(); };
    $("#btn-hoy-reset").onclick = () => { evalHoy = ""; recalc(false); render(); };
    $$(".kpi", app).forEach((el) => {
      el.onclick = () => {
        const est = el.dataset.estado;
        filters.estado = filters.estado === est ? "" : est;
        render();
      };
    });
    $$(".matrix .cell", app).forEach((el) => {
      el.onclick = () => {
        const p = Number(el.dataset.p), c = el.dataset.c;
        filters.cell = (filters.cell && filters.cell.p === p && filters.cell.c === c) ? null : { p, c };
        render();
      };
    });
    $("#f-q").oninput = (e) => { filters.q = e.target.value; render(); };
    $("#f-fam").onchange = (e) => { filters.familia = e.target.value; render(); };
    $("#f-planta").onchange = (e) => { filters.planta = e.target.value; render(); };
    $("#f-clear").onclick = () => {
      filters.q = ""; filters.familia = ""; filters.planta = ""; filters.estado = ""; filters.cell = null;
      render();
    };
    $$("tr.click", app).forEach((tr) => {
      tr.onclick = () => { location.hash = `#/equipos/${tr.dataset.id}`; };
    });
  }

  // -------------------- LISTA Y CREACIÓN DE EQUIPOS --------------------
  function renderEquipos(app) {
    app.innerHTML = `
      <div class="row" style="margin-bottom:14px;align-items:center">
        <div>
          <h1>Inventario de Equipos Estáticos</h1>
          <p class="sub mb0">Gestión de activos bajo API 510, API 570 y API 653.</p>
        </div>
        <button class="btn" id="btn-new-eq">+ Nuevo equipo</button>
      </div>
      <div id="new-eq-box" class="card" hidden></div>
      <div class="card">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Tag</th><th>Descripción</th><th>Planta / Área</th><th>Familia</th>
                <th>Material</th><th>Estado</th><th class="num">t_med [mm]</th><th class="num">t_adm [mm]</th>
                <th>Próx. Insp.</th><th>Riesgo</th>
              </tr>
            </thead>
            <tbody>
              ${evalData.equipos.map((ev) => {
                const eq = state.equipos.find((x) => x.id === ev.id) || {};
                return `
                  <tr class="click" data-id="${ev.id}">
                    <td><b>${esc(ev.tag)}</b></td>
                    <td>${esc(eq.descripcion)}</td>
                    <td class="small">${esc(eq.planta || "")} · ${esc(eq.area || "")}</td>
                    <td>${esc(ev.familia)}</td>
                    <td>${esc(eq.material)}</td>
                    <td>${badgeEstado(ev.estado)}</td>
                    <td class="num">${fmt(ev.espesores?.medido)}</td>
                    <td class="num">${fmt(ev.espesores?.minimo_admisible)}</td>
                    <td>${ev.inspeccion ? esc(ev.inspeccion.fecha_limite) : "—"}</td>
                    <td>${badgeNivel(ev.rbi?.nivel)}</td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    $$("tr.click", app).forEach((tr) => {
      tr.onclick = () => { location.hash = `#/equipos/${tr.dataset.id}`; };
    });

    $("#btn-new-eq").onclick = () => {
      const box = $("#new-eq-box");
      box.hidden = !box.hidden;
      if (!box.hidden) renderNewEquipoForm(box);
    };
  }

  function renderNewEquipoForm(box) {
    const matOpts = Object.keys(catalog || {}).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    box.innerHTML = `
      <h2>Registrar nuevo equipo estático</h2>
      <div class="grid g3">
        <div><label>Tag *</label><input id="ne-tag" placeholder="Ej: V-305"></div>
        <div><label>Descripción</label><input id="ne-desc" placeholder="Ej: Tambor separador"></div>
        <div>
          <label>Familia *</label>
          <select id="ne-fam">
            <option value="tuberia">Tubería (ASME B31.3 / API 570)</option>
            <option value="recipiente">Recipiente (ASME VIII-1 / API 510)</option>
            <option value="tanque">Tanque (API 650 / API 653)</option>
          </select>
        </div>
        <div><label>Planta</label><input id="ne-planta" value="Planta Demo"></div>
        <div><label>Área</label><input id="ne-area" value="Área 10 – Proceso"></div>
        ${[["sistema","Sistema"],["componente","Componente"],["servicio","Servicio"],["fluido","Fluido"],["circuito","Circuito (tubería)"]].map(([id,t])=>`<div><label>${t}<input id="ne-${id}"></label></div>`).join("")}
          <div><label>Presión de operación (MPa)<input id="ne-pop" type="number" step="any"></label></div><div><label>Temperatura de operación (°C)<input id="ne-top" type="number" step="any"></label></div>
          <div><label>Material</label><select id="ne-mat">${matOpts}</select></div>
        <div><label>Temp. diseño [°C]</label><input id="ne-temp" type="number" step="any" value="150"></div>
        <div><label>Presión diseño [MPa]</label><input id="ne-pres" type="number" step="any" value="1.5"></div>
        <div><label>Espesor nominal [mm]</label><input id="ne-tnom" type="number" step="any" value="12.0"></div>
        <div><label>Corrosión admisible CA [mm]</label><input id="ne-ca" type="number" step="any" value="1.5"></div>
        <div><label>Eficiencia de junta E</label><input id="ne-e" type="number" step="any" value="0.85"></div>
        <div><label>Fecha instalación</label><input id="ne-finst" type="date" value="2020-01-01"></div>
      </div>
      <div id="ne-fam-extra" class="grid g3" style="margin-top:10px"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="ne-save">Guardar equipo</button>
        <button class="btn ghost" id="ne-cancel">Cancelar</button>
      </div>
    `;

    const drawExtra = () => {
      const fam = $("#ne-fam").value;
      const ex = $("#ne-fam-extra");
      $("#ne-mat").replaceChildren(...Object.keys(catalog).filter(m=>catalog[m].familia===fam).map(m=>new Option(m,m)));
      $("#ne-temp").value = fam==="tanque" ? 60 : 150;
      if (fam === "tuberia") {
        ex.innerHTML = `
          <div><label>Diámetro exterior D [mm]</label><input id="ne-dext" type="number" step="any" value="219.1"></div>
          <div><label>Clase API 570</label><select id="ne-cl"><option value="1">Clase 1 (5 a)</option><option value="2" selected>Clase 2 (10 a)</option><option value="3">Clase 3 (10 a)</option></select></div>
          <div><label>Tolerancia fab. [%]</label><input id="ne-tol" type="number" step="any" value="12.5"></div>`;
      } else if (fam === "recipiente") {
        ex.innerHTML = `
          <div><label>Diámetro interior Di [mm]</label><input id="ne-dint" type="number" step="any" value="1500"></div>
          <div><label>Plazo intervención [años]</label><input id="ne-plazo" type="number" step="any" value="2.0"></div>`;
      } else {
        ex.innerHTML = `
          <div><label>Diámetro tanque D [m]</label><input id="ne-dtank" type="number" step="any" value="20"></div>
          <div><label>Nivel máx. líquido H [m]</label><input id="ne-htank" type="number" step="any" value="12"></div>
          <div><label>Gravedad específica G</label><input id="ne-g" type="number" step="any" value="0.85"></div>`;
      }
    };
    $("#ne-fam").onchange = drawExtra;
    drawExtra();

    $("#ne-cancel").onclick = () => { box.hidden = true; };
    $("#ne-save").onclick = () => {
      const tag = $("#ne-tag").value.trim();
      if (state.equipos.some(e=>e.tag.toLowerCase()===tag.toLowerCase())) return toast("El TAG ya existe.",true);
      if (!tag) return toast("Ingresa un Tag válido.", true);
      const fam = $("#ne-fam").value;
      const id = nextId("equipo");
      const eq = {
        id, tag,
        descripcion: $("#ne-desc").value.trim() || "Equipo estático",
        familia: fam,
        planta: $("#ne-planta").value.trim() || "Planta",
        area: $("#ne-area").value.trim() || "Área",
        sistema: $("#ne-sistema").value.trim(), servicio: $("#ne-servicio").value.trim(), fluido: $("#ne-fluido").value.trim(), circuito: fam==="tuberia" ? $("#ne-circuito").value.trim() : "", p_oper:$("#ne-pop").value===""?null:Number($("#ne-pop").value), temp_oper:$("#ne-top").value===""?null:Number($("#ne-top").value),
        componente: $("#ne-componente").value.trim(),
        material: $("#ne-mat").value,
        codigo_diseno: fam === "tuberia" ? "ASME B31.3" : (fam === "recipiente" ? "ASME VIII Div.1" : "API 650"),
        codigo_servicio: fam === "tuberia" ? "API 570" : (fam === "recipiente" ? "API 510" : "API 653"),
        temp_diseno: Number($("#ne-temp").value),
        p_diseno: fam === "tanque" ? 0 : Number($("#ne-pres").value),
        espesor_nominal: Number($("#ne-tnom").value),
        ca: Number($("#ne-ca").value),
        e_junta: Number($("#ne-e").value),
        tol_fabricacion: fam === "tuberia" ? Number($("#ne-tol").value) : 0,
        t_estructural: fam === "tanque" ? 2.5 : 0,
        fecha_instalacion: $("#ne-finst").value,
        plazo_intervencion: fam === "recipiente" ? Number($("#ne-plazo").value) : 2.0,
        cr_asumida: 0.2,
        rbi: {
          moneda: "USD",
          base_valoracion: "Valor académico estimado",
          escenario: "Pérdida de contención por adelgazamiento general",
          confianza: "media",
          score_gestion: 50,
          eficacia_defecto: "C",
          base_espesor: "medido",
          eficacias: {},
          ca_m2: 100,
          ce: 150000,
        },
      };
      if (fam === "tuberia") {
        eq.diametro_ext = Number($("#ne-dext").value);
        eq.clase_570 = Number($("#ne-cl").value);
      } else if (fam === "recipiente") {
        eq.diametro_int = Number($("#ne-dint").value);
      } else {
        eq.diametro = Number($("#ne-dtank").value);
        if($("#ed-prueba").value==="")delete eq.nivel_prueba;else eq.nivel_prueba=Number($("#ed-prueba").value);
        eq.nivel_diseno = Number($("#ne-htank").value);
        eq.g_esp = Number($("#ne-g").value);
        eq.cursos = [
          { n: 1, h_base: 0, altura: 2.4, t_nominal: Number($("#ne-tnom").value) },
          { n: 2, h_base: 2.4, altura: 2.4, t_nominal: Math.max(6, Number($("#ne-tnom").value) - 2) },
        ];
      }
      const prueba=pyCall("evaluate",{equipos:[eq],cmls:[],tmls:[],lecturas:[]});
      if(prueba.equipos[0].errores.length)return toast(prueba.equipos[0].errores.join(" "),true);
      state.equipos.push(eq);
      recalc();
      toast(`Equipo ${tag} creado.`);
      location.hash = `#/equipos/${id}`;
    };
  }

  // -------------------- DETALLE DE EQUIPO --------------------
  function renderEquipoDetail(app, eqId) {
    const eq = state.equipos.find((x) => x.id === eqId);
    const ev = evalData.equipos.find((x) => x.id === eqId);
    if (!eq || !ev) {
      app.innerHTML = `<div class="card note bad">Equipo no encontrado. <a href="#/equipos">Volver</a></div>`;
      return;
    }

    const tabs = [
      { id: "resumen", label: "Resumen e Inspección" },
      { id: "espesores", label: "CML / TML e Historial" },
      { id: "esquema", label: "Esquema / Isométrico" },
      { id: "rbi", label: "RBI Cuantitativo (API 581)" },
      { id: "editar", label: "Parámetros de Diseño" },
    ];

    app.innerHTML = `
      <div class="row" style="margin-bottom:10px;align-items:center">
        <div>
          <div class="small mut">${esc(eq.planta)} › ${esc(eq.area)} › ${esc(eq.sistema)}</div>
          <h1 style="display:flex;align-items:center;gap:10px">
            ${esc(eq.tag)} ${badgeEstado(ev.estado)}
          </h1>
          <p class="sub mb0">${esc(eq.descripcion)} · ${esc(FAMILIAS[eq.familia] || eq.familia)}</p>
        </div>
        <button class="btn ghost" onclick="location.hash='#/equipos'">← Volver</button>
        <button class="btn danger" id="btn-del-eq">Eliminar equipo</button>
      </div>

      <div class="tabs">
        ${tabs.map((t) => `<a href="javascript:void(0)" class="${eqSubTab === t.id ? "on" : ""}" data-tab="${t.id}">${esc(t.label)}</a>`).join("")}
      </div>

      <div id="eq-tab-body"></div>
    `;

    $$(".tabs a", app).forEach((a) => {
      a.onclick = () => {
        eqSubTab = a.dataset.tab;
        pickCmlId = null;
        renderEquipoDetail(app, eqId);
      };
    });

    $("#btn-del-eq").onclick = () => {
      if (!confirm(`¿Eliminar el equipo ${eq.tag} y todas sus mediciones?`)) return;
      const cmlIds = new Set(state.cmls.filter((c) => c.equipo_id === eqId).map((c) => c.id));
      const tmlIds = new Set(state.tmls.filter((t) => cmlIds.has(t.cml_id)).map((t) => t.id));
      state.lecturas = state.lecturas.filter((l) => !tmlIds.has(l.tml_id));
      state.tmls = state.tmls.filter((t) => !tmlIds.has(t.id));
      state.cmls = state.cmls.filter((c) => c.equipo_id !== eqId);
      state.adjuntos = (state.adjuntos || []).filter((a) => a.equipo_id !== eqId);
      state.equipos = state.equipos.filter((e) => e.id !== eqId);
      recalc();
      toast(`Equipo ${eq.tag} eliminado.`);
      location.hash = "#/equipos";
    };

    const body = $("#eq-tab-body");
    if (eqSubTab === "resumen") renderEqResumen(body, eq, ev);
    else if (eqSubTab === "espesores") renderEqEspesores(body, eq, ev);
    else if (eqSubTab === "esquema") renderEqEsquema(body, eq, ev);
    else if (eqSubTab === "rbi") renderEqRbi(body, eq, ev);
    else if (eqSubTab === "editar") renderEqEditar(body, eq, ev);
  }

  function renderEqResumen(body, eq, ev) {
    const esp = ev.espesores || {};
    const req = ev.requerido || {};
    const insp = ev.inspeccion;
    const rbi = ev.rbi || {};

    body.innerHTML = `
      ${ev.errores?.length ? `<div class="card note bad"><b>Errores:</b><ul>${ev.errores.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${ev.avisos?.length ? `<div class="card note warn"><b>Avisos del motor:</b><ul>${ev.avisos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}

      <div class="card"><h2>Ficha de servicio</h2><p>${[eq.planta,eq.area,eq.sistema,eq.componente].filter(Boolean).map(esc).join(" › ")}</p><p>${esc(eq.servicio)} · ${esc(eq.fluido)} · ${esc(eq.material)} ${eq.circuito?" · "+esc(eq.circuito):""}</p><p>Operación: ${fmt(eq.p_oper)} MPa y ${fmt(eq.temp_oper,1)} °C. Diseño: ${fmt(eq.p_diseno)} MPa y ${fmt(eq.temp_diseno,1)} °C.</p></div>
      <div class="grid g4">
        <div class="card"><span class="small mut">Espesor nominal</span><h2>${fmt(esp.nominal)} mm</h2></div>
        <div class="card"><span class="small mut">Mínimo admisible (t_adm)</span><h2>${fmt(esp.minimo_admisible)} mm</h2></div>
        <div class="card"><span class="small mut">Último medido (gobernante)</span><h2>${fmt(esp.medido)} mm</h2><span class="small mut">${esc(ev.gobernante || "—")}</span></div>
        <div class="card"><span class="small mut">Espesor de alerta</span><h2>${fmt(esp.alerta)} mm</h2><span class="small mut">Plazo: ${fmt(esp.plazo_intervencion, 1)} a</span></div>
      </div>

      <div class="grid g2">
        <div class="card">
          <h2>Próxima Inspección (Medición de Espesores)</h2>
          ${insp ? `
            <table>
              <tr><th>Norma aplicable</th><td>${esc(insp.norma)}</td></tr>
              <tr><th>Tipo</th><td>${esc(insp.tipo)}</td></tr>
              <tr><th>TML gobernante</th><td><b>${esc(insp.tml)}</b></td></tr>
              <tr><th>Última medición</th><td>${esc(insp.fecha_ref)}</td></tr>
              <tr><th>Intervalo calculado</th><td><b>${fmt(insp.intervalo_anios, 2)} años</b></td></tr>
              <tr><th>Fecha límite</th><td><b>${esc(insp.fecha_limite)}</b> (${insp.dias_restantes} días)</td></tr>
              <tr><th>Criterio gobernante</th><td class="small">${esc(insp.criterio)}</td></tr>
            </table>
          ` : `<p class="mut">Sin datos suficientes para programar inspección.</p>`}
        </div>

        <div class="card">
          <h2>Diseño y Cálculo de t_min</h2>
          <p class="small mut">${esc(req.norma_diseno)} · ${esc(req.norma_servicio)}</p>
          <div class="eq">${esc(req.ecuacion || "—")}</div><p>${(req.entradas||[]).map(x=>esc(x.nombre)+" = "+fmt(x.valor,3)+" "+esc(x.unidad)).join(" · ")}</p>
          <table>
            <tr><th>Material / S(T)</th><td>${esc(eq.material)} · ${fmt(req.S, 1)} MPa (a ${eq.temp_diseno} °C)</td></tr>
            <tr><th>Eficiencia junta (E)</th><td>${fmt(req.E, 2)}</td></tr>
            <tr><th>Corrosión admisible (CA)</th><td>${fmt(req.CA, 2)} mm</td></tr>
            <tr><th>${eq.familia==="tanque"?"Espesor requerido de fabricación":"t_req (sin CA)"}</th><td><b>${fmt(req.t_req, 3)} mm</b></td></tr>
            <tr><th>t_dis (con CA)</th><td>${fmt(req.t_dis_api650 ?? req.t_dis, 3)} mm</td></tr>
          </table>
          ${req.notas?.length ? `<div class="note small">${req.notas.map((n) => esc(n)).join("<br>")}</div>` : ""}
        </div>
      </div>

      <div class="card">
        <h2>Resumen RBI (API RP 581)</h2>
        ${rbi.df == null ? `<div class="note bad">${esc(rbi.error || "Sin componente evaluable.")}</div>` : `
          <div class="grid g4">
            <div><span class="small mut">Nivel de Riesgo</span><div>${badgeNivel(rbi.nivel)} (P${rbi.cat_prob}-${rbi.cat_cons})</div></div>
            <div><span class="small mut">Factor de daño (Df)</span><div><b>${fmt(rbi.df, 2)}</b></div></div>
            <div><span class="small mut">Riesgo de área (RA)</span><div><b>${fmt(rbi.ra, 3)} m²/año</b> (Prioridad #${rbi.prioridad_area})</div></div>
            <div><span class="small mut">Riesgo económico (RE)</span><div><b>${fmt(rbi.re, 0)} ${esc(rbi.moneda)}/año</b> (Prioridad #${rbi.prioridad_economica})</div></div>
          </div>
        `}
      </div>
    `;
  }

  function renderEqEspesores(body, eq, ev) {
    const misCmls = state.cmls.filter((c) => c.equipo_id === eq.id);
    const excluidos=misCmls.flatMap(c=>state.tmls.filter(t=>t.cml_id===c.id && !ev.tmls.some(p=>p.tml_id===t.id)).map(t=>({tml_id:t.id,tml:t.codigo,cml:c.codigo,estado:"info_insuficiente"})));
    const tmlRows = [...ev.tmls,...excluidos].map((t) => {
      const lects = state.lecturas
        .filter((l) => l.tml_id === t.tml_id)
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
      return `
        <tr>
          <td><b>${esc(t.cml)}</b>${t.curso ? `<div class="small mut">Virola ${t.curso}</div>` : ""}</td>
          <td><b>${esc(t.tml)}</b></td>
          <td>${badgeEstado(t.estado)}</td>
          <td class="num"><b>${fmt(t.t_med)}</b><div class="small mut">${esc(t.fecha_ult || "")}</div></td>
          <td class="num">${fmt(t.t_adm)}</td>
          <td class="num">${fmt(t.cr_corto, 3)}</td>
          <td class="num">${fmt(t.cr_largo, 3)}</td>
          <td class="num"><b>${fmt(t.cr_adoptada, 3)}</b></td>
          <td class="num">${t.vr !== null && t.vr !== undefined ? fmt(t.vr, 1) + " a" : "—"}</td>
          <td class="small">
            ${lects.map((l) => `
              <span style="display:inline-flex;align-items:center;gap:4px;background:#f1f5f9;padding:2px 6px;border-radius:4px;margin:2px">
                ${esc(l.fecha)}: <b>${fmt(l.espesor)}</b> mm ${l.evento ? `<i>(${esc(l.evento)})</i>` : ""}
                <a href="javascript:void(0)" class="del-lect" data-lid="${l.id}" style="color:#dc2626;text-decoration:none" title="Eliminar lectura">×</a>
              </span>`).join("")}
          </td>
        </tr>`;
    }).join("");

    // SVG chart of thickness history
    const chartSvg = buildThicknessChartSvg(eq, ev);

    const tmlOpts = misCmls.flatMap((c) =>
      state.tmls.filter((t) => t.cml_id === c.id).map((t) => `<option value="${t.id}">${esc(c.codigo)} / ${esc(t.codigo)}</option>`)
    ).join("");

    body.innerHTML = `
      <div class="card">
        <h2>Evolución histórica de espesores</h2>
        ${chartSvg}
      </div>

      <div class="card">
        <h2>Puntos de Monitoreo (CML / TML)</h2>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>CML</th><th>TML</th><th>Estado</th><th class="num">t_act [mm]</th><th class="num">t_adm [mm]</th>
                <th class="num">CR corto</th><th class="num">CR largo</th><th class="num">CR gob.</th>
                <th class="num">VR</th><th>Lecturas históricas</th>
              </tr>
            </thead>
            <tbody>${tmlRows || `<tr><td colspan="10" class="mut">No hay TMLs registrados.</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="grid g2">
        <div class="card">
          <h2>Registrar nueva medición de espesor</h2>
          ${tmlOpts ? `
            <div class="grid g2">
              <div><label>CML / TML</label><select id="add-l-tml">${tmlOpts}</select></div>
              <div><label>Fecha</label><input id="add-l-fecha" type="date" value="${esc(evalData.hoy)}"></div>
              <div><label>Espesor medido [mm]</label><input id="add-l-esp" type="number" step="0.01" value="8.0"></div>
              <div><label>Técnica</label><select id="add-l-tec"><option>UT</option><option>RT</option><option>EMAT</option></select></div>
              <div>
                <label>Evento de reinicio</label>
                <select id="add-l-ev">
                  <option value="">Medición normal</option>
                  <option value="cambio_punto">Cambio de punto (reinicia serie)</option><option value="reemplazo">Reemplazo (reinicia serie)</option>
                  <option value="cambio_servicio">Cambio de servicio</option><option value="reparacion">Reparación (reinicia serie)</option>
                </select>
              </div>
              <div><label>Incertidumbre UT ± mm</label><input type="number" min="0" step="any" id="inc-ut"></div><div><label>Observaciones</label><input id="add-l-obs" placeholder="Opcional"></div>
            </div>
            <button class="btn" id="btn-add-lect" style="margin-top:10px">+ Agregar lectura</button>
          ` : `<p class="mut">Primero crea un CML y TML.</p>`}
        </div>

        <div class="card">
          <h2>Agregar CML / TML</h2>
          <div class="grid g2">
            <div><label>Código CML</label><input id="add-c-cod" placeholder="Ej: CML-04"></div>
            <div><label>Componente</label><select id="add-c-comp">${(eq.familia==="tuberia"?["Tramo recto","Codo","Otro"]:eq.familia==="recipiente"?["Envolvente","Cabezal","Otro"]:["Virola","Fondo","Otro"]).map(g=>`<option>${g}</option>`).join("")}</select></div>
            <div><label>Ubicación</label><input id="add-c-ubic" placeholder="Ej: Zona inferior"></div>
            ${eq.familia === "tanque" ? `<div><label>Virola (Curso)</label><input id="add-c-curso" type="number" min="1" max="10" value="1"></div>` : ""}
            <div><label>Código primer TML</label><input id="add-t-cod" value="T1"></div>
            <div><label>Posición TML</label><input id="add-t-pos" placeholder="Ej: 12 en punto"></div>
          </div>
          <button class="btn" id="btn-add-cml" style="margin-top:10px">+ Crear CML y TML</button>
        </div>
      </div>
    `;

    $$(".del-lect", body).forEach((a) => {
      a.onclick = () => {
        const lid = Number(a.dataset.lid);
        if(!confirm("¿Eliminar esta lectura registrada?"))return;
        state.lecturas = state.lecturas.filter((l) => l.id !== lid);
        recalc();
        toast("Lectura eliminada.");
        renderEquipoDetail($("#app"), eq.id);
      };
    });

    const btnLect = $("#btn-add-lect", body);
    const requested=Number(location.hash.split("/")[3]);
    if(requested && tmlOpts && [...$("#add-l-tml").options].some(t=>Number(t.value)===requested))$("#add-l-tml").value=String(requested);
    if (btnLect) {
      btnLect.onclick = () => {
        const tml_id = Number($("#add-l-tml").value);
        const fecha = $("#add-l-fecha").value;
        const espesor = Number($("#add-l-esp").value);
        if (fecha > new Date().toISOString().slice(0,10) || state.lecturas.some(l => l.tml_id === tml_id && l.fecha === fecha)) return toast("Usa una fecha única del punto y anterior o igual a hoy.", true);
        if (!fecha || !Number.isFinite(espesor) || espesor <= 0) return toast("Datos de lectura inválidos.", true);
        const u=$("#inc-ut").value;
        if(fecha<eq.fecha_instalacion || !$("#inc-ut").checkValidity())return toast("Comprueba la fecha de instalación y la incertidumbre.",true);
        state.lecturas.push({
          ...(u ? {incertidumbre_mm:Number(u)} : {}),
          id: nextId("lectura"),
          tml_id,
          fecha,
          espesor,
          unidad: "mm",
          tecnica: $("#add-l-tec").value,
          evento: $("#add-l-ev").value,
          obs: $("#add-l-obs").value.trim(),
        });
        recalc();
        toast("Lectura agregada y recalculada.");
        renderEquipoDetail($("#app"), eq.id);
      };
    }

    $("#btn-add-cml", body).onclick = () => {
      const codigo = $("#add-c-cod").value.trim();
      if (!codigo) return toast("Ingresa un código de CML.", true);
      if(misCmls.some(c=>c.codigo.toUpperCase()===codigo.toUpperCase()))return toast("Código CML duplicado.",true);
      if(eq.familia==="tanque" && !eq.cursos.some(c=>c.n===Number($("#add-c-curso").value)))return toast("Virola inexistente.",true);
      const cmlId = nextId("cml");
      const cursoEl = $("#add-c-curso");
      state.cmls.push({
        id: cmlId,
        equipo_id: eq.id,
        codigo,
        componente: $("#add-c-comp").value.trim() || "General",
        ubicacion: $("#add-c-ubic").value.trim() || "",
        curso: cursoEl ? Number(cursoEl.value) : null,
        adjunto_id: null, x: null, y: null,
      });
      state.tmls.push({
        id: nextId("tml"),
        cml_id: cmlId,
        codigo: $("#add-t-cod").value.trim() || "T1",
        posicion: $("#add-t-pos").value.trim() || "",
      });
      recalc();
      toast(`CML ${codigo} creado.`);
      renderEquipoDetail($("#app"), eq.id);
    };
  }

  function buildThicknessChartSvg(eq, ev) {
    const misTmls = ev.tmls || [];
    const series = [];
    const colors = ["#0369a1", "#16a34a", "#9333ea", "#d97706", "#0891b2", "#be123c"];
    let minT = Infinity, maxT = -Infinity, minD = Infinity, maxD = -Infinity;

    misTmls.forEach((t, idx) => {
      const lects = state.lecturas
        .filter((l) => l.tml_id === t.tml_id)
        .map((l) => ({ date: l.fecha, ms: Date.parse(l.fecha), y: Number(l.espesor) }))
        .sort((a, b) => a.ms - b.ms);
      if (!lects.length) return;
      lects.forEach((p) => {
        minT = Math.min(minT, p.y);
        maxT = Math.max(maxT, p.y);
        minD = Math.min(minD, p.ms);
        maxD = Math.max(maxD, p.ms);
      });
      series.push({ label: `${t.cml}/${t.tml}`, color: colors[idx % colors.length], pts: lects });
    });

    if (!series.length) return `<p class="mut">Sin lecturas suficientes para graficar.</p>`;

    const tAdm = ev.espesores?.minimo_admisible;
    const tAlerta = ev.espesores?.alerta;
    if (tAdm) minT = Math.min(minT, tAdm * 0.9);
    if (tAlerta) maxT = Math.max(maxT, tAlerta * 1.05);
    if (minD === maxD) { minD -= 86400000 * 365; maxD += 86400000 * 365; }
    const padT = Math.max((maxT - minT) * 0.12, 0.5);
    minT = Math.max(0, minT - padT);
    maxT = maxT + padT;

    const W = 760, H = 240, L = 54, R = 20, T = 16, B = 32;
    const sx = (ms) => L + ((ms - minD) / (maxD - minD)) * (W - L - R);
    const sy = (y) => T + (1 - (y - minT) / (maxT - minT)) * (H - T - B);

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:780px;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">`;
    // Grid horizontal
    for (let i = 0; i <= 4; i++) {
      const val = minT + ((maxT - minT) * i) / 4;
      const y = sy(val);
      svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#f1f5f9" />`;
      svg += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${val.toFixed(1)}</text>`;
    }
    // Reference lines
    if (tAdm) {
      const ya = sy(tAdm);
      svg += `<line x1="${L}" y1="${ya}" x2="${W - R}" y2="${ya}" stroke="#dc2626" stroke-dasharray="5 4" stroke-width="1.5"/>`;
      svg += `<text x="${W - R - 4}" y="${ya - 4}" text-anchor="end" font-size="11" fill="#dc2626">t_adm = ${tAdm.toFixed(2)} mm</text>`;
    }
    if (tAlerta) {
      const yw = sy(tAlerta);
      svg += `<line x1="${L}" y1="${yw}" x2="${W - R}" y2="${yw}" stroke="#d97706" stroke-dasharray="3 3" stroke-width="1.2"/>`;
      svg += `<text x="${W - R - 4}" y="${yw - 4}" text-anchor="end" font-size="11" fill="#d97706">t_alerta = ${tAlerta.toFixed(2)} mm</text>`;
    }
    // Series
    series.forEach((s) => {
      const d = s.pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.ms).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"/>`;
      s.pts.forEach((p) => {
        svg += `<circle cx="${sx(p.ms).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" fill="${s.color}"><title>${s.label}: ${p.y} mm (${p.date})</title></circle>`;
      });
    });
    // X axis labels
    const d0 = new Date(minD).toISOString().slice(0, 10);
    const d1 = new Date(maxD).toISOString().slice(0, 10);
    svg += `<text x="${L}" y="${H - 8}" font-size="11" fill="#64748b">${d0}</text>`;
    svg += `<text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="#64748b">${d1}</text>`;
    svg += `</svg>`;

    const legend = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12px"><span style="width:10px;height:10px;border-radius:50%;background:${s.color}"></span>${esc(s.label)}</span>`).join("");
    return `${svg}<div style="margin-top:6px">${legend}</div>`;
  }

  function renderEqEsquema(body, eq, ev) {
    const adjuntos = (state.adjuntos || []).filter((a) => a.equipo_id === eq.id);
    const misCmls = state.cmls.filter((c) => c.equipo_id === eq.id);
    const adj = adjuntos[0] || null;

    const pinsHtml = adj ? misCmls.filter((c) => c.adjunto_id === adj.id && c.x !== null && c.y !== null).map((c) => {
      const sel = selectedPinCmlId === c.id ? "sel" : "";
      return `<div class="pin ${sel}" data-cid="${c.id}" style="left:${c.x}%;top:${c.y}%;cursor:pointer">${esc(c.codigo)}</div>`;
    }).join("") : "";

    const selCml = misCmls.find((c) => c.id === selectedPinCmlId);
    const selTmls = selCml ? ev.tmls.filter((t) => t.cml_id === selCml.id) : [];

    body.innerHTML = `
      <div class="card">
        <div class="row" style="margin-bottom:10px;align-items:center">
          <div>
            <h2 class="mb0">Esquema / Isométrico y Ubicación de CMLs</h2>
            <span class="small mut">${adj ? esc(adj.nombre) : "Sin esquema cargado"}</span>
          </div>
          <div style="flex:0 0 auto">
            <label class="btn ghost sm" style="display:inline-block;cursor:pointer">
              Subir imagen / SVG
              <input type="file" id="up-schem" accept="image/*,.svg" hidden>
            </label>
          </div>
        </div>

        ${adj ? `
          <div class="row" style="margin-bottom:10px">
            <div style="flex:2">
              <label>Ubicar CML en el plano (selecciona y haz clic en el esquema)</label>
              <select id="pick-cml-sel">
                <option value="">— Modo solo lectura —</option>
                ${misCmls.map((c) => `<option value="${c.id}" ${pickCmlId === c.id ? "selected" : ""}>${esc(c.codigo)} (${esc(c.componente)})</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="schem ${pickCmlId ? "pick" : ""}" id="schem-box">
            <img src="${esc(adj.dataUrl)}" alt="${esc(adj.nombre)}">
            ${pinsHtml}
          </div>
        ` : `<p class="mut">Este equipo aún no tiene un esquema o isométrico adjunto. Sube una imagen o SVG arriba.</p>`}

        ${selCml ? `
          <div class="note" style="margin-top:12px">
            <b>${esc(selCml.codigo)}</b> — ${esc(selCml.componente)} (${esc(selCml.ubicacion)})
            ${selTmls.map((t) => `<div><a href="#/proyeccion/${eq.id}/${t.tml_id}">${esc(t.tml)} · Proyectar</a> ${badgeEstado(t.estado)} · t_med = ${fmt(t.t_med)} mm · CR = ${fmt(t.cr_adoptada, 3)} mm/a</div>`).join("")}
          </div>
        ` : ""}
      </div>
    `;

    $("#up-schem", body).onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.adjuntos = (state.adjuntos || []).filter((a) => a.equipo_id !== eq.id);
        state.adjuntos.push({
          id: nextId("adjunto"),
          equipo_id: eq.id,
          nombre: file.name,
          tipo: file.type.includes("svg") ? "svg" : "img",
          dataUrl: reader.result,
        });
        recalc();
        toast("Esquema cargado.");
        renderEquipoDetail($("#app"), eq.id);
      };
      reader.readAsDataURL(file);
    };

    const selEl = $("#pick-cml-sel", body);
    if (selEl) {
      selEl.onchange = (e) => {
        pickCmlId = e.target.value ? Number(e.target.value) : null;
        renderEquipoDetail($("#app"), eq.id);
      };
    }

    const box = $("#schem-box", body);
    if (box) {
      box.onclick = (e) => {
        if (!pickCmlId) return;
        const rect = box.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
        const cml = state.cmls.find((c) => c.id === pickCmlId);
        if (cml) {
          cml.adjunto_id = adj.id;
          cml.x = Math.max(0, Math.min(100, x));
          cml.y = Math.max(0, Math.min(100, y));
          pickCmlId = null;
          selectedPinCmlId = cml.id;
          recalc();
          toast(`Ubicación guardada para ${cml.codigo}.`);
          renderEquipoDetail($("#app"), eq.id);
        }
      };
    }

    $$(".pin", body).forEach((p) => {
      p.onclick = (e) => {
        if (pickCmlId) return;
        e.stopPropagation();
        selectedPinCmlId = Number(p.dataset.cid);
        renderEquipoDetail($("#app"), eq.id);
      };
    });
  }

  function renderEqRbi(body, eq, ev) {
    const r = ev.rbi || {};
    const cfg = eq.rbi || {};
    const fechas=(ev.tmls.find(t=>t.tml_id===ev.gobernante_ref?.tml_id)?.serie_comparable||[]).map(l=>l.fecha);
    body.innerHTML = (r.df == null ? `<p class="card note warn">${esc(r.error || "Sin punto evaluable para RBI.")}</p>` : `
      <div class="grid g4">
        <div class="card"><span class="small mut">Categoría / Nivel</span><h2>${badgeNivel(r.nivel)}</h2><span class="small mut">P${r.cat_prob} · Cons. ${r.cat_cons}</span></div>
        <div class="card"><span class="small mut">Factor de Daño Df</span><h2>${fmt(r.df, 2)}</h2><span class="small mut">Df base = ${fmt(r.df_base, 2)}</span></div>
        <div class="card"><span class="small mut">Frecuencia Falla f_F</span><h2>${fmtExp(r.ff)} /a</h2><span class="small mut">gff = ${fmtExp(r.gff)} · Fms = ${fmt(r.fms, 2)}</span></div>
        <div class="card"><span class="small mut">Riesgo Área / Económico</span><h2>${fmt(r.ra, 3)} m²/a</h2><span class="small mut">${fmt(r.re, 0)} ${esc(r.moneda)}/año</span></div>
      </div>

      <div class="grid g2">
        <div class="card">
          <h2>Adelgazamiento generalizado</h2><p>API RP 581, parte 2 §4.5.7. Df = Σ Pᵢ Φ(−βᵢ) / 0,000156. Frecuencia anual = gff × Df × Fms. RA = fF × CA y RE = fF × CE.</p><p>Escenario: ${esc(r.escenario)}. Base económica: ${esc(r.base_valoracion)} (${esc(r.moneda)}).</p>
          <table>
            <tr><th>Probabilidad a un año (Poisson, frecuencia constante)</th><td>${fmt(100*r.prob_1a,4)} %</td></tr>
            <tr><th>Flow Stress (FS)</th><td class="num">${fmt(r.FS, 2)} MPa</td></tr>
            <tr><th>Fracción pérdida espesor (Art)</th><td class="num">${fmt(r.art, 4)}</td></tr>
            <tr><th>Strength Ratio (SR)</th><td class="num">${fmt(r.sr, 4)}</td></tr>
            <tr><th>Edad operativa (age_tk)</th><td class="num">${fmt(r.age_tk, 2)} años</td></tr>
            <tr><th>Espesor ref. (t_rdi) / CR</th><td class="num">${fmt(r.t_rdi, 2)} mm / ${fmt(r.cr_usada, 3)} mm/a</td></tr>
            <tr><th>Probabilidades posteriores Po</th><td class="small">[${(r.po || []).map((x) => fmt(x, 4)).join(" ; ")}]</td></tr>
            <tr><th>Índices confiabilidad β</th><td class="small">[${(r.beta || []).map((x) => fmt(x, 3)).join(" ; ")}]</td></tr>
          </table>
          ${r.supuestos?.length ? `<div class="note small">${r.supuestos.map((s) => esc(s)).join("<br>")}</div>` : ""}
        </div>

        <div class="card">
          <h2>Pronóstico Temporal y Análisis What-If</h2>
          <h3>Proyección sin inspección</h3>
          <table>
            <thead><tr><th>Horizonte</th><th class="num">Df</th><th class="num">f_F [1/a]</th><th class="num">RA [m²/a]</th><th>Nivel</th></tr></thead>
            <tbody>
              ${(r.pronostico || []).map((p) => `
                <tr>
                  <td>+${p.anios} años</td>
                  <td class="num">${fmt(p.df, 2)}</td>
                  <td class="num">${fmtExp(p.ff)}</td>
                  <td class="num">${fmt(p.ra, 3)}</td>
                  <td>${badgeNivel(p.nivel)}</td>
                </tr>`).join("")}
            </tbody>
          </table>

          <h3>¿Qué pasa si se inspecciona hoy?</h3>
          <table>
            <thead><tr><th>Eficacia</th><th class="num">Nuevo Df</th><th class="num">Nuevo RA</th><th class="num">Nuevo RE</th><th>Nivel</th></tr></thead>
            <tbody>
              ${(r.what_if || []).map((w) => `
                <tr>
                  <td><b>Cat. ${esc(w.eficacia)}</b></td>
                  <td class="num">${fmt(w.df, 2)}</td>
                  <td class="num">${fmt(w.ra, 3)}</td>
                  <td class="num">${fmt(w.re, 0)}</td>
                  <td>${badgeNivel(w.nivel)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      `) + `<div class="card">
        <h2>Editar parámetros RBI del equipo</h2>
        <label>Componente GFF</label><select id="rbi-comp"><option value="">Seleccione</option>${(eq.familia==="tanque"?["COURSE-1-10"]:eq.familia==="recipiente"?["DRUM"]:["PIPE-4","PIPE-6","PIPE-8"]).map(v=>`<option ${cfg.componente_gff===v?"selected":""}>${v}</option>`).join("")}</select>
        <label>Base de valoración en USD</label><input id="rbi-valor" value="${esc(cfg.base_valoracion||"")}">
        <h3>Eficacia por campaña del punto gobernante</h3>
        ${fechas.map(f=>`<label>${esc(f)}<select data-eff="${esc(f)}">${["E","D","C","B","A"].map(v=>`<option ${cfg.eficacias?.[f]===v?"selected":""}>${v}</option>`).join("")}</select></label><label>Fundamento de cobertura y técnica<input data-just="${esc(f)}" value="${esc(cfg.justificaciones?.[f]||"")}"></label>`).join("")}
        <div class="grid g3">
          <div><label>Área consecuencia CA [m²]</label><input id="rbi-ca" type="number" step="any" value="${cfg.ca_m2 ?? 0}"></div>
          <div><label>Costo consecuencia CE [USD]</label><input id="rbi-ce" type="number" step="any" value="${cfg.ce ?? 0}"></div>
          <div>
            <label>Confianza datos corrosión</label>
            <select id="rbi-conf">
              <option value="baja" ${cfg.confianza === "baja" ? "selected" : ""}>Baja</option>
              <option value="media" ${cfg.confianza === "media" ? "selected" : ""}>Media</option>
              <option value="alta" ${cfg.confianza === "alta" ? "selected" : ""}>Alta</option>
            </select>
          </div>
          <div><label>Score gestión (0–100)</label><input id="rbi-fms" type="number" min="0" max="100" value="${cfg.score_gestion ?? 50}"></div>
          <div>
            <label>Base de espesor (API 581 §4.5.5)</label>
            <select id="rbi-base">
              <option value="medido" ${cfg.base_espesor === "medido" ? "selected" : ""}>Último espesor medido</option>
              <option value="nominal" ${cfg.base_espesor === "nominal" ? "selected" : ""}>Espesor nominal</option>
            </select>
          </div>
        </div>
        <button class="btn" id="btn-save-rbi" style="margin-top:10px">Actualizar RBI</button>
      </div>
    `;

    $("#btn-save-rbi", body).onclick = () => {
      eq.rbi = eq.rbi || {};
      if (["#rbi-ca","#rbi-ce"].some(k=>!$(k).value || !Number.isFinite(Number($(k).value)) || Number($(k).value)<0))return toast("Ingrese consecuencias válidas y no negativas.",true);
      if(!$("#rbi-fms").value || !$("#rbi-fms").checkValidity() || !$("#rbi-valor").value.trim() || !$("#rbi-comp").value)return toast("Revisa gestión, componente y base económica.",true);
      eq.rbi.ca_m2 = Number($("#rbi-ca").value);
      eq.rbi.ce = Number($("#rbi-ce").value);
      eq.rbi.confianza = $("#rbi-conf").value;
      eq.rbi.score_gestion = Number($("#rbi-fms").value);
      eq.rbi.moneda="USD";
      eq.rbi.base_valoracion=$("#rbi-valor").value.trim();
      eq.rbi.componente_gff=$("#rbi-comp").value;
      eq.rbi.eficacias ||= {}; eq.rbi.justificaciones ||= {};
      for(const s of body.querySelectorAll("[data-eff]"))eq.rbi.eficacias[s.dataset.eff]=s.value;
      for(const i of body.querySelectorAll("[data-just]"))eq.rbi.justificaciones[i.dataset.just]=i.value.trim();
      eq.rbi.base_espesor = $("#rbi-base").value;
      recalc();
      toast("Parámetros RBI actualizados.");
      renderEquipoDetail($("#app"), eq.id);
    };
  }

  function renderEqEditar(body, eq) {
    const matOpts = Object.keys(catalog || {}).filter(m=>catalog[m].familia===eq.familia).map((m) => `<option value="${esc(m)}" ${eq.material === m ? "selected" : ""}>${esc(m)}</option>`).join("");
    body.innerHTML = `
      <div class="card">
        <h2>Parámetros de Diseño y Servicio</h2>
        <div class="grid g3">
          ${[["planta","Planta"],["area","Área"],["sistema","Sistema"],["componente","Componente"],["servicio","Servicio"],["fluido","Fluido"],...(eq.familia==="tuberia"?[["circuito","Circuito"]]:[])].map(([k,t])=>`<div><label>${t}<input id="ed-${k}" value="${esc(eq[k])}"></label></div>`).join("")}
          <div><label>Presión de operación (MPa)<input id="ed-po" type="number" step="any" value="${esc(eq.p_oper)}"></label></div><div><label>Temperatura de operación (°C)<input id="ed-to" type="number" step="any" value="${esc(eq.temp_oper)}"></label></div>
          <div><label>Tag</label><input id="ed-tag" value="${esc(eq.tag)}"></div>
          <div><label>Descripción</label><input id="ed-desc" value="${esc(eq.descripcion)}"></div>
          <div><label>Material</label><select id="ed-mat">${matOpts}</select></div>
          <div><label>Temp. diseño [°C]</label><input id="ed-temp" type="number" step="any" value="${eq.temp_diseno}"></div>
          <div><label>Presión diseño [MPa]</label><input id="ed-pres" type="number" step="any" value="${eq.p_diseno}"></div>
          <div><label>Corrosión admisible CA [mm]</label><input id="ed-ca" type="number" step="any" value="${eq.ca}"></div>
          <div><label>Eficiencia junta E</label><input id="ed-e" type="number" step="any" value="${eq.e_junta}"></div>
          <div><label>Plazo intervención [años]</label><input id="ed-plazo" type="number" step="any" value="${eq.plazo_intervencion ?? 2}"></div>

          ${eq.familia === "tuberia" ? `<div><label>Diámetro exterior [mm]</label><input id="ed-dim" type="number" step="any" value="${eq.diametro_ext}"></div>` : ""}
          ${eq.familia === "recipiente" ? `<div><label>Diámetro interior [mm]</label><input id="ed-dim" type="number" step="any" value="${eq.diametro_int}"></div>` : ""}
          ${eq.familia === "tanque" ? `
            <div><label>Diámetro tanque [m]</label><input id="ed-dim" type="number" step="any" value="${eq.diametro}"></div>
            <div><label>Nivel de prueba hidrostática [m]</label><input id="ed-prueba" type="number" step="any" placeholder="Igual al nivel de diseño" value="${eq.nivel_prueba ?? ""}"></div><div><label>Nivel diseño H [m]</label><input id="ed-niv" type="number" step="any" value="${eq.nivel_diseno}"></div>
            <div><label>Gravedad específica G</label><input id="ed-g" type="number" step="any" value="${eq.g_esp}"></div>
          ` : ""}
        </div>
        <button class="btn" id="btn-save-ed" style="margin-top:12px">Guardar cambios</button>
      </div>
    `;

    $("#btn-save-ed", body).onclick = () => {
      const tag=$("#ed-tag").value.trim().toUpperCase();
      if(!tag || state.equipos.some(e=>e.id!==eq.id && e.tag.toUpperCase()===tag))return toast("Se requiere un TAG único.",true);
      const original=structuredClone(eq);
      for(const k of ["planta","area","sistema","componente","servicio","fluido","circuito"]){if($("#ed-"+k))eq[k]=$("#ed-"+k).value.trim()}
      eq.p_oper=$("#ed-po").value===""?null:Number($("#ed-po").value);eq.temp_oper=$("#ed-to").value===""?null:Number($("#ed-to").value);
      eq.tag = $("#ed-tag").value.trim() || eq.tag;
      eq.descripcion = $("#ed-desc").value.trim();
      eq.material = $("#ed-mat").value;
      eq.temp_diseno = Number($("#ed-temp").value);
      eq.p_diseno = Number($("#ed-pres").value);
      eq.ca = Number($("#ed-ca").value);
      eq.e_junta = Number($("#ed-e").value);
      eq.plazo_intervencion = Number($("#ed-plazo").value);

      if (eq.familia === "tuberia") eq.diametro_ext = Number($("#ed-dim").value);
      if (eq.familia === "recipiente") eq.diametro_int = Number($("#ed-dim").value);
      if (eq.familia === "tanque") {
        eq.diametro = Number($("#ed-dim").value);
        if($("#ed-prueba").value==="")delete eq.nivel_prueba;else eq.nivel_prueba=Number($("#ed-prueba").value);
        eq.nivel_diseno = Number($("#ed-niv").value);
        eq.g_esp = Number($("#ed-g").value);
      }
      const prueba=pyCall("evaluate",{equipos:[eq],cmls:[],tmls:[],lecturas:[]});
      if(prueba.equipos[0].errores.length){Object.assign(eq,original);return toast(prueba.equipos[0].errores.join(" "),true)}
      recalc();
      toast("Parámetros guardados.");
      renderEquipoDetail($("#app"), eq.id);
    };
  }

  // -------------------- CALCULADORA T_MIN --------------------
  function renderCalc(app) {
    const matOpts = Object.keys(catalog || {}).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    app.innerHTML = `
      <h1>Calculadora de Espesor Mínimo (t_min / t_req)</h1>
      <p class="sub">Cálculo académico ejecutado en Python (ASME B31.3, ASME VIII Div.1 UG-27 y API 653/650).</p>
      <div class="grid g2">
        <div class="card">
          <h2>Datos de entrada</h2>
          <div class="grid g2">
            <div>
              <label>Familia</label>
              <select id="c-fam">
                <option value="tuberia">Tubería (ASME B31.3 §304.1.2)</option>
                <option value="recipiente">Recipiente (ASME VIII-1 UG-27)</option>
                <option value="tanque">Tanque (API 653 / API 650)</option>
              </select>
            </div>
            <div><label>Material</label><select id="c-mat">${matOpts}</select></div>
            <div><label>Temperatura diseño [°C]</label><input id="c-temp" type="number" step="any" value="150"></div>
            <div><label>Corrosión admisible CA [mm]</label><input id="c-ca" type="number" step="any" value="1.5"></div>
            <div><label>Eficiencia de junta E</label><input id="c-e" type="number" step="any" value="1.0"></div>
          </div>
          <div id="c-extra" class="grid g2" style="margin-top:10px"></div>
          <button class="btn" id="c-run" style="margin-top:12px">Calcular en Python</button>
        </div>
        <div class="card" id="c-out">
          <h2>Resultado</h2>
          <p class="mut">Presiona "Calcular en Python" para obtener el espesor requerido y admisible.</p>
        </div>
      </div>
    `;

    const drawExtra = () => {
      const fam = $("#c-fam").value;
      const ex = $("#c-extra");
      if (fam === "tuberia") {
        ex.innerHTML = `
          <div><label>Presión diseño P [MPa]</label><input id="c-pres" type="number" step="any" value="6.0"></div>
          <div><label>Diámetro exterior D [mm]</label><input id="c-dext" type="number" step="any" value="219.1"></div>
          <div><label>Tolerancia fab. [%]</label><input id="c-tol" type="number" step="any" value="12.5"></div>`;
      } else if (fam === "recipiente") {
        ex.innerHTML = `
          <div><label>Presión diseño P [MPa]</label><input id="c-pres" type="number" step="any" value="1.2"></div>
          <div><label>Diámetro interior Di [mm]</label><input id="c-dint" type="number" step="any" value="1800"></div>`;
      } else {
        ex.innerHTML = `
          <div><label>Diámetro tanque D [m]</label><input id="c-dtank" type="number" step="any" value="20"></div>
          <div><label>Nivel líquido H [m]</label><input id="c-htank" type="number" step="any" value="12"></div>
          <div><label>Gravedad específica G</label><input id="c-g" type="number" step="any" value="0.85"></div>
          <div><label>Curso (virola #)</label><input id="c-curso" type="number" min="1" value="1"></div>
          <div><label>Nivel de prueba [m]</label><input id="c-hprueba" type="number" step="any" placeholder="Igual al nivel de diseño"></div><div><label>Cota base virola [m]</label><input id="c-hbase" type="number" step="any" value="0.0"></div>`;
      }
    };
    $("#c-fam").onchange = drawExtra;
    drawExtra();

    $("#c-run").onclick = () => {
      const fam = $("#c-fam").value;
      const payload = {
        familia: fam,
        material: $("#c-mat").value,
        temp_diseno: $("#c-temp").value,
        ca: $("#c-ca").value,
        e_junta: $("#c-e").value,
        p_diseno: $("#c-pres") ? $("#c-pres").value : 0,
        tol_fabricacion: $("#c-tol") ? $("#c-tol").value : 0,
      };
      if (fam === "tuberia") payload.diametro_ext = $("#c-dext").value;
      else if (fam === "recipiente") payload.diametro_int = $("#c-dint").value;
      else {
        payload.diametro = $("#c-dtank").value;
        payload.nivel_diseno = $("#c-htank").value;
        payload.g_esp = $("#c-g").value;
        payload.curso = $("#c-curso").value;
        if($("#c-hprueba").value)payload.nivel_prueba=$("#c-hprueba").value;
        payload.h_base = $("#c-hbase").value;
      }
      try {
        const r = pyCall("design", payload);
        $("#c-out").innerHTML = `
          <h2>Resultado (${esc(r.norma_diseno)})</h2>
          <div class="eq">${esc(r.ecuacion)}</div>
          <table>
            <tr><th>Esfuerzo admisible S(T)</th><td class="num">${fmt(r.S, 2)} MPa</td></tr>
            <tr><th>${fam==="tanque"?"Espesor requerido de fabricación":"t_req (calculado por presión)"}</th><td class="num"><b>${fmt(r.t_req, 4)} mm</b></td></tr>
            <tr><th>t_adm (mínimo admisible en servicio)</th><td class="num"><b>${fmt(r.t_adm, 4)} mm</b></td></tr>
            <tr><th>t_dis (diseño con CA)</th><td class="num">${fmt(r.t_dis_api650 ?? r.t_dis, 4)} mm</td></tr>
            ${r.t_pedido ? `<tr><th>t_pedido (incl. tolerancia fab.)</th><td class="num">${fmt(r.t_pedido, 4)} mm</td></tr>` : ""}
          </table>
          ${r.notas?.length ? `<div class="note small">${r.notas.map((n) => esc(n)).join("<br>")}</div>` : ""}
        `;
      } catch (e) {
        $("#c-out").innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
      }
    };
  }

  // -------------------- VERIFICACIÓN INDEPENDIENTE --------------------
  function renderVerif(app) {
    if (!verifData) verifData = pyCall("verification");
    app.innerHTML = `
      <h1>Verificación Independiente (Benchmark Manual)</h1>
      <p class="sub">Comparación automática entre cálculos manuales independientes y el motor Python <code>eqcalc</code>.</p>
      ${verifData.map((c) => `
        <div class="card">
          <div class="row" style="align-items:center">
            <div>
              <h2 class="mb0">${esc(c.id)}: ${esc(c.titulo)}</h2>
              <span class="small mut">${esc(c.familia)} · ${esc(c.referencia)}</span>
            </div>
            <span class="badge ${c.ok ? "s-normal" : "s-bajo_minimo"}">${c.ok ? "PASS" : "FAIL"}</span>
          </div>
          <p class="small" style="margin:8px 0 4px"><b>Entradas:</b> ${esc(c.entradas)}</p>
          <div class="eq">${esc(c.manual)}</div>
          <table style="margin-top:8px">
            <thead><tr><th>Magnitud</th><th class="num">Esperado (manual)</th><th class="num">Programa (Python)</th><th class="num">Error rel.</th><th>Estado</th></tr></thead>
            <tbody>
              <tr>
                <td><b>${esc(c.magnitud)}</b></td>
                <td class="num">${fmtExp(c.esperado)}</td>
                <td class="num">${fmtExp(c.programa)}</td>
                <td class="num">${fmtExp(c.error_rel)}</td>
                <td class="${c.ok ? "ok" : "fail"}">${c.ok ? "OK" : "FAIL"}</td>
              </tr>
              ${(c.extra || []).map((x) => `
                <tr>
                  <td>${esc(x.magnitud)}</td>
                  <td class="num">${fmtExp(x.esperado)}</td>
                  <td class="num">${fmtExp(x.programa)}</td>
                  <td class="num">${fmtExp(x.error_rel)}</td>
                  <td class="${x.ok ? "ok" : "fail"}">${x.ok ? "OK" : "FAIL"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      `).join("")}
    `;
  }

  // -------------------- PROYECTO (IMPORT / EXPORT / RESET) --------------------
  function renderProyecto(app) {
    app.innerHTML = `
      <section class="project-head">
       <div><small>MAN040-B · Equipos estáticos</small><h1>Proyecto de inspección</h1>
       <p>${esc(state.meta?.nombre || "Proyecto local")}</p>
       <a class="action-link" href="#/proyeccion">Ver proyección de vida →</a></div>
       <dl><div><dt>Equipos</dt><dd>${state.equipos.length}</dd></div><div><dt>Puntos TML</dt><dd>${state.tmls.length}</dd></div><div><dt>Lecturas</dt><dd>${state.lecturas.length}</dd></div></dl></section>
       <section class="card assignment"><div><h2>Planificación y análisis de espesores</h2><p>Consulta el isométrico marcado, el historial UT y la conclusión de inspección en las dos hojas de la Tarea 3.</p></div><a class="btn ghost" href="cuaderno.html">Abrir cuaderno académico</a></section><details class="card"><summary>Historial de cambios</summary>${(state.historial||[]).slice().reverse().map(h=>`<p>${esc(h.fecha)} · ${esc(h.cambios.map(c=>c.accion+" "+c.tabla+" #"+c.id+" "+(c.campos||[]).join(", ")).join(" / "))}</p>`).join("")||"Sin cambios registrados."}</details><h2>Datos del proyecto</h2>
      <p class="sub">Persistencia local en el navegador (<code>localStorage</code>) e intercambio mediante archivos JSON.</p>
      <div class="grid g2">
        <div class="card">
          <h2>Metadatos y Exportación</h2>
          <label>Nombre del proyecto</label>
          <input id="pr-nombre" value="${esc(state.meta?.nombre || "")}">
          <div class="row" style="margin-top:12px">
            <button class="btn" id="pr-save-name">Guardar nombre</button>
            <button class="btn ghost" id="pr-export">Exportar JSON</button>
          </div>
        </div>
        <div class="card">
          <h2>Importar o Reiniciar</h2>
          <p class="small mut">Puedes cargar un archivo <code>.json</code> exportado previamente o restaurar el caso demostrativo original.</p>
          <div class="row">
            <label class="btn ghost" style="text-align:center;cursor:pointer">
              Importar JSON
              <input type="file" id="pr-import" accept=".json,application/json" hidden>
            </label>
            <button class="btn danger" id="pr-reset">Restaurar caso demo</button>
          </div>
        </div>
      </div>
    `;

    $("#pr-save-name").onclick = () => {
      state.meta = state.meta || {};
      state.meta.nombre = $("#pr-nombre").value.trim() || "Proyecto sin nombre";
      saveLocal();
      toast("Nombre actualizado.");
    };

    $("#pr-export").onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `integridad_equipos_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    $("#pr-import").onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed.equipos)) throw new Error("JSON sin lista de equipos.");
          validateProject(parsed);
          const candidate=pyCall("evaluate",parsed,evalHoy);
          localStorage.setItem(STORAGE_KEY,JSON.stringify(parsed));
          state=parsed; evalData=candidate;
          toast("Proyecto importado correctamente.");
          location.hash = "#/panel";
        } catch (err) {
          toast("Error al importar JSON: " + err.message, true);
        }
      };
      reader.readAsText(file);
    };

    $("#pr-reset").onclick = async () => {
      if (!confirm("¿Restaurar los datos demostrativos originales? Se perderán los cambios locales.")) return;
      localStorage.removeItem(STORAGE_KEY);
      const resp = await fetch("./data/demo.json");
      state = await resp.json();
      recalc();
      toast("Caso demostrativo restaurado.");
      location.hash = "#/panel";
    };
  }

  // -------------------- ACERCA --------------------
  function renderAcerca(app) {
    app.innerHTML = `
      <h1>Acerca de la Plataforma</h1>
      <p class="sub">Modelo académico para Gestión de Mantenimiento e Integridad Mecánica de Equipos Estáticos.</p>
      <div class="card">
        <h2>Arquitectura y Normativa Aplicada</h2>
        <ul>
          <li><b>Auditoría.</b> Plan consolidado en Panel. Codos y cabezales requieren ecuaciones específicas. La presión simplificada de un punto supone sólo presión interna, geometría corroída y temperatura de diseño. El grupo debe corroborar E, geometría, espesor estructural, altura de prueba, material y condiciones reales. <a href="AUDITORIA.md">Matriz y verificaciones</a>.</li>
          <li><b>Fuentes del caso.</b> ASME B31.3-2018, tabla A-1M y §304.1.2. ASME VIII-1 (2019), UG-27 y ASME II-D (2019), tabla 1A. API 650 (12.ª ed., 2013), tabla 5.2a. API RP 580 (3.ª ed., 2016) y API RP 581 (3.ª ed., 2016, con enmiendas hasta 2020).</li>
          <li><b>Inspección en servicio.</b> Reglas académicas de API 510, 570 y 653. Ediciones de estas tres normas pendientes de corroboración con la biblioteca del curso. Alcance: próximas mediciones UT; en tanques, solo el manto. El fondo, techo, soldaduras e inspecciones internas requieren antecedentes propios.</li>
          <li><b>Uso de IA.</b> Codex apoyó la implementación y las pruebas. Los casos independientes confrontan las salidas con cálculo manual y una evaluación separada del RBI.</li>
          <li><b>Ejecución 100% en navegador:</b> HTML/CSS/JS + <b>PyScript (Pyodide)</b> ejecutando el paquete Python <code>eqcalc</code> sin servidor backend, compatible con GitHub Pages.</li>
          <li><b>Tuberías de proceso:</b> Diseño según ASME B31.3 §304.1.2 e inspección en servicio API 570 (Clases 1, 2, 3 e inyección).</li>
          <li><b>Recipientes a presión:</b> Diseño de envolvente cilíndrica ASME VIII Div.1 UG-27(c)(1) e inspección en servicio API 510.</li>
          <li><b>Tanques de almacenamiento atmosférico:</b> Método de 1 pie (API 650 §5.6.3.2 / API 653 §4.3.3.1) por virolas e inspección API 653.</li>
          <li><b>RBI Cuantitativo:</b> Modelo académico basado en API RP 581 Parte 2 §4.5.7 (adelgazamiento general, actualización bayesiana de inspecciones, índice de confiabilidad β, factor de daño Df, frecuencia de falla f_F y evaluación separada de riesgo por área RA y riesgo económico RE).</li>
        </ul>
      </div>
    `;
  }

  // -------------------- ARRANQUE --------------------
  async function boot() {
    try {
      await loadInitialProject();
      catalog = pyCall("catalog");
      recalc(false);
      $("#loading").hidden = true;
      $("#app").hidden = false;
      window.addEventListener("hashchange", render);
      render();
    } catch (err) {
      $("#loading").innerHTML = `<span class="fail">Error al iniciar aplicación: ${esc(err.message)}</span>`;
      console.error(err);
    }
  }

  if (typeof window.pyApi === "function") {
    boot();
  } else {
    window.addEventListener("py-ready", boot, { once: true });
  }
})();
