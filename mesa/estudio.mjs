import {demo,analysis,readBook,offset,openStore,storage} from './datos.mjs';
import {blueprint,trend} from './graficos.mjs';
const $=s=>document.querySelector(s),out=$('#workspace');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=2)=>Number.isFinite(v)?v.toLocaleString('es-CL',{maximumFractionDigits:n}):'—';
const views={proyecto:'Mapa del circuito',historial:'Historial UT',proyeccion:'Proyección de vida'};
let db,book,bookKey='',mapURL='',fileURL='',mode='demo',extra={},factor=1,horizon=10;
const selection={demo:'C02',plan:null,history:null};
function route(){return location.hash.slice(2).split('/')[0]||'proyecto'}
function source(){return mode==='demo'?'Circuito de práctica · datos sintéticos':mode==='plan'?'Primera parte · plan de inspección':'Segunda parte · informe UT'}
function points(){const base=mode==='demo'?demo:book[mode];return base.map(p=>{
 const more=extra[mode+':'+p.id]||[];
 return more.length?{...p,rows:[...p.rows,...more].sort((a,b)=>a.date.localeCompare(b.date)),missing:false,bookResult:null}:p;
})}
const selected=()=>points().find(p=>p.id===selection[mode])||points()[0];
const notice=t=>$('#status').textContent=t;
function pick(id){selection[mode]=id;factor=1;render()}
function metrics(items){return '<div class="readout">'+items.map(([k,v])=>'<div><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join('')+'</div>'}
function picker(p){return '<label class="micro" for="point">Punto de inspección</label><select id="point">'+points().map(q=>'<option value="'+esc(q.id)+'" '+(q.id===p.id?'selected':'')+'>'+esc(q.tml+' · '+q.orientation)+'</option>').join('')+'</select>'}
function bindPicker(){if($('#point'))$('#point').onchange=e=>pick(e.target.value)}
function bindGroups(){out.querySelectorAll('[data-group]').forEach(n=>{const action=()=>pick(points().find(p=>p.group===n.dataset.group).id);n.onclick=action;if(n.tagName.toLowerCase()==='g')n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action()}}})}
const field=(k,v)=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v??'Pendiente')+'</dd></div>';
function map(p){
 const groupList=[...new Set(points().map(q=>q.group))];
 const locations=[[1005,819],[1053,801],[1103,773],[893,643],[648,502],[778,672],[257,409],[486,333]];
 let graphic=blueprint(p.group);
 if(mode==='plan')graphic='<div class="plot-hold"><img alt="Isométrico marcado de la primera parte" src="'+mapURL+'">'+groupList.map((g,i)=>'<button class="marker" aria-label="Seleccionar '+esc(g)+'" data-group="'+esc(g)+'" style="left:'+locations[i][0]/1615*100+'%;top:'+locations[i][1]/1027*100+'%" aria-pressed="'+(g===p.group)+'"></button>').join('')+'</div><a href="'+mapURL+'" target="_blank" rel="noopener">Ampliar plano ↗</a>';
 if(mode==='history')graphic='<p>Selecciona el número de punto del informe para consultar sus orientaciones.</p><div class="strip">'+groupList.map(g=>'<button data-group="'+esc(g)+'">Punto '+esc(g)+'</button>').join('')+'</div>';
 out.innerHTML='<div class="split"><section class="board"><div class="pane-head"><div><small class="micro">'+esc(source())+'</small><h2>'+(mode==='demo'?'Línea de recirculación':mode==='plan'?'Isométrico de construcción':'Índice de puntos UT')+'</h2></div></div>'+graphic+'<div class="legend"><span class="dot"></span> '+esc(p.group)+' seleccionado · '+groupList.length+' ubicaciones</div></section><aside class="detail">'+picker(p)+'<h2>'+esc(p.title)+'</h2><p>'+esc(p.position)+'</p><dl>'+field('Componente / material',p.component)+field('Orientación',p.orientation)+field('Nominal',fmt(p.nominal)+' mm')+field('Retiro',Number.isFinite(p.retire)?fmt(p.retire)+' mm':'Pendiente')+'</dl>'+(p.note?'<p class="note">'+esc(p.note)+'</p>':'')+'<a href="#/historial" class="button">Consultar campañas →</a></aside></div>'+
 '<section class="panel"><div class="pane-head"><div><small class="micro">Registro de campo</small><h2>Ubicaciones de monitoreo</h2></div><span class="source">'+points().length+' puntos TML</span></div><div class="table-wrap"><table><thead><tr><th>Ubicación</th><th>Punto</th><th>Orientación</th><th>Alarma (mm)</th><th>Retiro (mm)</th><th>Condición / referencia</th></tr></thead><tbody>'+points().map(q=>'<tr class="'+(p.id===q.id?'active':'')+'"><td>'+esc(q.group)+'</td><td><button class="chip" data-point="'+esc(q.id)+'">'+esc(q.tml)+'</button></td><td>'+esc(q.orientation)+'</td><td>'+fmt(q.alarm)+'</td><td>'+fmt(q.retire)+'</td><td>'+esc(q.note||q.position)+'</td></tr>').join('')+'</tbody></table></div></section>';
 out.querySelectorAll('[data-point]').forEach(b=>b.onclick=()=>pick(b.dataset.point));bindGroups();bindPicker();
}
function history(p){
 const a=analysis(p);
 out.innerHTML='<section class="panel"><div class="pane-head"><div><small class="micro">'+source()+'</small><h2>Campañas del punto '+esc(p.tml)+'</h2></div><div>'+picker(p)+'</div></div>'+metrics([['Última UT válida',p.rows.at(-1)?.date||'Pendiente'],['TC largo plazo (mm/a)',fmt(a.lp,3)],['TC corto plazo (mm/a)',fmt(a.cp,3)],['Tasa adoptada (mm/a)',fmt(a.tc,3)]])+'<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Espesor (mm)</th><th>Origen</th></tr></thead><tbody>'+
 (p.base?'<tr><td>'+esc(p.base.date)+'</td><td>'+fmt(p.base.mm)+'</td><td>Referencia nominal adoptada</td></tr>':'')+
 p.rows.map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+fmt(r.mm,3)+'</td><td>'+esc(r.origin)+'</td></tr>').join('')+(p.missing?'<tr><td>Campaña 2018</td><td>(2)</td><td>Sin medición actual · fitting roscado</td></tr>':'')+
 '</tbody></table></div>'+(p.note?'<p class="note">'+esc(p.position)+' · '+esc(p.note)+'</p>':'')+'<div class="actions">'+(mode!=='history'?'<button id="add">Registrar campaña UT</button>':'')+'<a class="button" href="#/proyeccion">Proyectar este punto →</a></div></section>';
 if(mode==='history')out.insertAdjacentHTML('beforeend','<section class="panel"><small class="micro">Conclusión del circuito</small><h2>Próxima inspección</h2>'+book.notes.map(t=>'<p>'+esc(t)+'</p>').join('')+'</section>');
 bindPicker();if($('#add'))$('#add').onclick=()=>{const form=$('#reading');form.reset();form.elements.date.max=new Date().toISOString().slice(0,10);$('#target').textContent=source()+' / '+p.tml;$('#error').textContent='';$('#dialog').showModal()};
}
function projection(p){
 const a=analysis(p),rate=a.tc>0?a.tc*factor:null,vr=a.margin==null?null:a.margin<=0?0:rate?a.margin/rate:null;
 const verdict=a.margin!=null&&a.margin<=0?'Retiro alcanzado · revisión inmediata':vr===null?'Proyección pendiente de datos':a.caution?'Estimación cautelar · verificar comparabilidad':factor===1?'Proyección con tasa adoptada':'Escenario de sensibilidad';
 out.innerHTML='<section class="panel"><div class="pane-head"><div><small class="micro">'+source()+'</small><h2>'+esc(p.title)+' · '+esc(p.tml)+'</h2></div><div>'+picker(p)+'</div></div><p class="topic">'+verdict+'</p>'+metrics([['Vida desde última UT',vr===null?'—':fmt(vr)+' años'],['Tasa del escenario',rate?fmt(rate,3)+' mm/a':'—'],['Retiro estimado',vr===null?'—':offset(a.latest.date,vr)],['Inspección base',a.due||'Por evaluar']])+
 trend(p,a,rate,horizon)+'<p class="chartkey">● Medición UT　 <span class="ret">┄ Proyección lineal　 ··· Retiro</span>'+(p.alarm?'　 ··· Alarma':'')+'</p><div class="mode-controls"><label>Horizonte del gráfico<select id="horizon">'+[5,10,20].map(n=>'<option '+(n===horizon?'selected':'')+' value="'+n+'">'+n+' años</option>').join('')+'</select></label><label>Sensibilidad de la tasa<select id="factor" '+(!a.tc?'disabled':'')+'>'+[.75,1,1.25].map(n=>'<option '+(n===factor?'selected':'')+' value="'+n+'">'+(n===1?'Tasa adoptada':n===.75?'Pérdida 25 % menor':'Pérdida 25 % mayor')+'</option>').join('')+'</select></label></div><p class="source">La curva parte de la última UT comparable y termina en el retiro o en el horizonte elegido. La sensibilidad explora otra velocidad de pérdida; la fecha de inspección mantiene el criterio base.</p>'+
 (mode==='demo'?'<p class="source">Práctica de Clase 1. Intervalo base: el menor entre media vida y cinco años.</p>':'')+(p.note?'<p class="note">'+esc(p.note)+'</p>':'')+'<a href="#/historial">Ver mediciones y tasas del punto</a></section>';
 bindPicker();$('#factor').onchange=e=>{factor=Number(e.target.value);render()};$('#horizon').onchange=e=>{horizon=Number(e.target.value);render()};
}
function render(){const name=route();if(!views[name]){location.replace('herramientas.html'+location.hash);return}document.title=views[name]+' · Cota UT';$('#heading').textContent=views[name];document.querySelectorAll('nav a').forEach(a=>{if(a.hash==='#/'+name)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});const p=selected();if(name==='historial')history(p);else if(name==='proyeccion')projection(p);else map(p)}
async function useBook(file){
 const next=await readBook(file),digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const saved=db?await storage(db,'extras:'+key):null;
 if(mapURL)URL.revokeObjectURL(mapURL);if(fileURL)URL.revokeObjectURL(fileURL);
 bookKey=key;book=next;mapURL=URL.createObjectURL(next.image);fileURL=URL.createObjectURL(file);for(const k of Object.keys(extra))if(k.startsWith('plan:'))delete extra[k];Object.assign(extra,saved||{});
 $('#case').replaceChildren(new Option('Práctica sintética','demo'),new Option('Parte 1 · Plan de inspección','plan'),new Option('Parte 2 · Historial real','history'));$('#case').value=mode='plan';selection.plan=book.plan[0].id;selection.history=book.history.find(q=>q.bookResult.caution)?.id||book.history[0].id;
 const dl=$('#download');dl.href=fileURL;dl.download=file.name;dl.hidden=false;factor=1;render();
}
$('#file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;await useBook(f);if(db)await storage(db,'book',f);notice('Libro abierto. Cambia el expediente para pasar del plan al historial de la segunda parte.')}catch(err){notice('No se pudo abrir el libro. '+err.message)}finally{e.target.value=''}};
$('#case').onchange=e=>{mode=e.target.value;factor=1;notice('');render()};
$('#cancel').onclick=()=>$('#dialog').close();
$('#reading').onsubmit=async e=>{e.preventDefault();const p=selected(),form=e.target,f=new FormData(form),date=f.get('date'),mm=Number(f.get('mm')),origin=f.get('origin').trim();try{
 if(!db)throw Error('El almacenamiento local no está disponible.');
 if(!origin||!Number.isFinite(mm)||mm<=0||!date||date>new Date().toISOString().slice(0,10)||p.rows.some(r=>r.date===date))throw Error('Verifica el origen, el espesor y una fecha única hasta hoy.');
 const key=mode+':'+p.id, bucket=mode==='demo'?'extras:demo':'extras:'+bookKey;
 const updated=await new Promise((resolve,reject)=>{const tx=db.transaction('datos','readwrite'),store=tx.objectStore('datos'),req=store.get(bucket);let values;req.onsuccess=()=>{values=req.result||{};const rows=values[key]||[];if(rows.some(r=>r.date===date)){tx.abort();return}values[key]=[...rows,{date,mm,origin}];store.put(values,bucket)};tx.onabort=()=>reject(Error('No se guardó la fecha; comprueba si ya existe.'));tx.oncomplete=()=>resolve(values)});
 Object.assign(extra,updated);$('#dialog').close();notice('Campaña guardada en este navegador. El Excel conserva sus datos originales.');render();
 }catch(err){$('#error').textContent=err.message}};
window.addEventListener('hashchange',render);
render();
try{db=await openStore();extra=await storage(db,'extras:demo')||{};const saved=await storage(db,'book');if(saved)await useBook(saved);else render()}catch{notice('El almacenamiento del navegador no está disponible.')}


