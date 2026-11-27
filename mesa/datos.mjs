const DAY=86400000;
export const YEAR=365.2425;
export const days=(a,b)=>(Date.parse(b)-Date.parse(a))/DAY;
export function offset(start,years){
  const n=Date.parse(start)+Math.floor(years*YEAR)*DAY;
  return Number.isFinite(new Date(n).getTime())?new Date(n).toISOString().slice(0,10):null;
}
export function analysis(p){
  const rows=p.rows,latest=rows.at(-1);
  if(!latest||p.missing)return {};
  const prev=rows.at(-2),base=p.base||rows[0];
  const rate=r=>r&&days(r.date,latest.date)>0?(r.mm-latest.mm)*YEAR/days(r.date,latest.date):null;
  const lp=rate(base),cp=rate(prev);
  const cached=p.bookResult;
  const tc=cached?cached.tc:([lp,cp].filter(v=>v>0).length?Math.max(lp??0,cp??0):null);
  const margin=Number.isFinite(p.retire)?latest.mm-p.retire:null;
  const vr=margin===null?null:margin<=0?0:tc>0?margin/tc:null;
  const interval=vr!==null&&p.cap>0?Math.min(vr/2,p.cap):null;
  return {latest,lp,cp,tc,vr,margin,due:cached?cached.due:interval!==null?offset(latest.date,interval):null,retirement:vr===null?null:offset(latest.date,vr),caution:cached?.caution||false};
}
export const demo=[
 ['C01','Succión','Tubo recto','12 h','A 150 mm de la brida de entrada.',[7.2,6.9,6.5]],
 ['C02','Cambio de dirección','Codo de 90°','Extradós','Corona del primer codo, entre las dos tangencias.',[6.4,5.8,5.2]],
 ['C03','Descarga','Tubo recto','6 h','A 200 mm de la brida de salida.',[6.8,6.6,6.5]]
].map(([id,title,component,orientation,position,vals],i)=>({id,group:id,tml:id+'.01',title,component,orientation,position,nominal:[7.3,6.6,7.0][i],alarm:4.5,retire:3.5,cap:5,rows:vals.map((mm,j)=>({date:['2020-07-01','2022-07-01','2025-07-01'][j],mm,origin:'Práctica sintética'}))}));
function readSheet(xml,strings){
  const data=new Map();
  for(const c of xml.querySelectorAll('c')){
    const raw=c.querySelector('v')?.textContent??'';
    data.set(c.getAttribute('r'),c.getAttribute('t')==='s'?strings[Number(raw)]:c.getAttribute('t')==='inlineStr'?c.textContent:raw);
  }
  return data;
}
export async function readBook(file){
  if(file.size>20e6)throw Error('El libro supera los 20 MB.');
  const zip=await JSZip.loadAsync(file);
  const xml=async name=>new DOMParser().parseFromString(await zip.file(name).async('string'),'application/xml');
  const sheets=[...(await xml('xl/workbook.xml')).querySelectorAll('sheet')];
  if(sheets.map(s=>s.getAttribute('name')).join('|')!=='1ra Parte|2da parte')throw Error('Selecciona el Excel académico con sus dos hojas.');
  const ss=zip.file('xl/sharedStrings.xml')?[...(await xml('xl/sharedStrings.xml')).querySelectorAll('si')].map(s=>s.textContent):[];
  const a=readSheet(await xml('xl/worksheets/sheet1.xml'),ss),b=readSheet(await xml('xl/worksheets/sheet2.xml'),ss);
  if(a.get('A44')!=='CML'||b.get('A48')!=='Punto')throw Error('El formato de las tablas difiere del libro de la Tarea 3.');
  const num=(m,k)=>m.has(k)&&m.get(k)!==''&&Number.isFinite(Number(m.get(k)))?Number(m.get(k)):null;
  const date=(m,k)=>num(m,k)===null?null:new Date((num(m,k)-25569)*DAY).toISOString().slice(0,10);
  const plan=[],history=[];
  for(let r=45;r<=60;r++){
    const rows=[['P','Q'],['R','S'],['T','U']].map(([d,v])=>({date:date(a,d+r),mm:num(a,v+r),origin:'Campaña en Excel'})).filter(v=>v.date&&v.mm>0);
    plan.push({id:a.get('B'+r),group:a.get('A'+r),tml:a.get('B'+r),title:a.get('C'+r),component:a.get('D'+r),orientation:a.get('G'+r),position:a.get('F'+r),note:a.get('AC'+r),nominal:num(a,'I'+r),alarm:num(a,'O'+r),retire:num(a,'N'+r),cap:num(a,'Z'+r),rows});
  }
  for(let r=49;r<=76;r++){
    const id=b.get('A'+r),mm=num(b,'D'+r),ordinary=num(b,'K'+r),tc=num(b,'O'+r);
    const rows=[{date:date(b,'B13'),mm:num(b,'C'+r),origin:'Campaña anterior'}];
    if(mm!==null)rows.push({date:date(b,'C13'),mm,origin:'Medición actual'});
    history.push({id,group:id.slice(0,-1),tml:id,title:'Punto '+id,component:'Tubería · '+b.get('B'+(r-32))+'″',orientation:id.slice(-1),position:b.get('I'+r),note:b.get('J'+r),retire:num(b,'D13'),cap:num(b,'E13'),nominal:num(b,'B'+r),missing:mm===null,rows,base:{date:date(b,'A13'),mm:num(b,'B'+r)},bookResult:{tc,caution:ordinary===null&&tc!==null,due:date(b,'R'+r)}});
  }
  return {plan,history,notes:[4,5,6].map(r=>b.get('A'+r)),image:await zip.file('xl/media/image1.png').async('blob')};
}
export function openStore(){
  return new Promise((resolve,reject)=>{const req=indexedDB.open('cota-ut-cuaderno',1);req.onupgradeneeded=()=>req.result.createObjectStore('datos');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
}
export function storage(db,key,value){
  return new Promise((resolve,reject)=>{const tx=db.transaction('datos',value===undefined?'readonly':'readwrite'),store=tx.objectStore('datos'),req=value===undefined?store.get(key):store.put(value,key);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error)});
}

