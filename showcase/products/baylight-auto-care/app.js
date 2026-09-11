import {packages,vehicles,money,hours,preferences} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');nav.classList.remove('open');menu.focus();}});
if(location.pathname.startsWith('/showcase/products/'))document.querySelector('[data-showcase]')?.setAttribute('href','/showcase/#work');

const form=document.querySelector('#visit-form');
if(form){
 const controls=document.querySelector('#visit-controls');
 const editor=document.querySelector('#request-editor');
 const result=document.querySelector('#visit-result');
 const error=document.querySelector('#form-error');
 const packageInput=form.elements.package,vehicle=form.elements.vehicle,condition=form.elements.condition,region=form.elements.region,preference=form.elements.preference,boot=form.elements.boot;
 let lastNote='';
 controls.disabled=false;
 const updateDraft=()=>{
  const p=packages[packageInput.value];
  document.querySelector('#draft-name').textContent=p?.name||'Choose a package.';
  document.querySelector('#draft-vehicle').textContent=vehicles[vehicle.value]?.description||'Choose a workload band to see the vehicle description.';
  document.querySelector('#draft-limit').textContent=p?.limit||'A physical inspection confirms the scope, finish and accessible areas.';
  const img=document.querySelector('.draft-image img');
  const imageId=p?packageInput.value:'bay';
  img.src=`assets/${imageId}-1536.webp`;img.srcset=`assets/${imageId}-768.webp 768w,assets/${imageId}-1536.webp 1536w`;img.alt=p?.photo||'Silver hatchback in the daylight workshop.';
 };
 const setPackage=()=>{
  const p=packages[packageInput.value];
  condition.replaceChildren(new Option(p?'Choose the condition':'Choose a package first',''));
  for(const c of p?.conditions||[])condition.add(new Option(c.label,c.id));
  condition.disabled=!p;boot.checked=false;boot.disabled=packageInput.value!=='cabin';updateDraft();
 };
 const clear=()=>{form.reset();setPackage();error.hidden=true;result.hidden=true;result.replaceChildren();editor.hidden=false;lastNote='';};
 const download=()=>{
  if(!lastNote)return;
  const url=URL.createObjectURL(new Blob([lastNote],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='baylight-visit-note.txt';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  document.querySelector('#download-status').textContent='Your visit note was created on this device. Nothing was sent and no visit is reserved.';
 };
 packageInput.addEventListener('change',setPackage);vehicle.addEventListener('change',updateDraft);
 form.addEventListener('change',()=>{error.hidden=true;});
 document.querySelector('[data-clear]').addEventListener('click',()=>{clear();packageInput.focus();});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const fields=[[packageInput,!!packages[packageInput.value],'Choose a package.'],[vehicle,!!vehicles[vehicle.value],'Choose a vehicle band.'],[condition,!!packages[packageInput.value]?.conditions.some(c=>c.id===condition.value),'Choose the condition to consider.'],[region,['perth','elsewhere'].includes(region.value),'Choose your service region.'],[preference,!!preferences[preference.value],'Choose a weekday visit preference.']];
  const invalid=fields.find(([,valid])=>!valid);
  if(invalid){error.textContent=invalid[2];error.hidden=false;invalid[0].focus();return;}
  error.hidden=true;
  const p=packages[packageInput.value];const v=vehicles[vehicle.value];
  const hasBoot=packageInput.value==='cabin'&&boot.checked;
  const conditionName=p.conditions.find(c=>c.id===condition.value).label;
  const reasons=[];
  if(vehicle.value==='other')reasons.push('This vehicle is outside the standard passenger-vehicle range. No package amount or time has been calculated.');
  if(region.value==='elsewhere')reasons.push('Baylight is a Perth metropolitan workshop service. This note does not offer a visit outside that area or a mobile service.');
  if(condition.value==='review')reasons.push(p.limit);
  const canCalculate=reasons.length===0;
  const [baseAmount,baseHours]=p.prices[vehicle.value]||[0,0];
  const total=baseAmount+(hasBoot?25:0),duration=baseHours+(hasBoot?.5:0);
  const preferenceText=preferences[preference.value];
  const timeNote=canCalculate&&duration>4&&preference.value==='afternoon'?'This work allowance is longer than a single afternoon. Discuss a morning handover and collection plan before agreeing a visit.':canCalculate?'Allow time for inspection as well as the work. The workshop would confirm handover and collection; your preference does not reserve a slot.':'Discuss the scope first. A weekday preference cannot confirm compatibility, an amount, duration or availability.';
  const title=canCalculate?'Your visit preparation note':vehicle.value==='other'||region.value==='elsewhere'?'Your scope needs a conversation':'Inspection comes first';
  const regionText=region.value==='perth'?'Perth metropolitan area':'Outside Perth metro';
  const moneyMarkup=canCalculate?`<div class="price-breakdown" aria-label="Illustrative price breakdown"><div class="price-line"><span>${p.name}<small>${v.name} vehicle / ${hours(baseHours)}</small></span><strong>${money(baseAmount)}</strong></div>${hasBoot?'<div class="price-line"><span>Empty-boot deep vacuum<small>Cabin add-on / 0.5 hour</small></span><strong>A$25.00</strong></div>':''}<div class="price-total"><span>Illustrative total<small>AUD, inclusive of GST</small></span><span data-total>${money(total)}<small data-duration>${hours(duration)} work allowance</small></span></div><p class="note muted" style="margin-top:18px">Preparation figures only. Inspection confirms the actual scope, final quote and time.</p></div>`:`<div class="result-gap"><h3>No calculated offer</h3><ul>${reasons.map(reason=>`<li>${reason}</li>`).join('')}</ul><p class="note">No final total or work duration is assigned. This is a scope note for review, not an approved service.</p></div>`;
  result.innerHTML=`<div class="job-heading"><div><p class="eyebrow">Baylight Auto Care / Local preparation</p><h2 tabindex="-1" id="result-title">${title}</h2></div><span class="status-label">${canCalculate?'Prepared, not booked':'Scope review required'}</span></div><div class="result-facts"><p><strong>Package & vehicle</strong>${p.name} / ${v.name}<br>${v.description}</p><p><strong>Condition selected</strong>${conditionName}</p><p><strong>Region</strong>${regionText}</p><p><strong>Visit preference</strong>${preferenceText}<br>No live availability check</p></div>${moneyMarkup}<section class="result-section"><h3>${canCalculate?'Scope to discuss':'Requested scope for review'}</h3><ul class="result-list">${p.included.map(item=>`<li>${item}</li>`).join('')}${hasBoot?'<li>Requested add-on: empty-boot deep vacuum, empty boot required.</li>':''}</ul><p style="margin-top:18px"><strong>Outside this package:</strong> ${p.excluded.join('; ')}.</p></section><section class="result-section"><h3>Prepare for the conversation</h3><p>${p.prepare}</p><p style="margin-top:15px">${timeNote}</p></section><p class="demo-notice" style="margin-top:28px;margin-bottom:0">Fictional company / local demonstration. This note is not sent, reserved or paid. Refreshing or leaving clears page selections. A downloaded file remains on your device.</p><div class="actions"><button class="button" type="button" data-download>Download visit note (TXT) ↓</button><button class="outline" type="button" data-edit>Edit selections</button><button class="outline" type="button" data-result-clear>Clear and start again</button></div><p id="download-status" class="download-status" role="status"></p>`;
  lastNote=`BAYLIGHT AUTO CARE / VISIT PREPARATION NOTE\nFictional company / local demonstration\n\nSTATUS: ${canCalculate?'PREPARED, NOT BOOKED':'SCOPE REVIEW REQUIRED'}\nPackage: ${p.name}\nVehicle: ${v.name} - ${v.description}\nCondition: ${conditionName}\nRegion: ${regionText}\nPreference: ${preferenceText}\nBoot deep vacuum: ${hasBoot?'Requested, empty boot required':'Not selected'}\n\n${canCalculate?`ILLUSTRATIVE AMOUNTS (AUD, inclusive of GST)\n${p.name}: ${money(baseAmount)} / ${hours(baseHours)}\n${hasBoot?'Empty-boot deep vacuum: A$25.00 / 0.5 hour\n':''}Total: ${money(total)}\nWork allowance: ${hours(duration)}\nNot a final quote or available appointment.`:`NO CALCULATED OFFER\n${reasons.join('\n')}\nNo final total or work duration assigned.`}\n\nREQUESTED SCOPE\n${p.included.join('\n')}\n\nOUTSIDE THIS PACKAGE\n${p.excluded.join('\n')}\n\nPREPARATION\n${p.prepare}\n${timeNote}\n\nNothing was sent. No booking, payment, email, plate, VIN or personal data. Page selections clear on refresh or departure. This downloaded file remains on your device.\n`;
  result.querySelector('[data-download]').addEventListener('click',download);
  result.querySelector('[data-edit]').addEventListener('click',()=>{result.hidden=true;editor.hidden=false;packageInput.focus();});
  result.querySelector('[data-result-clear]').addEventListener('click',()=>{clear();packageInput.focus();});
  editor.hidden=true;result.hidden=false;result.querySelector('#result-title').focus();
 });
 const initialPackage=new URLSearchParams(location.search).get('package');
 if(initialPackage){if(packages[initialPackage])packageInput.value=initialPackage;history.replaceState(null,'',location.pathname+location.hash);}
 setPackage();
 window.addEventListener('pagehide',clear);window.addEventListener('pageshow',event=>{if(event.persisted)clear();});
}
