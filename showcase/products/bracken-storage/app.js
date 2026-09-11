document.documentElement.classList.add('js');
const menu=document.querySelector('.menu');
const navigation=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.dataset.open=String(open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');navigation.dataset.open='false';menu.focus();}});
if(!location.pathname.startsWith('/showcase/products/'))document.querySelector('.showcase-return').href='/showcase/#work';

const form=document.querySelector('#review-form');
if(form){
  const result=document.querySelector('#review-result');
  const error=document.querySelector('#form-error');
  const live=document.querySelector('#status-message');
  const ids=['goal','region','site','solar','permission','data'];
  const fields=Object.fromEntries(ids.map(id=>[id,document.querySelector(`#${id}`)]));
  const labels={goal:'Primary objective',region:'Site region',site:'Site type',solar:'On-site solar',permission:'Decision-making',data:'Usage information'};
  const params=new URLSearchParams(location.search);
  for(const id of ['goal','site']){const value=params.get(id);if([...fields[id].options].some(option=>option.value===value))fields[id].value=value;}
  let checklist='';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const invalidate=()=>{result.hidden=true;result.replaceChildren();checklist='';};
  form.querySelector('[data-create]').disabled=false;
  form.addEventListener('change',event=>{event.target.removeAttribute('aria-invalid');error.hidden=true;if(!result.hidden){invalidate();live.textContent='Answers changed. Create the plan again to update the checklist.';}});
  form.addEventListener('reset',()=>{invalidate();error.hidden=true;form.querySelectorAll('[aria-invalid]').forEach(field=>field.removeAttribute('aria-invalid'));live.textContent='All answers and the preparation plan have been cleared.';});
  form.addEventListener('submit',event=>{
    event.preventDefault();invalidate();
    const missing=ids.filter(id=>!fields[id].value);
    if(missing.length){error.textContent='Complete all six selections before creating the plan. Choose an unsure option where information is not yet available.';error.hidden=false;missing.forEach(id=>fields[id].setAttribute('aria-invalid','true'));fields[missing[0]].focus();return;}
    error.hidden=true;
    const answer=Object.fromEntries(ids.map(id=>[id,fields[id].value]));
    const summary=ids.map(id=>[labels[id],fields[id].selectedOptions[0].textContent]);
    const outside=answer.region==='elsewhere';
    const gaps=[];
    if(answer.goal==='solar'&&answer.solar==='none')gaps.push('No solar is installed or planned. Define a generation proposal before assessing solar self-use, or choose a different primary objective.');
    if(answer.permission==='unresolved')gaps.push('Identify the site owner or authorised decision-maker before arranging a site assessment.');
    if(answer.permission==='tenant')gaps.push('Involve the owner to agree access, the proposed scope and who can approve site changes.');
    if(answer.data!=='available')gaps.push(answer.data==='request'?'Request the available interval usage records from the site’s supply contact.':'Ask the site’s supply contact what interval usage information exists and how the authorised team can obtain it.');
    const objective={
      load:['Gather the working-hours pattern and the machines or activities behind demand changes.','Bring current supply information and interval usage records to the scoped assessment.'],
      solar:['Compare generation and demand records over the same periods.','Include both busy and quieter periods before discussing a storage configuration.'],
      resilience:['Agree a named list of essential loads and the activities they support.','Bring existing continuity arrangements and identify who owns the specialist electrical review.','Treat any backup function as a separate engineering question. No backup duration or uninterrupted operation is established by this plan.']
    };
    const siteItem={workshop:'For the workshop, record job patterns, late finishing and planned changes to machinery.',packhouse:'For the packhouse, include the seasonal packing calendar and refrigeration demand.',workspace:'For the workspace, distinguish tenant demand, shared building services and communications priorities.'};
    const solarItem={existing:'Gather the existing solar system information and available generation records.',planned:'Bring the proposed solar design and its assumptions; keep forecasts separate from measured records.',none:'Record that there is no current solar installation or plan; do not assume generation is available.'};
    const ownership=answer.permission==='owner'?'Nominate the authorised site decision-maker and the people responsible for existing equipment.':answer.permission==='tenant'?'Keep the tenant and owner responsibilities together in the assessment brief.':'Record decision-making as unresolved until the responsible person is identified.';
    const items=outside?['Bracken’s published working region is England and Wales. This plan does not arrange a review for this location.','Retain a summary of the objective and site information for a locally appropriate provider.']:[...gaps,...objective[answer.goal],siteItem[answer.site],solarItem[answer.solar],ownership,'Identify a candidate equipment area and access constraints for a specialist site review. This is not a siting approval.'];
    const status=outside?'Outside our working region':gaps.length?'Preparation gaps to resolve':'Ready to prepare a site review';
    const next=outside?'No site review has been requested. You can edit the region or download this record of your choices.':gaps.length?'Resolve the listed information and responsibility gaps first. Then agree a bounded assessment with the relevant site and specialist teams.':'Use this plan to prepare a scoped assessment. Equipment capacity, siting, responsibilities and commercial assumptions still need to be examined and agreed.';
    const boundary='Demonstration only. No suitability approval, equipment design, quotation, financial forecast, booking or order. Nothing is sent. Answers clear on refresh; a downloaded file remains on your device.';
    checklist=['BRACKEN STORAGE / SITE REVIEW PREPARATION',status,'',...summary.map(([label,value])=>`${label}: ${value}`),'','PREPARATION STEPS',...items.map((item,index)=>`${index+1}. ${item}`),'','NEXT STEP',next,'',boundary,'Fictional company / concept website.'].join('\n');
    result.innerHTML=`<span class="eyebrow">Your preparation plan</span><h2 id="result-title" tabindex="-1">The next steps for this site.</h2><span class="result-status">${escape(status)}</span><dl>${summary.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h3>${outside?'Working-region boundary':'Prepare for the conversation'}</h3><ol>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ol><h3>What happens next</h3><p>${escape(next)}</p><div class="actions"><button class="button" type="button" data-download>Download preparation plan</button><button class="plain" type="button" data-edit>Edit answers</button></div><p class="boundary">${boundary}</p>`;
    result.hidden=false;result.querySelector('#result-title').focus({preventScroll:true});result.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});live.textContent=status;
  });
  result.addEventListener('click',event=>{
    if(event.target.closest('[data-edit]')){invalidate();fields.goal.focus();live.textContent='Edit your answers, then create a new preparation plan.';}
    if(event.target.closest('[data-download]')&&checklist){const url=URL.createObjectURL(new Blob([checklist],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='bracken-site-review-plan.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);live.textContent='Local download requested. The plan was not submitted to Bracken.';}
  });
}
