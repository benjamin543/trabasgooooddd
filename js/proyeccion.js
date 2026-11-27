/* La curva arranca en la última UT de la serie comparable del punto. */
function curvaDeEspesor(serie, tasa, retiro, alarma, horizonte, diasAnio = 365.25) {
  if (!serie.length) return '<p class="note">Se requiere al menos una medición para dibujar el historial.</p>';
  const dia = 86400000, ultima = serie.at(-1), finUT = Date.parse(ultima.fecha);
  const duracion = tasa > 0 && ultima.espesor > retiro
    ? Math.min(horizonte, (ultima.espesor - retiro) / tasa) : 0;
  const fin = finUT + duracion * diasAnio * dia;
  const inicio = Date.parse(serie[0].fecha);
  const valores = [retiro, ...serie.map(p => p.espesor)];
  if (Number.isFinite(alarma)) valores.push(alarma);
  const alto = Math.max(...valores) * 1.06, bajo = Math.min(...valores) * .95;
  const x = t => 64 + 610 * (t - inicio) / Math.max(fin - inicio, dia);
  const y = e => 188 - 145 * (e - bajo) / Math.max(.001, alto - bajo);
  const umbral = (valor,color) => Number.isFinite(valor) ? '<line x1="64" x2="674" y1="'+y(valor)+'" y2="'+y(valor)+'" stroke="'+color+'"/>' : '';
  const coords = serie.map(r => x(Date.parse(r.fecha))+','+y(r.espesor)).join(' ');
  const puntos = serie.map(r => '<circle r="4" cx="'+x(Date.parse(r.fecha))+'" cy="'+y(r.espesor)+'" fill="#09645a"/>').join('');
  const futuro = duracion ? '<line x1="'+x(finUT)+'" y1="'+y(ultima.espesor)+'" x2="'+x(fin)+'" y2="'+y(ultima.espesor-tasa*duracion)+'" stroke="#09645a" stroke-width="3" stroke-dasharray="8 5"/>' : '';
  const rejilla = [0,.5,1].map(f=>{
    const v=bajo+(alto-bajo)*f;
    return '<text x="5" y="'+(y(v)+4)+'">'+v.toFixed(2)+'</text><path stroke="#d9e3dd" d="M64 '+y(v)+'h610"/>';
  }).join('');
  return '<svg viewBox="0 0 700 236" class="trend" role="img" aria-label="Espesor en milímetros por fecha, mediciones y proyección lineal"><text x="5" y="22">mm</text>'+rejilla+umbral(retiro,'#b54936')+umbral(alarma,'#aa7905')+'<polyline points="'+coords+'" fill="none" stroke="#09645a" stroke-width="3"/>'+puntos+futuro+'<text x="64" y="220">'+new Date(inicio).toISOString().slice(0,10)+'</text><text x="674" y="220" text-anchor="end">'+new Date(fin).toISOString().slice(0,10)+'</text></svg><div class="keys"><span>● UT medida</span><span>┄ Estimación lineal</span><span class="ret">━ Retiro</span>'+(Number.isFinite(alarma)?'<span class="alm">━ Alarma</span>':'')+'</div>';
}
function mostrarProyeccion(app,state,evaluacion,esc,fmt,abrirMediciones) {
  const equipos=evaluacion.equipos;
  const [, , equipoInicial, puntoInicial]=location.hash.split('/');
  app.innerHTML='<small class="eyebrow">Monitoreo de espesores</small><h1>Proyección de vida remanente</h1><p class="sub">Consulta la tendencia y el margen hasta el retiro de cada punto de medición.</p><section class="card filters"><label>Equipo<select id="equipo-pr"></select></label><label>CML / TML<select id="punto-pr"></select></label><label>Horizonte del gráfico<select id="anos-pr"><option>5</option><option>10</option><option>20</option></select></label><label>Sensibilidad de la tasa<select id="sens-pr"><option value="1">Tasa adoptada</option><option value="0.75">−25 % de pérdida</option><option value="1.25">+25 % de pérdida</option></select></label></section><div id="analisis-pr"></div>';
  const eq=app.querySelector('#equipo-pr'),tml=app.querySelector('#punto-pr'),anos=app.querySelector('#anos-pr'),body=app.querySelector('#analisis-pr');
  for(const equipo of equipos)eq.add(new Option(equipo.tag,equipo.id));
  if(equipos.some(e=>String(e.id)===equipoInicial))eq.value=equipoInicial;
  function ver(){
    const equipo=equipos.find(e=>String(e.id)===eq.value);
    const t=equipo?.tmls?.find(t=>String(t.tml_id)===tml.value);
    if(!t){body.innerHTML='<p class="note">Punto sin evaluación. Revise la geometría, la ecuación aplicable y los antecedentes del equipo.</p>';return}
    const factor=Number(app.querySelector("#sens-pr").value);
    const critico=t.bajo_minimo, vida=critico?0:t.vr==null?null:t.vr/factor;
    const fechaRetiro=vida==null?'Por determinar':new Date(Date.parse(t.fecha_ult)+Math.floor(vida*365.25)*86400000).toISOString().slice(0,10);
    const inspection=critico?'Revisión inmediata':vida==null?'Revisar antecedentes':t.inspeccion?.fecha_limite||'Por determinar';
    const posicion=state.tmls.find(p=>p.id===t.tml_id)?.posicion;
    body.innerHTML='<div class="pro-grid"><section class="card"><small class="eyebrow">'+esc(equipo.tag)+' · '+esc(t.cml)+' / '+esc(t.tml)+'</small><h2>Evolución del espesor</h2><p class="mut">'+esc(posicion)+'</p>'+curvaDeEspesor(t.serie_comparable,t.cr_adoptada*factor,t.t_adm,t.t_alerta,Number(anos.value))+'</section><aside class="forecast"><small>Vida del escenario desde la última UT</small><strong>'+ (vida==null?'Sin estimación':fmt(vida,2)+' años')+'</strong><p>Última UT · '+esc(t.fecha_ult||'Pendiente')+'</p><p>Vida del escenario al '+esc(evaluacion.hoy)+' · '+(vida==null?'Sin estimación':fmt(Math.max(0,vida-(Date.parse(evaluacion.hoy)-Date.parse(t.fecha_ult))/31557600000),2)+' años')+'</p><p>Presión límite simplificada del punto a T de diseño · '+fmt(t.mawp_punto_mpa,3)+' MPa</p><p>Retiro estimado · '+fechaRetiro+'</p><p>Inspección base · '+esc(inspection)+'</p></aside></div><section class="card"><h2>Base de cálculo</h2><div class="tw"><table><thead><tr><th>Medido (mm)</th><th>Retiro (mm)</th><th>TC largo plazo</th><th>TC corto plazo</th><th>TC adoptada</th></tr></thead><tbody><tr>'+[t.t_med,t.t_adm,t.cr_largo,t.cr_corto,t.cr_adoptada].map(n=>'<td>'+fmt(n,3)+'</td>').join('')+'</tr></tbody></table></div><p>'+esc(t.criterio)+'</p><p class="mut">Tasas en mm/año. Se supone pérdida lineal y condiciones de servicio comparables hasta el retiro. Una reparación o sustitución inicia una nueva serie.</p>'+t.avisos.map(a=>'<p class="note warn">'+esc(a)+'</p>').join('')+'<button class="btn" id="pr-medicion">Registrar medición del equipo</button></section>';
    body.querySelector('#pr-medicion').onclick=()=>abrirMediciones(equipo.id,t.tml_id);
  }
  function cargar(){const equipo=equipos.find(e=>String(e.id)===eq.value);tml.replaceChildren();for(const c of state.cmls.filter(c=>c.equipo_id===equipo?.id)){
    for(const p of state.tmls.filter(p=>p.cml_id===c.id)){
      const evaluable=equipo.tmls.some(t=>t.tml_id===p.id);
      tml.add(new Option(c.codigo+" / "+p.codigo+(evaluable?"":" · Sin evaluación"),p.id));
    }
  }if(equipo?.gobernante_ref)tml.value=String(equipo.gobernante_ref.tml_id);ver()}
  eq.onchange=cargar;tml.onchange=anos.onchange=app.querySelector("#sens-pr").onchange=ver;cargar();if([...tml.options].some(o=>o.value===puntoInicial)){tml.value=puntoInicial;ver()}
}
