// Ejecutar con Node, Playwright y Microsoft Edge instalados.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
(async()=>{
  const browser=await chromium.launch({channel:"msedge"});
  try{
    const page=await browser.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("dialog",d=>d.accept());
    const url=process.argv[2]||"http://127.0.0.1:8793/";
    await page.goto(url+"#/panel",{waitUntil:"domcontentloaded"});
    await page.getByText("Plan consolidado de inspecciones").waitFor({timeout:120000});
    const go=async path=>{await page.evaluate(p=>location.hash=p,path);await page.waitForFunction(p=>location.hash===p,path);};
    const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("eq_integrity_project_v1")));
    const result=id=>page.evaluate(id=>JSON.parse(window.pyApi("evaluate",localStorage.getItem("eq_integrity_project_v1"),"2026-11-27")).equipos.find(e=>e.id===id),id);
    const tab=name=>page.locator('[data-tab="'+name+'"]').click();
    const edit=async(id,field,value)=>{await go("#/equipos/"+id);await tab("editar");await page.locator(field).fill(value);await page.locator("#btn-save-ed").click();};
    const first=await result(1);
    await go("#/equipos/1");await tab("espesores");
    await page.locator("#add-l-tml").selectOption(String(first.gobernante_ref.tml_id));
    await page.locator("#add-l-fecha").fill("2026-11-25");
    await page.locator("#add-l-esp").fill("4.60");await page.locator("#inc-ut").fill("0.02");
    await page.locator("#btn-add-lect").click();
    const second=await result(1);
    for(const key of ["vr","cr_adoptada","estado"])assert.notDeepEqual(second[key],first[key],key);
    assert.notEqual(second.inspeccion.fecha_limite,first.inspeccion.fecha_limite);
    assert.notEqual(second.rbi.df,first.rbi.df);
    await edit(1,"#ed-pres","6.5");const press=await result(1);
    assert(press.requerido.t_adm>second.requerido.t_adm);
    await edit(1,"#ed-temp","350");assert((await result(1)).requerido.t_adm>press.requerido.t_adm);
    const tank=await result(5);await edit(5,"#ed-niv","11");assert((await result(5)).tmls[0].t_adm<tank.tmls[0].t_adm);
    await go("#/equipos/3");await tab("rbi"); const before=(await result(3)).rbi;
    await page.locator("#rbi-ca").fill("700");await page.locator("#btn-save-rbi").click();
    const after=(await result(3)).rbi;assert.equal(after.ra,before.ra*2);assert.equal(after.re,before.re);
    await go("#/proyeccion");await page.locator("#equipo-pr").selectOption("1");await page.getByText(/Vida del escenario al/).waitFor();
    await go("#/proyecto");
    const backup=await read();const download=page.waitForEvent("download");await page.locator("#pr-export").click();
    const file=await (await download).path();assert.deepEqual(JSON.parse(await fs.readFile(file,"utf8")),backup);
    await page.locator("#pr-reset").click();await page.waitForURL(u=>u.hash==="#/panel");assert.notDeepEqual(await read(),backup);
    await go("#/proyecto");await page.locator("#pr-import").setInputFiles({name:"proyecto.json",mimeType:"application/json",buffer:await fs.readFile(file)});
    await page.waitForURL(u=>u.hash==="#/panel");assert.deepEqual(await read(),backup);
    await page.reload();await page.getByText("Plan consolidado de inspecciones").waitFor();assert.deepEqual(await read(),backup);
    assert.deepEqual(errors,[]);console.log("OK UT, estado, CR, VR, fecha, Df, presión, temperatura, nivel, consecuencias, proyección, JSON, adjuntos y persistencia",url);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
