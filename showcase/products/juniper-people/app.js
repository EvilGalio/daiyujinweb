import {services,roleFocus,evidenceQuestions} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');
const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
nav?.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.setAttribute('aria-expanded','false');nav.classList.remove('open');menu.focus();}});
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const functionFilter=document.querySelector('#role-function');
if(functionFilter){const setting=document.querySelector('#role-setting');const rows=[...document.querySelectorAll('.role-row')];const update=()=>{let count=0;for(const row of rows){const visible=(functionFilter.value==='all'||row.dataset.function===functionFilter.value)&&(setting.value==='all'||row.dataset.setting===setting.value);row.hidden=!visible;if(visible)count++;}document.querySelector('#role-count').textContent=`${count} of 3 example roles`;document.querySelector('#role-empty').hidden=count!==0;};functionFilter.addEventListener('change',update);setting.addEventListener('change',update);document.querySelector('#reset-filters').addEventListener('click',()=>{functionFilter.value='all';setting.value='all';update();functionFilter.focus();});}
const form=document.querySelector('#hiring-form');
if(form){
  const result=document.querySelector('#brief-result');const error=document.querySelector('#form-error');let outline='';
  const fields={service:form.elements.namedItem('service'),role:form.elements.namedItem('role'),people:form.elements.namedItem('people'),region:form.elements.namedItem('region'),start:form.elements.namedItem('start'),readiness:form.elements.namedItem('readiness'),owner:form.elements.namedItem('owner'),ack:form.elements.namedItem('ack')};
  const invalidate=()=>{result.hidden=true;outline='';error.textContent='';Object.values(fields).forEach(field=>field.removeAttribute('aria-invalid'));};
  const clear=()=>{form.reset();invalidate();};
  const params=new URLSearchParams(location.search);for(const name of ['service','role']){const value=params.get(name);if(value&&[...fields[name].options].some(option=>option.value===value))fields[name].value=value;}if(location.search)history.replaceState(null,'',location.pathname+location.hash);
  form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
  const showError=(field,message)=>{error.textContent=message;field.setAttribute('aria-invalid','true');field.focus();};
  form.addEventListener('submit',event=>{
    event.preventDefault();invalidate();
    for(const [name,label] of [['service','service'],['role','role focus'],['region','region'],['start','intended start'],['readiness','role-brief readiness'],['owner','decision owner']]){if(!fields[name].value){showError(fields[name],'Choose a '+label+' before preparing the brief.');return;}}
    const people=Number(fields.people.value);if(!Number.isInteger(people)||people<1||people>15){showError(fields.people,'Enter a whole number of people from 1 to 15.');return;}
    if(!fields.ack.checked){showError(fields.ack,'Acknowledge the local demonstration before continuing.');return;}
    const service=services.find(s=>s.id===fields.service.value);const gaps=[];
    if(fields.readiness.value==='draft')gaps.push('The role brief is still a draft. Resolve the responsibilities, work pattern and relevant evidence before agreeing an engagement.');
    if(fields.owner.value==='missing')gaps.push('A decision owner is not yet assigned. Name the person who can agree the scope and coordinate decisions.');
    if(fields.start.value==='soon')gaps.push('A start within 30 days needs a timing discussion. No search, workshop or start date is reserved or confirmed.');
    if(people>5)gaps.push(`${people} people requires a discussion about separate roles or cohorts and the order of work; this outline does not assume one combined engagement.`);
    if(fields.region.value==='outside')gaps.push('The requested region is outside Austin, Round Rock and Georgetown. Regional fit must be discussed before any engagement is proposed.');
    if(fields.role.value==='other')gaps.push('The role focus is outside operations, support and inventory planning. Confirm whether the work fits Juniper before proposing a service.');
    const questions=[evidenceQuestions[fields.role.value],...gaps];
    if(!gaps.length)questions.push('Discuss the remaining responsibilities, fees and schedule before deciding whether to agree an engagement.');
    const summary=[['Service',service.name],['Role focus',roleFocus[fields.role.value]],['People in scope',String(people)],['Region',fields.region.selectedOptions[0].textContent],['Intended start',fields.start.selectedOptions[0].textContent],['Role brief',fields.readiness.selectedOptions[0].textContent],['Decision owner',fields.owner.selectedOptions[0].textContent]];
    document.querySelector('#brief-status').textContent=gaps.length?`${gaps.length} scope ${gaps.length===1?'question remains':'questions remain'} before an engagement can be discussed.`:'Ready to discuss the context. No engagement is agreed.';
    document.querySelector('#brief-summary').replaceChildren(...summary.map(([label,value])=>{const row=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;row.append(dt,dd);return row;}));
    for(const [selector,items] of [['#brief-questions',questions],['#brief-agenda',service.agenda]])document.querySelector(selector).replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    document.querySelector('#brief-deliverable').textContent=service.deliverable;
    outline=`JUNIPER PEOPLE / LOCAL HIRING OUTLINE\nFictional company / concept demonstration\n\n${summary.map(([label,value])=>label+': '+value).join('\n')}\n\nQUESTIONS TO DISCUSS\n${questions.join('\n')}\n\nCONVERSATION AGENDA\n${service.agenda.join('\n')}\n\nPOSSIBLE HANDOVER\n${service.deliverable}\n\nLIMITS\nNo real vacancy, candidate assessment, application, CV collection, recruitment search, workshop booking, email, hire or start date. No engagement is agreed. The website stores nothing; this downloaded file contains the choices above.\n`;
    result.hidden=false;result.focus();
  });
  document.querySelector('#download-brief').addEventListener('click',()=>{if(outline)download('juniper-hiring-outline.txt',outline);});
  document.querySelector('#edit-brief').addEventListener('click',()=>{invalidate();fields.service.focus();});
  document.querySelector('#clear-brief').addEventListener('click',()=>{clear();fields.service.focus();});
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',event=>{if(event.persisted)clear();});
}
