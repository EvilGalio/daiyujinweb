import {places,units,fitLabels,money,rentNote} from './data.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const params=new URLSearchParams(location.search);
document.documentElement.classList.add('js');
const menu=$('.nav-toggle');
menu.hidden=false;
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));$('#site-nav').classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');$('#site-nav').classList.remove('open');menu.focus();}});
const removeQuery=name=>{const url=new URL(location.href);url.searchParams.delete(name);history.replaceState(null,'',url.pathname+url.search+url.hash);};
const labelOf=id=>{const input=$('#'+id);return input.selectedOptions?.[0]?.textContent??input.value;};
const download=(name,content)=>{const blob=new Blob([content],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};

if($('#space-filter')){
 const form=$('#space-filter');
 const min=$('#min-area'),max=$('#max-area');
 const selected=new Set();
 $('#apply-filter').disabled=false;
 document.querySelectorAll('[data-compare]').forEach(input=>{input.disabled=false;input.checked=false;});
 for(const id of ['use','place']){const value=params.get(id);if([...$('#'+id).options].some(o=>o.value===value))$('#'+id).value=value;}
 const filter=()=>{
  const lo=min.value===''?0:Number(min.value),hi=max.value===''?Infinity:Number(max.value);
  const invalid=lo>hi;
  max.setCustomValidity(invalid?'Maximum area must be at least the minimum area.':'');
  if(invalid||!form.checkValidity()){$('#filter-status').textContent=invalid?'Maximum area must be at least the minimum area. The previous results remain until the range is corrected.':'Use whole, non-negative areas up to 10,000 m². The previous results remain.';$('#filter-status').classList.add('error');return false;}
  let count=0;
  document.querySelectorAll('[data-unit]').forEach(card=>{const match=($('#use').value==='all'||card.dataset.use===$('#use').value)&&($('#fit').value==='all'||card.dataset.fit===$('#fit').value)&&($('#place').value==='all'||card.dataset.place===$('#place').value)&&Number(card.dataset.area)>=lo&&Number(card.dataset.area)<=hi;card.hidden=!match;if(match)count++;});
  $('#result-count').textContent=`${count} ${count===1?'space':'spaces'} shown`;
  $('#empty-results').hidden=count!==0;
  $('#filter-status').classList.remove('error');$('#filter-status').textContent=count?'Filters applied. Open a unit’s layout notes or compare the details.':'No example units match these filters.';
  return true;
 };
 form.addEventListener('input',()=>{max.setCustomValidity('');});
 form.addEventListener('submit',event=>{event.preventDefault();filter();});
 const reset=()=>{form.reset();max.setCustomValidity('');filter();removeQuery('use');removeQuery('place');};
 $('#reset-filter').addEventListener('click',reset);$('#empty-reset').addEventListener('click',reset);
 const renderCompare=()=>{
  const list=[...selected].map(slug=>units.find(u=>u.slug===slug));
  $('#compare-count').textContent=`(${list.length} of 3)`;
  if(!list.length){$('#compare-output').replaceChildren();$('#compare-status').textContent='Select a unit’s compare checkbox to start.';return;}
  const rows=[['Area',u=>`${u.area} m²`],['Use',u=>u.use==='office'?'Office':'Retail'],['Floor',u=>u.floor],['Fit-out',u=>fitLabels[u.fit]],['Base rent / month',u=>money(u.rent)],['Next step',u=>`<a href="viewing.html?space=${u.slug}">Prepare for ${u.id}</a>`],['Selection',u=>`<button type="button" class="compare-remove" data-remove="${u.slug}">Remove ${u.id}</button>`]];
  $('#compare-output').innerHTML=`<div class="table-scroll" tabindex="0" role="region" aria-label="Selected spaces comparison; scroll horizontally on small screens"><table><caption class="eyebrow" style="text-align:left;padding-bottom:15px">${list.length} selected example ${list.length===1?'unit':'units'}</caption><thead><tr><th scope="col">Compare</th>${list.map(u=>`<th scope="col">${u.id}<a href="${u.place}.html">${places.find(p=>p.slug===u.place).name}</a></th>`).join('')}</tr></thead><tbody>${rows.map(([name,fn])=>`<tr><th scope="row">${name}</th>${list.map(u=>`<td>${fn(u)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="price-note">${rentNote}</p>`;
  $('#compare-status').textContent=`${list.length} of 3 spaces selected. Filter changes keep your comparison; reload clears it.`;
  document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{selected.delete(button.dataset.remove);$(`[data-compare="${button.dataset.remove}"]`).checked=false;renderCompare();$('#comparison').setAttribute('tabindex','-1');$('#comparison').focus({preventScroll:true});}));
 };
 document.querySelectorAll('[data-compare]').forEach(input=>input.addEventListener('change',()=>{if(input.checked&&selected.size===3){input.checked=false;$('#compare-status').textContent='You can compare up to 3 spaces. Remove one before adding another; your three selections are unchanged.';return;}if(input.checked)selected.add(input.dataset.compare);else selected.delete(input.dataset.compare);renderCompare();}));
 filter();
}

if($('#viewing-form')){
 const form=$('#viewing-form');let note='';
 $('#prepare-viewing').disabled=false;
 const preset=units.find(u=>u.slug===params.get('space'));if(preset)$('#space').value=preset.slug;
 const snapshot=()=>{const u=units.find(u=>u.slug===$('#space').value);$('#unit-snapshot').hidden=!u;if(!u)return;$('#unit-snapshot').innerHTML=`<p class="eyebrow">Your example space</p><h3>${u.id} · ${places.find(p=>p.slug===u.place).name}</h3><p>${u.area} m² · ${u.floor} · ${fitLabels[u.fit]}</p><p>${money(u.rent)} illustrative base rent / month.</p><p>${rentNote}</p><a class="text-link" href="${u.place}.html#${u.slug}">Review this unit <span aria-hidden="true">↗</span></a>`;};
 const invalidate=()=>{if(!$('#viewing-result').hidden)$('#viewing-status').textContent='Answers changed. Prepare a new note to update the result.';$('#viewing-result').hidden=true;note='';snapshot();};
 form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);snapshot();
 form.addEventListener('submit',event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const u=units.find(u=>u.slug===$('#space').value);if(!u)return;
  const p=places.find(p=>p.slug===u.place),use=$('#business-use').value,fit=$('#fit-intent').value,timing=$('#timing').value,budget=$('#budget').value;
  const mismatch=use==='specialist'||(use==='office'&&u.use!=='office')||(use.startsWith('retail')&&u.use!=='retail');
  const title=mismatch?'Start with a use review.':`Prepare to explore ${u.id}.`;
  const intro=mismatch?`Your intended use does not match the ${u.use} assumption for ${u.id}, or falls outside the uses offered by these examples. Discuss this before any viewing or fit-out plan; this note is not approval.`:`A focused starting point for ${p.name}. These questions connect your plans to the ${u.area} m² example ${u.use} unit; no appointment has been made.`;
  const questions=[];
  if(mismatch)questions.push('Establish whether the intended use can be considered at all. Do not assume the example listing permits it.');
  else questions.push(u.use==='office'?'Describe how the team works, meets and welcomes visitors; do not infer desk capacity from area alone.':'Describe the non-food products or non-specialist services, customer visits and stock deliveries.');
  if(u.fit==='shell')questions.push(fit==='current'?'This unit is a shell, so there is no completed layout to move into. Agree the internal fit-out scope before setting a move-in plan.':'Scope the shell fit-out, required services and the division of responsibilities before any work is agreed.');
  else if(u.fit==='part-fitted')questions.push('Identify which existing partitions can remain and what preparation, lighting or finishes still need agreement.');
  else questions.push(fit==='current'?'Walk through the fitted layout and check which lighting and finishes are included. Furniture is not supplied.':'Identify which parts of the fitted layout would change and who must review the alteration before work begins.');
  if(fit==='fitout'&&u.fit!=='shell')questions.push('Explain why a full interior fit-out is needed and how existing elements would be handled.');
  if(fit==='reconfigure'&&u.fit==='shell')questions.push('Bring a first layout brief; a shell does not contain a finished arrangement to reconfigure.');
  questions.push(budget==='notyet'?'Add charges, utilities, tax and fit-out to your planning. The base rent excludes them, and this website does not estimate these costs.':'Confirm the separate allowances for charges, utilities, tax and fit-out; the example base rent does not include them.');
  questions.push(timing==='soon'?'Ask what reviews and fit-out preparation would be needed before your 1–3 month target. No availability or completion date is promised.':timing==='later'?'Use the 3–6 month target to discuss the order of reviews and fit-out decisions; no schedule is confirmed.':'Prioritise the questions that determine suitability before choosing a target date.');
  questions.push(p.question);
  const answers=[['Example space',`${u.id} · ${p.name}`],['Unit facts',`${u.area} m² · ${u.floor} · ${fitLabels[u.fit]}`],['Base rent / month',money(u.rent)],['Intended use',labelOf('business-use')],['Fit-out intention',labelOf('fit-intent')],['Timing',labelOf('timing')],['Other costs',labelOf('budget')]];
  $('#viewing-title').textContent=title;$('#viewing-intro').textContent=intro;$('#viewing-answers').innerHTML=answers.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');$('#viewing-questions').innerHTML=questions.map(q=>`<li>${esc(q)}</li>`).join('');
  note=['COMMON QUAY PLACES','Fictional company / local viewing preparation - not booked or sent','',title,intro,'',...answers.map(([k,v])=>`${k}: ${v}`),'',rentNote,'','Questions for the conversation',...questions.map((q,i)=>`${i+1}. ${q}`),'','No real address, booking, lease, use approval or price agreement. Choices clear on reload; this downloaded file remains on your device.'].join('\n');
  $('#viewing-result').hidden=false;$('#viewing-status').textContent='Your local note is ready. No viewing is scheduled and nothing has been sent.';$('#viewing-result').focus();
 });
 $('#download-viewing').addEventListener('click',()=>{if(note)download(`common-quay-${$('#space').value}-viewing-note.txt`,note);});
 $('#edit-viewing').addEventListener('click',()=>{$('#space').focus();});
 $('#clear-viewing').addEventListener('click',()=>{form.reset();$('#space').value='';removeQuery('space');note='';$('#viewing-result').hidden=true;snapshot();$('#viewing-status').textContent='Choices cleared. No information was sent or stored.';$('#space').focus();});
}

if($('#tenant-form')){
 const form=$('#tenant-form');$('#find-help').disabled=false;
 const preset=places.find(p=>p.slug===params.get('place'));if(preset)$('#tenant-place').value=preset.slug;
 form.addEventListener('change',()=>{$('#tenant-result').hidden=true;$('#tenant-status').textContent='Choices changed. Find your next step again to update the guidance.';});
 form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const p=places.find(p=>p.slug===$('#tenant-place').value);if(!p)return;const issue=$('#issue').value;
  const content={upkeep:{title:`Common-area help at ${p.name}.`,intro:'Prepare a short description for the place operations team. First establish whether the item is in a shared area or inside your own unit.',items:['Identify the shared area and what needs attention.','Describe the effect on normal access or use, without entering personal or security details here.',p.operations]},access:{title:`Access & deliveries at ${p.name}.`,intro:'Bring the relevant entrance and broad delivery requirements into one conversation before making arrangements.',items:[p.arrival,'Prepare the proposed delivery window, handling needs and any vehicle constraints to discuss.','Do not share entry codes, keys or personal access credentials through an open enquiry.']},alterations:{title:`Changes at ${p.name}.`,intro:'A proposed change needs an agreed scope and the appropriate review. This preparation is not consent to begin work.',items:['Identify the unit and the part of the layout, signage or services you want to change.','Prepare a description of the work and who would carry it out. Do not upload confidential plans to this demo.',p.question]},danger:{title:'This demo cannot send urgent help.',intro:'Do not wait for a response here. Use the posted emergency arrangements and actual emergency contacts for your real building.',items:['This is a fictional website with no help desk or dispatch connection.','The example operations address below is not a real emergency channel.','Follow the instructions supplied for your actual building and situation.']}}[issue];
  if(!content)return;$('#tenant-title').textContent=content.title;$('#tenant-intro').textContent=content.intro;$('#tenant-address').textContent=`Example contact only: ${p.email}`;$('#tenant-list-title').textContent=issue==='danger'?'Use the real building arrangements':'Information to prepare';$('#tenant-checklist').innerHTML=content.items.map(x=>`<li>${esc(x)}</li>`).join('');$('#tenant-result').hidden=false;$('#tenant-status').textContent='Guidance shown. No request has been sent.';$('#tenant-result').focus();
 });
}
