import {YEAR,offset} from './datos.mjs';
const diag='M48 208 L135 159 Q145 152 154 158 L228 201 Q240 208 250 201 L334 152 Q345 146 345 133 V100 Q345 89 357 82 L423 44 Q435 38 446 44 L534 95';
const spots=[[101,178,75,125],[239,204,256,255],[483,65,510,22]];
export function blueprint(selected){
  const flanges=[[74,193,60],[84,187,60],[180,173,-60],[189,179,-60],[304,170,60],[313,165,60],[345,121,0],[345,114,0],[463,54,-60],[472,59,-60]];
  const pipes=['#091e29','#85a7b5','#426575','#63899a'].map((c,i)=>'<path d="'+diag+'" fill="none" stroke="'+c+'" stroke-width="'+[28,24,21,13][i]+'" stroke-linecap="butt" stroke-linejoin="round"/>').join('');
  return '<svg class="blueprint" viewBox="0 0 585 290" aria-label="Plano interactivo del circuito sintético"><defs><pattern id="mesh" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M0 25L25 10 M0 10L17 0" stroke="#709ba7" opacity=".17" fill="none"/></pattern></defs><path d="M16 208L341 17l229 130-326 129z" fill="url(#mesh)"/><g fill="none" stroke="#6e9eae" stroke-width="1" stroke-dasharray="4 6"><path d="M49 209v33l185 31 307-174M345 99l-1 86 89-50V42"/></g>'+pipes+flanges.map(([x,y,r])=>'<g transform="translate('+x+' '+y+') rotate('+r+')"><rect x="-19" y="-3" width="38" height="6" rx="2" fill="#a4bac1" stroke="#233e4c"/><circle cx="-15" r="1.4" fill="#254451"/><circle cx="15" r="1.4" fill="#254451"/></g>').join('')+spots.map(([x,y,a,b],i)=>{const id='C0'+(i+1),color=selected===id?'#ff965a':'#c9e8ea';return '<g tabindex="0" role="button" aria-label="Seleccionar '+id+'" data-group="'+id+'"><path d="M'+x+' '+y+'L'+a+' '+b+'" stroke="'+color+'" fill="none"/><circle cx="'+x+'" cy="'+y+'" r="6" fill="'+color+'" stroke="#153543" stroke-width="2"/><rect x="'+(a-23)+'" y="'+(b-11)+'" width="46" height="22" rx="3" fill="'+color+'"/><text x="'+a+'" y="'+(b+4)+'" text-anchor="middle" style="fill:#163342;font-weight:bold">'+id+'</text></g>'}).join('')+'</svg>';
}
export function trend(p,a,rate,horizon){
 const rows=p.rows;
 if(!rows.length)return '<p class="missing">La curva se habilita con la primera lectura UT.</p>';
 const last=rows.at(-1),t0=Date.parse(rows[0].date),t1=Date.parse(last.date);
 const duration=rate>0&&Number.isFinite(p.retire)&&last.mm>p.retire?Math.min(horizon,(last.mm-p.retire)/rate):0;
 const end=t1+duration*YEAR*86400000,values=[...rows.map(r=>r.mm),p.alarm,p.retire].filter(Number.isFinite);
 const hi=Math.max(...values)*1.05,lo=Math.min(...values)*.95;
 const x=t=>60+660*(t-t0)/Math.max(end-t0,86400000),y=v=>195-160*(v-lo)/Math.max(hi-lo,.001);
 const grid=Array.from({length:5},(_,i)=>{const v=lo+(hi-lo)*i/4;return '<text x="4" y="'+(y(v)+4)+'">'+v.toFixed(2)+'</text><path d="M60 '+y(v)+'h660" stroke="#d9ded8"/>'}).join('');
 const threshold=(v,c)=>Number.isFinite(v)?'<path d="M60 '+y(v)+'h660" stroke="'+c+'" stroke-dasharray="3 3"/>':'';
 const pairs=rows.map(r=>[x(Date.parse(r.date)),y(r.mm)]);
 let projection='';
 if(duration>0){const xe=x(end),ye=y(last.mm-rate*duration),xl=x(t1),yl=y(last.mm);projection='<path d="M'+xl+' '+yl+'L'+xe+' '+ye+'V195H'+xl+'Z" fill="#ff9e5630"/><path d="M'+xl+' '+yl+'L'+xe+' '+ye+'" stroke="#be582c" stroke-width="3" stroke-dasharray="8 5"/>'}
 return '<svg class="forecast" viewBox="0 0 750 235" role="img" aria-label="Mediciones y espesor proyectado en milímetros según fecha"><text x="4" y="20">mm</text>'+grid+threshold(p.alarm,'#ad800b')+threshold(p.retire,'#a83b32')+projection+'<polyline points="'+pairs.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#246c82" stroke-width="3"/>'+pairs.map(([cx,cy])=>'<circle cx="'+cx+'" cy="'+cy+'" r="5" stroke="white" stroke-width="2" fill="#246c82"/>').join('')+'<text x="60" y="224">'+rows[0].date+'</text><text x="720" y="224" text-anchor="end">'+(duration?offset(last.date,duration):last.date)+'</text></svg>';
}
