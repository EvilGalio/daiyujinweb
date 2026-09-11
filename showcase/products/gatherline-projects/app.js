import {projects,pathChoice,pathText,emphasisLabels,formats,audienceLabels,spaceLabels,briefChoice,briefText} from './data.js';
import {pathMarkup} from './visuals.js';
for(const link of document.querySelectorAll('[data-showcase]')){if(!location.pathname.includes('/showcase/products/'))link.href='/showcase/#work';}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const controls=document.querySelector('#path-controls');let resetPath=()=>{};
if(controls){
 const project=document.querySelector('#path-project'),time=document.querySelector('#path-time'),emphasis=document.querySelector('#path-emphasis'),output=document.querySelector('#path-output'),inspector=document.querySelector('#station-inspector'),status=document.querySelector('#path-status');
 let choice;
 function render(){choice=pathChoice(project.value,Number(time.value),emphasis.value);output.innerHTML=pathMarkup(choice);for(const button of output.querySelectorAll('button'))button.disabled=false;inspector.hidden=true;inspector.innerHTML='';status.textContent=choice.project.name+' / '+choice.total+' minutes / '+emphasisLabels[choice.emphasis]+'. '+choice.stops.length+' content stops, nothing booked.';}
 resetPath=(focus=false)=>{project.value=projects[0].id;time.value='20';emphasis.value='objects';render();if(focus)project.focus();};
 controls.disabled=false;document.querySelector('#download-path').disabled=false;document.querySelector('#reset-path').disabled=false;
 resetPath();
 controls.addEventListener('change',render);
 output.addEventListener('click',event=>{const button=event.target.closest('[data-station]');if(!button)return;const station=choice.stops.find(s=>s.index===Number(button.dataset.station));if(!station)return;inspector.innerHTML=`<h4 id="station-title">${station.name} / ${station.minutes} minutes</h4><p>${station.action}</p><p><strong>Who would own it</strong><br>${station.owner}</p><p>Illustrative content time only. Walking, queues, assistance and venue operations are excluded.</p>`;inspector.hidden=false;inspector.focus();status.textContent='Inspecting '+station.name+' in '+choice.project.name+'.';});
 document.querySelector('#download-path').addEventListener('click',()=>{download(pathText(choice),'gatherline-'+choice.project.id+'-'+choice.total+'-'+choice.emphasis+'.txt');status.textContent='The displayed content sequence was downloaded locally. Nothing was sent.';});
 document.querySelector('#reset-path').addEventListener('click',()=>resetPath(true));
 for(const link of document.querySelectorAll('[data-path-project]'))link.addEventListener('click',()=>{project.value=link.dataset.pathProject;render();});
}
const form=document.querySelector('#brief-form');let resetBrief=()=>{};
if(form){
 const fields=document.querySelector('#brief-fields'),error=document.querySelector('#brief-error'),panel=document.querySelector('#brief-panel'),result=document.querySelector('#brief-result'),status=document.querySelector('#brief-status');
 let current=null;
 form.reset();fields.disabled=false;
 const query=new URLSearchParams(location.search);const requested=query.get('format');if(Object.hasOwn(formats,requested)){document.querySelector('#format').value=requested;history.replaceState({},'',location.pathname+location.hash);}
 const showError=message=>{error.textContent=message;error.hidden=false;error.focus();};
 resetBrief=(focus=false)=>{form.reset();current=null;result.innerHTML='';result.hidden=true;panel.hidden=false;error.hidden=true;status.textContent='Choices cleared. No information has been sent.';if(focus)document.querySelector('#format').focus();};
 form.addEventListener('submit',event=>{
  event.preventDefault();const format=document.querySelector('#format').value,audience=document.querySelector('#audience').value,visitors=Number(document.querySelector('#visitors').value),space=document.querySelector('#space').value,weeks=Number(document.querySelector('#weeks').value);
  if(!Object.hasOwn(formats,format))return showError('Choose the event format to prepare.');
  if(!Object.hasOwn(audienceLabels,audience))return showError('Choose the intended audience.');
  if(!Number.isInteger(visitors)||visitors<20||visitors>300)return showError('Enter a whole number of intended visitors from 20 to 300. This is not venue capacity.');
  if(!Object.hasOwn(spaceLabels,space))return showError('Choose the broad space position, including unconfirmed if needed.');
  if(!Number.isInteger(weeks)||weeks<1||weeks>26)return showError('Enter a whole number of weeks from 1 to 26.');
  if(!document.querySelector('#local-confirm').checked)return showError('Confirm the local-demo and no-booking boundary before preparing the brief.');
  current=briefChoice(format,audience,visitors,space,weeks);error.hidden=true;panel.hidden=true;
  result.innerHTML=`<span class="eyebrow">Local project preparation / nothing sent</span><h2 id="brief-result-title">${current.title}</h2><dl class="result-meta"><div><dt>Format and audience</dt><dd>${current.offer.label}<br>${audienceLabels[audience]}</dd></div><div><dt>Intended programme visitors</dt><dd>${visitors} / not concurrent capacity</dd></div><div><dt>Space</dt><dd>${spaceLabels[space]}</dd></div><div><dt>Lead time to discuss</dt><dd>${weeks} weeks</dd></div></dl>${current.issues.length?`<div class="note scope-issues"><strong>Before detailed design</strong><ul>${current.issues.map(issue=>'<li>'+issue+'</li>').join('')}</ul></div>`:''}<h3>The visitor invitation</h3><p>${current.offer.direction}</p><p class="note">${current.offer.sequence}</p><h3>A production package to scope</h3><p>${current.offer.package}</p><p><strong>Starting planning window: ${current.offer.min}–${current.offer.max} weeks.</strong> This is a discussion reference, not availability or a delivery promise.</p><h3>Audience and setting</h3><p>${current.audienceNote}</p><p>${current.spaceNote}</p><h3>Start with these owners</h3><ol><li><strong>Client:</strong> approve content, appoint a venue contact and own actual guest/consent arrangements.</li><li><strong>Gatherline:</strong> develop the story, content sequence and agreed production coordination.</li><li><strong>Venue and specialists:</strong> confirm site conditions, technical design, access, permissions and operations.</li></ol><p class="note">No fee, booking, ticket, guest record, supplier order, permit or safety/access approval is created. Delivery outside Catalonia requires a separate arrangement.</p><div class="actions"><button class="button" type="button" data-action="download">Download this brief (TXT)</button><button class="button light" type="button" data-action="edit">Edit the brief</button><button class="button light" type="button" data-action="clear">Clear and start again</button></div>`;
  result.hidden=false;result.focus();status.textContent='Your selected scope was prepared locally. Nothing was sent or scheduled.';
 });
 form.addEventListener('reset',()=>{error.hidden=true;});
 document.querySelector('#clear-brief').addEventListener('click',()=>resetBrief(true));
 result.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action==='download'&&current){download(briefText(current),'gatherline-'+current.format+'-project-brief.txt');status.textContent='Your local project brief was downloaded. Nothing was sent.';}else if(action==='edit'){result.hidden=true;panel.hidden=false;document.querySelector('#format').focus();status.textContent='Edit your existing choices and prepare the brief again.';}else if(action==='clear')resetBrief(true);});
}
window.addEventListener('pagehide',()=>{resetPath();resetBrief();});
