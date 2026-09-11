document.documentElement.classList.add('js');
const menu=document.querySelector('.menu'),navigation=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.dataset.open=String(open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');navigation.dataset.open='false';menu.focus();}});
if(!location.pathname.startsWith('/showcase/products/'))document.querySelector('[data-showcase]')?.setAttribute('href','/showcase/#work');

const form=document.querySelector('[data-project]');
if(form){
 const result=document.querySelector('[data-result]');
 const error=document.querySelector('[data-error]');
 const fields=[...form.querySelectorAll('select')];
 const params=new URLSearchParams(location.search);
 const titles={renovation:'Room renovation design',furnishing:'Furnishing & finish edit',materials:'Materials consultation'};
 const scope={renovation:['Develop a brief and layout options for the defined room.','Prepare a material schedule and agreed joinery or counter design-intent drawings.','Keep construction, fabrication, approvals and contractor management in separately appointed scopes.'],furnishing:['Develop a furniture arrangement around the agreed retained objects.','Prepare a finish palette and selection schedule for one room.','Exclude built-in joinery, building works, electrical design and installation.'],materials:['Prepare for one focused room or material decision.','Discuss direction in a paid 90-minute consultation, with its fee and availability agreed first.','Provide a short direction note; no technical specification, certification or procurement.']};
 let downloadText='';
 form.reset();
 for(const name of ['space','service']){const select=form.elements.namedItem(name);if([...select.options].some(o=>o.value===params.get(name)))select.value=params.get(name);}
 if(params.has('space')||params.has('service'))history.replaceState(null,'',location.pathname);
 form.querySelector('[data-submit]').disabled=false;
 function list(selector,items){const target=document.querySelector(selector);target.replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
 function clear(){form.reset();fields.forEach(f=>f.removeAttribute('aria-invalid'));error.hidden=true;result.hidden=true;form.hidden=false;downloadText='';document.querySelector('[data-download-status]').textContent='';fields[0].focus();}
 form.querySelector('[data-clear]').addEventListener('click',clear);
 document.querySelector('[data-reset]').addEventListener('click',clear);
 document.querySelector('[data-edit]').addEventListener('click',()=>{result.hidden=true;form.hidden=false;fields[0].focus();});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const invalid=fields.filter(field=>!field.value||![...field.options].some(o=>o.value===field.value));
  fields.forEach(field=>field.setAttribute('aria-invalid',String(invalid.includes(field))));
  if(invalid.length){error.textContent='Choose an option for all six questions before preparing your note.';error.hidden=false;invalid[0].focus();return;}
  error.hidden=true;
  const data=Object.fromEntries(fields.map(field=>[field.name,field.value]));
  const gaps=[];
  if(data.location==='elsewhere')gaps.push('This project is outside our metropolitan Melbourne service area. No remote coverage, travel or design availability is assumed. Discuss an appropriate local studio before progressing.');
  if(data.responsibility==='tenant')gaps.push('Permission to change the premises is unresolved. Confirm the owner or landlord position before a design appointment or works scope is assumed.');
  if(data.stage==='building')gaps.push('Building work has already started. First establish decisions already committed and coordinate with the appointed contractor; no rapid turnaround or active-site support is assumed.');
  if(data.service==='furnishing'&&data.space!=='reading')gaps.push('Confirm a loose-furnishings-only brief. A furnishing edit does not redesign fixed kitchen units, the bakery counter, services or the operational layout.');
  const preparation=[];
  preparation.push(data.space==='kitchen'?'Describe simultaneous cooking, dining and family routines, and identify the existing fixed elements.':data.space==='reading'?'Describe reading and working habits, where light is useful and how people pass through the room.':'Describe ordering, collection and waiting habits; identify the defined front-of-house area and the operator responsibilities.');
  preparation.push(data.retained==='keep'?'Make a retained-object list with dimensions and ordinary context photographs for a future conversation. Do not upload them here.':'Begin by identifying what already works in the room before assuming everything should be replaced.');
  preparation.push(data.stage==='ideas'?'Bring the decisions you are unsure about and a rough separation between design and supply/build allowances.':data.stage==='ready'?'Prepare the room dimensions, scope priorities and separate design, supply and build allowances for discussion.':'Ask the contractor for the current scope, committed dimensions and outstanding decision deadlines before further design is planned.');
  preparation.push(data.responsibility==='appointed'?'Confirm who is verifying site dimensions, services, fabrication and installation with the already appointed contractor.':data.responsibility==='appoint'?'Identify the suppliers and specialists you will appoint separately; the studio does not manage construction.':'Resolve written permission and responsibility for the premises before discussing design instructions.');
  const heading=data.location==='elsewhere'?'A location conversation comes first.':data.responsibility==='tenant'?'Resolve permission before design.':gaps.length?'A few boundaries to agree first.':'A useful brief for a first conversation.';
  const summary=`Your starting service is ${titles[data.service].toLowerCase()}. ${gaps.length?'The conditions below need to be resolved before an appointment or package can be discussed.':'The next step would be a scoped, paid consultation, subject to an agreed fee and studio availability.'} This note does not confirm acceptance.`;
  document.querySelector('#result-title').textContent=heading;
  document.querySelector('[data-summary]').textContent=summary;
  const context=fields.map(field=>`${form.querySelector(`label[for="${field.id}"]`).textContent}: ${field.selectedOptions[0].textContent}`).join(' · ');
  document.querySelector('[data-context]').textContent=context;
  document.querySelector('[data-gap]').hidden=!gaps.length;
  list('[data-gap-list]',gaps);list('[data-scope]',scope[data.service]);list('[data-preparation]',preparation);
  downloadText=['LINEN & PLASTER','LOCAL PROJECT PREPARATION NOTE','',heading,summary,'',...fields.map(field=>`${form.querySelector(`label[for="${field.id}"]`).textContent}: ${field.selectedOptions[0].textContent}`),'',...(gaps.length?['RESOLVE FIRST',...gaps.map(x=>'- '+x),'']:[]),'STUDIO SCOPE',...scope[data.service].map(x=>'- '+x),'','PREPARATION',...preparation.map(x=>'- '+x),'','Fictional studio / concept website. No enquiry sent, quote issued, availability confirmed or appointment made. Choices are held only in the current page and discarded on refresh or departure. This downloaded file remains on your device.'].join('\n');
  form.hidden=true;result.hidden=false;document.querySelector('#result-title').focus();
 });
 document.querySelector('[data-download]').addEventListener('click',()=>{if(!downloadText)return;const url=URL.createObjectURL(new Blob([downloadText],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='linen-plaster-project-note.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);document.querySelector('[data-download-status]').textContent='Project note download prepared. Nothing was sent to the studio.';});
 window.addEventListener('pageshow',event=>{if(event.persisted)clear();});
}
