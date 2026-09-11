document.documentElement.classList.add('js');
const menu=document.querySelector('.menu');
const navigation=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.dataset.open=String(open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');navigation.dataset.open='false';menu.focus();}});
if(!location.pathname.startsWith('/showcase/products/'))document.querySelector('.showcase-return').href='/showcase/#work';

const form=document.querySelector('#brief-form');
if(form){
  const output=document.querySelector('#brief-output');
  const error=document.querySelector('#form-error');
  const status=document.querySelector('#status-message');
  const task=document.querySelector('#task');
  const shifts=document.querySelector('#shifts');
  const variants=document.querySelector('#variants');
  const taskNames={assembly:'Screw-fastening assembly',tending:'Tray-fed machine tending',test:'Connector-test fixture',other:'Another task / whole factory'};
  const variationNames={stable:'One stable variant',mixed:'Several known variants',unknown:'Variants not yet defined'};
  const manualNames={load:'Loading or replenishment',inspect:'Inspection and reject review',changeover:'Changeovers and setup'};
  const evidence={
    assembly:['Representative enclosures, screws and assembly drawings.','Access to all fasteners, a locating proposal and known thread or seating defects.','Joint acceptance criteria owned by your product team.'],
    tending:['Part samples and the intended tray patterns.','Machine interface information and the person authorised to approve it.','A record of part orientation, swarf conditions and first-off approval steps.'],
    test:['Connector samples and drawings for each keyed variant.','The approved test recipe and known result conditions from your product team.','Contact access, cable-handling steps and the route for an incomplete test.']
  };
  let downloadText='';
  const preset=new URLSearchParams(location.search).get('task');
  if(Object.hasOwn(taskNames,preset))task.value=preset;
  const clearResult=()=>{output.hidden=true;output.replaceChildren();downloadText='';};
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  form.addEventListener('change',event=>{event.target.removeAttribute('aria-invalid');error.hidden=true;if(!output.hidden){clearResult();status.textContent='Choices changed. Create a new checklist to update the result.';}});
  form.addEventListener('reset',()=>{clearResult();error.hidden=true;form.querySelectorAll('[aria-invalid]').forEach(field=>field.removeAttribute('aria-invalid'));status.textContent='Choices and checklist cleared.';});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    clearResult();
    const invalid=[task,shifts,variants].filter(field=>!field.value);
    if(invalid.length){
      error.textContent='Choose an automation task, operating shifts and part variation before creating your checklist.';
      error.hidden=false;
      invalid.forEach(field=>field.setAttribute('aria-invalid','true'));
      invalid[0].focus();
      return;
    }
    error.hidden=true;
    const manual=[...form.querySelectorAll('input[name="manual"]:checked')].map(field=>field.value);
    const outside=task.value==='other';
    const unresolved=manual.length===0||variants.value==='unknown';
    const resultStatus=outside?'Outside our published task scope':unresolved?'Clarify the open hand-offs first':'Preparation checklist ready';
    const next=outside?'This request extends beyond our three published task types. Reduce it to one defined assembly, handling or connector-test operation before using this brief. No feasibility conclusion has been made.':unresolved?'An early discussion can still be useful. Define the operator hand-offs and part variants before commissioning an equipment build.':'Use this checklist to prepare a scoped feasibility conversation. The next commercial step would be an agreed, paid feasibility study, not an automatic equipment order.';
    const items=outside?['Describe one operation, its input part and the expected output.','Identify who owns any factory-wide integration outside that task.']:[...evidence[task.value]];
    if(!outside){
      items.push(shifts.value==='3'?'For three-shift operation, identify maintenance cover, planned access and recovery ownership on every shift.':shifts.value==='2'?'For two-shift operation, document the handover between shifts and access for maintenance.':'For one-shift operation, note the available maintenance window and the person responsible for daily setup.');
      items.push(variants.value==='mixed'?'Prepare a variant and changeover matrix, including the worst access and loading conditions.':variants.value==='unknown'?'List the intended variants before fixing the nest, gripper or test-contact design.':'Bring more than one sample of the stable variant, including normal production variation.');
      if(manual.length===0)items.push('Assign an owner to loading, inspection, exceptions and setup. These hand-offs are not defined in your choices.');
      if(manual.includes('load'))items.push('Record replenishment frequency and how the operator confirms the next part is ready.');
      if(manual.includes('inspect'))items.push('Agree where inspected, rejected and unreviewed parts will go.');
      if(manual.includes('changeover'))items.push('Document the setup references and the person who approves a changed variant.');
    }
    const manualLabel=manual.length?manual.map(value=>manualNames[value]).join('; '):'Not yet defined';
    const summary=[['Task',taskNames[task.value]],['Operating shifts',`${shifts.value} per day`],['Part variation',variationNames[variants.value]],['Retained operator steps',manualLabel]];
    const boundary='Demonstration only. This is preparation, not an engineering or safety assessment, quotation or approval to build. Nothing has been sent. Page state clears on refresh; a downloaded file remains on your device.';
    downloadText=['KESTREL CELLWORKS / FEASIBILITY PREPARATION',resultStatus,'',...summary.map(([label,value])=>`${label}: ${value}`),'','PREPARE',...items.map((item,index)=>`${index+1}. ${item}`),'','NEXT STEP',next,'',boundary,'Fictional company / concept website.'].join('\n');
    output.innerHTML=`<span class="kicker">Your next conversation</span><h2 id="result-title" tabindex="-1">Your feasibility preparation</h2><p class="status">${escape(resultStatus)}</p><dl>${summary.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h3>${outside?'Narrow the task':'Bring these materials'}</h3><ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul><h3>Next step</h3><p>${escape(next)}</p><div class="actions"><button class="button" type="button" data-download>Download checklist</button><button class="plain" type="button" data-edit>Edit choices</button></div><p class="boundary">${boundary}</p>`;
    output.hidden=false;
    output.querySelector('#result-title').focus({preventScroll:true});
    output.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    status.textContent=resultStatus;
  });
  output.addEventListener('click',event=>{
    if(event.target.closest('[data-edit]')){clearResult();task.focus();status.textContent='Edit your choices, then create an updated checklist.';}
    if(event.target.closest('[data-download]')&&downloadText){
      const url=URL.createObjectURL(new Blob([downloadText],{type:'text/plain;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download='kestrel-feasibility-checklist.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent='Checklist download requested. The file is saved locally by your browser; nothing was submitted.';
    }
  });
}
