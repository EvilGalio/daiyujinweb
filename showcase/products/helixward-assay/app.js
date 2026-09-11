import {services,records,mean} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');
const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
nav?.addEventListener('keydown',event=>{if(event.key==='Escape'){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.focus();}});
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const group=document.querySelector('#report-group');
if(group){
  const mode=document.querySelector('#report-mode');
  const tbody=document.querySelector('#report-rows');
  const detail=document.querySelector('#record-detail');
  let selected=null;
  const visible=()=>records.filter(r=>group.value==='all'||r.group===group.value);
  const delta=()=>mode.value==='adjusted'?mean(records[0].values):0;
  function inspect(id){
    selected=id;const r=records.find(row=>row.id===id);const adjusted=mode.value==='adjusted';
    detail.innerHTML=`<h2>${r.id} / ${r.label}</h2><p>Raw readings: ${r.values.join(', ')}. Raw mean: (${r.values.join(' + ')}) / 3 = ${mean(r.values).toFixed(1)}.</p><p>${adjusted?`Background mean: (48 + 50 + 52) / 3 = 50.0. Displayed readings: ${r.values.map(v=>(v-50).toFixed(1)).join(', ')}. Displayed mean: ${mean(r.values).toFixed(1)} − 50.0 = ${(mean(r.values)-50).toFixed(1)}.`:'The displayed values are the unchanged raw readings and their arithmetic mean.'}</p><p>Synthetic record / HW-DEMO-01 / arbitrary response units. No concentration, pass/fail or biological meaning is inferred.</p>`;
  }
  function render(){const rows=visible();const d=delta();tbody.innerHTML=rows.map(r=>`<tr><td><button type="button" data-record="${r.id}" aria-label="Inspect record ${r.id}">${r.id}</button></td>${r.values.map(v=>`<td>${(v-d).toFixed(1)}</td>`).join('')}<td>${(mean(r.values)-d).toFixed(1)}</td></tr>`).join('');document.querySelector('#record-count').textContent=`${rows.length} records / ${rows.length*3} readings`;document.querySelector('#calculation-label').textContent=d?'Background-adjusted / arbitrary units':'Raw response / arbitrary units';document.querySelector('#report-caption').textContent=d?'Each raw reading and mean minus the background mean of 50, in arbitrary units':'Raw values and arithmetic mean, in arbitrary instrument-response units';if(selected&&rows.some(r=>r.id===selected))inspect(selected);else{selected=null;detail.innerHTML='<h2>Choose a record to follow it.</h2><p>The record link shows the individual readings and the exact arithmetic behind the current displayed mean.</p>';}}
  group.addEventListener('change',render);mode.addEventListener('change',render);
  tbody.addEventListener('click',event=>{const button=event.target.closest('[data-record]');if(button)inspect(button.dataset.record);});
  document.querySelector('#export-csv').addEventListener('click',()=>{const d=delta();const csv='report,view,record,group,raw_1,raw_2,raw_3,raw_mean,display_1,display_2,display_3,display_mean,units\n'+visible().map(r=>['HW-DEMO-01_SYNTHETIC',mode.value,r.id,r.group,...r.values,mean(r.values).toFixed(1),...r.values.map(v=>(v-d).toFixed(1)),(mean(r.values)-d).toFixed(1),'arbitrary_response'].join(',')).join('\n')+'\n';download(`helixward-${group.value}-${mode.value}.csv`,csv,'text/csv;charset=utf-8');});
  window.addEventListener('pageshow',event=>{if(event.persisted){group.value='all';mode.value='raw';selected=null;render();}});
  render();
}
const form=document.querySelector('#scope-form');
if(form){
  const fields=['service','material','method','count','window'];
  const elements=Object.fromEntries(fields.map(id=>[id,document.getElementById(id)]));
  const ack=document.querySelector('#ack');const result=document.querySelector('#scope-result');const error=document.querySelector('#form-error');let currentText='';
  const labels={material:{buffer:'Buffer-based research material',extract:'Prepared non-clinical research extract',unknown:'Composition not yet described',clinical:'Clinical or patient material'},method:{complete:'Complete method and calculation notes',partial:'Some notes; details still missing',none:'No written method yet'},window:{soon:'Within two weeks (unconfirmed)',six:'Within six weeks (unconfirmed)',flexible:'Flexible / ready to discuss'}};
  const invalid=()=>{result.hidden=true;currentText='';error.hidden=true;};
  const reset=()=>{form.reset();invalid();};
  const preset=new URLSearchParams(location.search).get('service');if(services.some(s=>s.id===preset))elements.service.value=preset;
  if(location.search){const url=new URL(location.href);url.searchParams.delete('service');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  form.addEventListener('input',invalid);form.addEventListener('change',invalid);
  form.addEventListener('submit',event=>{
    event.preventDefault();invalid();
    const messages={service:'Choose a requested service.',material:'Choose a research material category.',method:'Choose the written-method readiness.',count:'Enter a whole item count from 1 to 9999.',window:'Choose a desired start window.'};
    for(const id of fields){const element=elements[id];if(!element.value||!element.validity.valid||(id==='count'&&!Number.isInteger(Number(element.value)))){error.textContent=messages[id];error.hidden=false;element.focus();return;}}
    if(!ack.checked){error.textContent='Acknowledge the local demonstration boundary before preparing an outline.';error.hidden=false;ack.focus();return;}
    const service=services.find(s=>s.id===elements.service.value);const material=elements.material.value;const method=elements.method.value;const count=Number(elements.count.value);const windowValue=elements.window.value;
    const questions=[];const gaps=[];
    if(material==='clinical'){gaps.push('Clinical or patient material is outside this fictional research scope.');questions.push('Do not send clinical material or personal records. This outline cannot progress to a Helixward laboratory request.');}
    else{
      if(service.id==='pilot')questions.push('Define the one research question and the observation a feasibility study should make clearer.');
      if(service.id==='transfer')questions.push('Identify the source method, receiving instrument settings and calculation convention to compare.');
      if(service.id==='batch')questions.push('Identify the previously agreed method, coded item manifest and exception-reporting rules.');
      if(material==='buffer')questions.push('Describe the buffer-based research material and what is known about its background contribution.');
      if(material==='extract')questions.push('Prepare a non-confidential description of the non-clinical extract and any known variability. Do not provide preparation instructions here.');
      if(material==='unknown'){gaps.push('Material composition needs clarification before acceptance could be discussed.');questions.push('Clarify the material category with your team; keep all material where it is.');}
      if(method!=='complete'&&service.id!=='pilot'){gaps.push(`${service.name} needs the missing written method and calculation information discussed first.`);questions.push('List the missing method version, settings or calculation notes rather than guessing them.');}
      else if(method!=='complete')questions.push('Describe the observations you already have; creating a written scope is part of the feasibility conversation.');
      else questions.push('Bring the current method and calculation version to a separately arranged scope discussion. No file is uploaded here.');
      if(count>96){gaps.push(`${count} distinct items require a separate batch-scoping discussion; this is not an accepted run size.`);questions.push('Discuss how the item list could be divided and reported without assuming laboratory capacity.');}
      if(windowValue==='soon'){gaps.push('A start within two weeks is a request only; no available slot is confirmed.');questions.push('Explain the reason for the desired early start and discuss a feasible schedule separately.');}
      else questions.push('Agree the actual start and handover schedule only after scope review.');
    }
    const handover=material==='clinical'?['No laboratory handover is proposed for material outside the stated research scope.']:service.deliverables;
    const status=material==='clinical'?'Outside the stated research scope.':gaps.length?'Open questions remain before any scope could be agreed.':'An outline for discussion; no project has been accepted.';
    const summary=[['Requested service',service.name],['Material',labels.material[material]],['Written method',labels.method[method]],['Distinct research items',String(count)],['Desired start',labels.window[windowValue]]];
    document.querySelector('#scope-summary').innerHTML=summary.map(([key,value])=>`<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
    document.querySelector('#scope-status').textContent=status;document.querySelector('#scope-status').classList.toggle('warning',gaps.length>0);
    const allQuestions=[...gaps,...questions];document.querySelector('#scope-questions').replaceChildren(...allQuestions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    document.querySelector('#scope-deliverables').replaceChildren(...handover.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    currentText=`HELIXWARD ASSAY SERVICES / LOCAL RESEARCH OUTLINE\nFictional company / research-use-only demonstration\n\n${summary.map(([key,value])=>key+': '+value).join('\n')}\n\n${status}\n\nQUESTIONS\n${allQuestions.map(x=>'- '+x).join('\n')}\n\nPOSSIBLE HANDOVER\n${handover.map(x=>'- '+x).join('\n')}\n\nNo clinical service, assay recommendation, accepted material, laboratory work, quotation, start date, message or regulatory submission is created. Choices remain only on this page; downloaded files stay on your device.\n`;
    result.hidden=false;result.focus();
  });
  document.querySelector('#clear-scope').addEventListener('click',()=>{reset();elements.service.focus();});
  document.querySelector('#edit-scope').addEventListener('click',()=>{invalid();elements.service.focus();});
  document.querySelector('#download-scope').addEventListener('click',()=>{if(currentText)download('helixward-research-outline.txt',currentText,'text/plain;charset=utf-8');});
  window.addEventListener('pageshow',event=>{if(event.persisted)reset();});
}
