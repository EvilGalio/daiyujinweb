import {projects} from './data.js';

document.documentElement.classList.add('js');
const toggle=document.querySelector('.nav-toggle');
const navigation=document.querySelector('#site-nav');
if(toggle&&navigation){
 toggle.hidden=false;
 const close=()=>{toggle.setAttribute('aria-expanded','false');navigation.removeAttribute('data-open');};
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));navigation.toggleAttribute('data-open',open);if(open)navigation.querySelector('a')?.focus();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){close();toggle.focus();}});
 navigation.addEventListener('click',event=>{if(event.target.closest('a'))close();});
}
const filters=[...document.querySelectorAll('[data-filter]')];
if(filters.length){
 const applyFilter=value=>{const kind=['reuse','new'].includes(value)?value:'all';let count=0;document.querySelectorAll('.projects-index .project-card').forEach(card=>{card.hidden=kind!=='all'&&card.dataset.kind!==kind;if(!card.hidden)count++;});filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===kind)));document.querySelector('.result-count').textContent=count+' project'+(count===1?'':'s')+' shown';};
 filters.forEach(button=>button.addEventListener('click',()=>{applyFilter(button.dataset.filter);const url=new URL(location.href);url.searchParams.set('type',button.dataset.filter);history.replaceState(null,'',url);}));
 applyFilter(new URL(location.href).searchParams.get('type'));
}
const form=document.querySelector('#project-form');
if(form){
 const el=id=>document.getElementById(id);
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 let reference=projects.find(p=>p.slug===new URL(location.href).searchParams.get('project'));
 let prepared=null;
 const result=el('project-result');
 el('prepare').disabled=false;
 if(reference){el('reference-project').hidden=false;el('reference-name').textContent=reference.name;el('kind').value=reference.kind;el('use').value=reference.use;}
 const syncArea=()=>{el('area').disabled=el('area-unknown').checked;};
 const invalidate=()=>{if(prepared){prepared=null;result.hidden=true;el('form-status').textContent='Answers changed. Prepare a new note to use the current choices.';}};
 form.addEventListener('input',()=>{syncArea();invalidate();});
 form.addEventListener('change',()=>{syncArea();invalidate();});
 form.addEventListener('submit',event=>{
  event.preventDefault();syncArea();if(!form.reportValidity())return;
  const value=id=>el(id).value;
  const label=id=>el(id).selectedOptions[0].textContent;
  const kind=value('kind'),region=value('region'),stage=value('stage'),use=value('use'),drawings=value('drawings');
  const area=el('area-unknown').checked?null:Number(value('area'));
  const title=region==='outside'?'Outside our normal project area':area>800?'A capacity conversation comes first':kind==='new'?'Start with the site and daily life':kind==='interior'?'Start with the shared activities':'Start with the existing place';
  const intro=region==='outside'?'Our usual commissions are in Denmark. This outline identifies questions for a separately scoped location discussion; it is not an accepted enquiry.':area>800?'This indicative area is larger than the scope we normally begin with. Confirm team capacity and the wider project arrangement before assuming a commission can proceed.':'The first conversation should identify the question that matters, the information available and the decisions the next stage needs to support.';
  const questions=kind==='reuse'?['Which parts of the existing building are valued and should be retained?','What is known about the present condition, and what still needs a survey?']:kind==='new'?['What site information is available, and which constraints remain unconfirmed?','How should shared rooms, quiet rooms and outdoor space relate?']:['Which activities need to share the space, and which need separation?','What furniture, storage and existing finishes should remain?'];
  questions.push(use==='home'?'How do the household’s daily routines shape the brief?':use==='housing'?'Who represents the households, and how will shared decisions be made?':'Who uses and operates the space, and how do their activities change through the day?');
  if(area===null)questions.push('What would help establish a useful indicative area before the options are compared?');
  if(area>800)questions.push('How could the larger programme be scoped, phased and coordinated with an appropriately sized team?');
  if(region==='outside')questions.push('Which locally appointed parties would be needed, and is there a suitable role for this Denmark-based practice?');
  const steps=[stage==='idea'?'Write one paragraph about the change you hope the project will make.':stage==='site'?'List the information available about the identified place and the questions it cannot yet answer.':'Bring the first brief and mark the priorities that are agreed versus still open.',drawings==='available'?'List the existing drawings and their dates; identify what has changed since they were made.':drawings==='missing'?'Identify which records are missing. Agree what needs to be established before treating an option as feasible.':'Gather the known site information. The absence of an existing building does not resolve site constraints.','Identify who can make decisions and who will appoint the wider consultant and construction team.'];
  const answers=[['Kind of work',label('kind')],['Region',label('region')],['Indicative area',area===null?'Not yet known':area+' m²'],['Current stage',label('stage')],['Intended use',label('use')],['Existing drawings',label('drawings')]];
  if(reference)answers.unshift(['Reference study',reference.name]);
  prepared={title,intro,answers,questions,steps};
  el('result-title').textContent=title;el('result-intro').textContent=intro;
  el('result-answers').innerHTML=answers.map(([key,text])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(text)+'</dd></div>').join('');
  el('result-questions').innerHTML=questions.map(text=>'<li>'+esc(text)+'</li>').join('');
  el('result-steps').innerHTML=steps.map(text=>'<li>'+esc(text)+'</li>').join('');
  el('form-status').textContent='Your local preparation note is ready. Nothing has been sent.';result.hidden=false;result.focus();
 });
 el('edit').addEventListener('click',()=>{invalidate();el('kind').focus();});
 el('clear').addEventListener('click',()=>{form.reset();reference=undefined;prepared=null;result.hidden=true;el('reference-project').hidden=true;const url=new URL(location.href);url.searchParams.delete('project');history.replaceState(null,'',url);syncArea();el('form-status').textContent='Choices and reference project cleared.';el('kind').focus();});
 el('download').addEventListener('click',()=>{
  if(!prepared)return;
  const text=['ALDER INTERVAL ARCHITECTS','Fictional company / local preparation note / nothing sent','',prepared.title,prepared.intro,'',...prepared.answers.map(([key,value])=>key+': '+value),'','QUESTIONS TO BRING',...prepared.questions.map(t=>'- '+t),'','BEFORE THE CONVERSATION',...prepared.steps.map(t=>'- '+t),'','A discussion aid only. No appointment, quote, technical assessment, planning decision or agreed commission. This downloaded copy stays on your device.'].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='alder-interval-project-note.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
