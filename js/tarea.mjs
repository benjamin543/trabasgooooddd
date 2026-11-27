const file=document.querySelector('#file'), result=document.querySelector('#result'), message=document.querySelector('#message');
const element=(tag,value='')=>{const e=document.createElement(tag);e.textContent=value;return e};
let imageURL,loadNumber=0;
function cells(xml,strings){const map=new Map();for(const cell of xml.querySelectorAll('c')){const v=cell.getElementsByTagName('v')[0]?.textContent??'';const type=cell.getAttribute('t');map.set(cell.getAttribute('r'),type==='s'?strings[Number(v)]:type==='inlineStr'?cell.textContent:v)}return map}
function table(map,headers,columns,start,end){const scroll=element('div');scroll.className='tw';const table=element('table'),head=element('thead'),tr=element('tr');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);table.append(head);const body=element('tbody');
 for(let i=start;i<=end;i++){const row=element('tr');for(const [col,format] of columns){let v=map.get(col+i)??'';if(v!==''&&format==='date')v=new Date((Number(v)-25569)*86400000).toISOString().slice(0,10);if(v!==''&&format==='number')v=Number(v).toLocaleString('es-CL',{maximumFractionDigits:3});row.append(element('td',v||'—'))}body.append(row)}table.append(body);scroll.append(table);return scroll}
file.onchange=async()=>{const serial=++loadNumber;result.replaceChildren();message.textContent='';if(imageURL)URL.revokeObjectURL(imageURL);const input=file.files[0];if(!input)return;
 try{if(input.size>20000000)throw Error();const zip=await JSZip.loadAsync(input);
 const xml=async path=>new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml');
 const names=[...(await xml('xl/workbook.xml')).getElementsByTagName('sheet')].map(s=>s.getAttribute('name'));if(names.join('|')!=='1ra Parte|2da parte')throw Error();
 const stringTable=zip.file('xl/sharedStrings.xml')?[...(await xml('xl/sharedStrings.xml')).getElementsByTagName('si')].map(s=>s.textContent):[];
 const a=cells(await xml('xl/worksheets/sheet1.xml'),stringTable),b=cells(await xml('xl/worksheets/sheet2.xml'),stringTable);
 if(a.get('A44')!=='CML'||b.get('A48')!=='Punto')throw Error();const data=await zip.file('xl/media/image1.png').async('uint8array');if(serial!==loadNumber)return;
 const first=element('article'),second=element('article');first.className=second.className='card';first.append(element('h2','1ra Parte · Plan de inspección'));imageURL=URL.createObjectURL(new Blob([data],{type:'image/png'}));const img=element('img');img.src=imageURL;img.style.width='100%';img.alt='Isométrico marcado con ubicaciones de monitoreo';const link=element('a');link.href=imageURL;link.target='_blank';link.rel='noopener';link.append(img);first.append(link,element('p',a.get('A37')),table(a,['CML','TML','Componente','Ubicación','Orientación','Retiro (mm)','Alarma (mm)','Evaluación'],[['A'],['B'],['C'],['F'],['G'],['N','number'],['O','number'],['AC']],45,60));
 second.append(element('h2','2da parte · Historial y próxima inspección'),...[4,5,6,7].map(r=>element('p',b.get('A'+r))),table(b,['Punto','Anterior (mm)','Actual (mm)','Anomalía','TC LP','TC CP','VR (años)','Fecha ordinaria','Fecha cautelar'],[['A'],['C','number'],['D','number'],['I'],['G','number'],['H','number'],['L','number'],['N','date'],['R','date']],49,76));const projection=element('article');projection.className='card';projection.append(element('h2','Proyección de vida · caso histórico'));
 const label=element('label','Punto y orientación'),select=element('select'),area=element('div');
 for(let row=49;row<=76;row++)select.add(new Option(b.get('A'+row),row));
 label.append(select);projection.append(label,area);
 function review(){
  const r=Number(select.value),number=ref=>{const raw=b.get(ref);return raw==null||raw===''?null:Number(raw)};
  const date=ref=>new Date((number(ref)-25569)*86400000).toISOString().slice(0,10);
  const series=[{fecha:date('B13'),espesor:number('C'+r)}];if(number('D'+r)!==null)series.push({fecha:date('C13'),espesor:number('D'+r)});
  const vr=number('P'+r),rate=number('O'+r),message=element('p',vr===null?'Sin estimación para la campaña actual.':('Vida estimada desde '+date('C13')+' · '+vr.toLocaleString('es-CL',{maximumFractionDigits:2})+' años'));
  const criterion=element('p',number('K'+r)===null&&rate!==null?'Escenario cautelar condicionado a verificar la comparabilidad.':b.get('J'+r));
  const chart=element('div');chart.innerHTML=curvaDeEspesor(series,rate,number('D13'),null,20,number('F13'));
  area.replaceChildren(message,criterion,chart);
 }
 select.onchange=review;review();result.append(first,second,projection);message.textContent='Libro cargado.'}catch{if(serial===loadNumber)message.textContent='Selecciona el archivo de entrega con sus dos hojas y su isométrico.'}};

