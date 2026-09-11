import {sessions,fee,visitTypes,times,languages,arrivals,logistics} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');nav.classList.remove('open');menu.focus();}});
if(location.pathname.startsWith('/showcase/products/'))document.querySelector('[data-showcase]')?.setAttribute('href','/showcase/#work');

const form=document.querySelector('#prep-form');
if(form){
 const controls=document.querySelector('#planner-controls');
 const editor=document.querySelector('#planner-editor');const result=document.querySelector('#prep-result');const error=document.querySelector('#prep-error');
 const visit=form.elements.visit,time=form.elements.time,language=form.elements.language,arrival=form.elements.arrival;
 let summary=null;
 controls.disabled=false;
 const clear=()=>{form.reset();error.hidden=true;result.hidden=true;result.replaceChildren();editor.hidden=false;summary=null;};
 const checkedCount=()=>result.querySelectorAll('.prep-check input:checked').length;
 const updateCount=()=>{const count=checkedCount();result.querySelector('#ready-count').textContent=`${count} of ${summary.items.length} ready`;};
 const download=()=>{
  if(!summary)return;
  const s=sessions[summary.session];
  const checklist=[...result.querySelectorAll('.prep-check input')].map((input,i)=>`${input.checked?'[x]':'[ ]'} ${summary.items[i]}`).join('\n');
  const txt=`STRIDEWELL STUDIO / LOCAL VISIT PREPARATION\nFictional studio / non-clinical concept demonstration\n\nSTATUS: ${summary.gaps.length?'PRACTICAL QUESTIONS TO RESOLVE':'PREPARATION NOTE, NOT BOOKED'}\nVisit: ${visitTypes[summary.visit]}\nRequested session: ${s.name}\nPreferred time: ${times[summary.time]}\nConversation language: ${languages[summary.language]}\nArrival: ${arrivals[summary.arrival]}\nSpace questions: ${summary.logistics.length?summary.logistics.map(id=>logistics[id].label).join('; '):'None selected'}\n\n${summary.gaps.length?`GAPS\n${summary.gaps.join('\n')}\nNo appointment, fee or duration is confirmed.`:`REQUESTED FORMAT\n${s.duration} minutes / illustrative private fee ${fee(s.fee)}\n${s.agenda.map(a=>`${a.minutes} min - ${a.title}: ${a.text}`).join('\n')}\nIllustrative format details only; no appointment, invoice or payment.`}\n\nPREPARATION CHECKLIST / ${checkedCount()} OF ${summary.items.length} READY\n${checklist}\n\nSESSION BOUNDARY\n${s.limits}\n\nOPENING HOURS\nMonday-Thursday 08:30-18:00; Friday 08:30-16:00, Utrecht local time. No evenings or weekends. No live availability.\n\nGENERAL PREPARATION SOURCE\nhttps://www.guysandstthomas.nhs.uk/our-services/msk-physiotherapy/appointments\nFor comfortable clothing and bringing questions only.\n\nNo clinical assessment, diagnosis, treatment plan, exercise prescription, medical advice, credentials, recovery promise, health intake, email, invoice, insurer claim or booking. Nothing was sent. Selections and checklist state clear on refresh or departure; this downloaded file remains on your device.\n`;
  const url=URL.createObjectURL(new Blob([txt],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='stridewell-visit-preparation.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  result.querySelector('#download-status').textContent='Your current choices and checklist marks were saved to a local text file. No message was sent and no session is booked.';
 };
 document.querySelector('[data-clear]').addEventListener('click',()=>{clear();visit.focus();});
 form.addEventListener('change',()=>{error.hidden=true;});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const sessionId=form.elements.session.value;
  const required=[[visit,!!visitTypes[visit.value],'Choose whether this is your first studio visit.'],[form.querySelector('#session-first'),!!sessions[sessionId],'Choose a requested session format.'],[time,!!times[time.value],'Choose a time preference.'],[language,!!languages[language.value],'Choose a conversation language.'],[arrival,!!arrivals[arrival.value],'Choose an arrival plan.']];
  const invalid=required.find(([,valid])=>!valid);
  if(invalid){error.textContent=invalid[2];error.hidden=false;invalid[0].focus();return;}
  error.hidden=true;
  const s=sessions[sessionId];const selectedLogistics=[...form.querySelectorAll('input[name=logistics]:checked')].map(input=>input.value).filter(id=>logistics[id]);
  const gaps=[];const firstGap=visit.value==='first'&&sessionId!=='first';
  if(firstGap)gaps.push(`${s.name} follows an initial studio visit and an agreed plan. You selected a first visit, so discuss the First conversation step before requesting this follow-up. This is a format check, not a clinical recommendation.`);
  if(time.value==='outside')gaps.push('Evenings and weekends are outside the studio hours. Discuss a weekday daytime preference instead; no time is reserved by this note.');
  const arrivalNotes={walk:'If cycling, bring a way to secure your bicycle; check your arrival route before setting off.',transit:'Check your public transport route and return journey yourself; this website does not provide a real address or transit times.',dropoff:'Discuss an appropriate drop-off and pickup arrangement in advance; no on-site parking provision is offered.'};
  const items=['Set aside comfortable clothes for the visit.','Keep medical details and health documents off this website.'];
  items.push(firstGap?'Read the first-visit information and discuss the initial conversation before a follow-up.':s.prepare);
  items.push(`Confirm your preference to have the conversation in ${languages[language.value]}.`);
  items.push(arrivalNotes[arrival.value]);
  if(time.value==='outside')items.push('Discuss a weekday daytime option within the stated studio hours.');
  for(const id of selectedLogistics)items.push(logistics[id].text);
  summary={visit:visit.value,session:sessionId,time:time.value,language:language.value,arrival:arrival.value,logistics:selectedLogistics,gaps,items};
  result.innerHTML=`<div class="result-top"><p class="eyebrow">Stridewell Studio / Your local note</p><h2 id="result-title" tabindex="-1">${gaps.length?'A few things to discuss first.':'Your visit, a little more familiar.'}</h2><p>${gaps.length?'Your choices are kept below. The practical gaps need a conversation before any session can be agreed.':'A practical preparation list based on your choices. This is not a booking, assessment or clinical recommendation.'}</p></div><div class="result-body"><dl class="result-meta"><div><dt>Visit</dt><dd>${visitTypes[visit.value]}</dd></div><div><dt>Requested format</dt><dd>${s.name}</dd></div><div><dt>Time preference</dt><dd>${times[time.value]}</dd></div><div><dt>Language</dt><dd>${languages[language.value]}</dd></div><div><dt>Arrival</dt><dd>${arrivals[arrival.value]}</dd></div><div><dt>Space questions</dt><dd>${selectedLogistics.length?selectedLogistics.map(id=>logistics[id].label).join('; '):'None selected'}</dd></div></dl>${gaps.length?`<section class="gap-note"><h3>Practical gaps to resolve</h3><ul>${gaps.map(gap=>`<li>${gap}</li>`).join('')}</ul><p>No appointment, fee or duration is confirmed. The requested format remains a discussion point.</p>${firstGap?'<a class="text-link" href="first-appointment.html">Read about the first conversation ↗</a>':''}</section>`:`<section class="result-section" aria-label="Requested session format"><h3>${s.name}</h3><div class="session-meta"><div><strong id="result-duration">${s.duration} min</strong><span>Illustrative visit length</span></div><div><strong id="result-fee">${fee(s.fee)}</strong><span>Illustrative private fee</span></div></div><ol class="agenda">${s.agenda.map(a=>`<li><span class="minutes">${a.minutes} min</span><div><strong>${a.title}</strong><p>${a.text}</p></div></li>`).join('')}</ol></section>`}<section class="result-section"><div class="check-heading"><h3>Things to prepare or ask</h3><span id="ready-count" class="check-count" role="status">0 of ${items.length} ready</span></div><p class="small muted">Tick an item when you have prepared it. A tick marks your checklist only; it does not confirm a studio arrangement.</p><div class="prep-checks">${items.map((item,i)=>`<label class="prep-check" for="ready-${i}"><input id="ready-${i}" type="checkbox"><span>${item}</span></label>`).join('')}</div></section><div class="result-logistics"><p><strong>Keep the scope in mind.</strong> ${s.limits}</p><p><strong>Hours:</strong> Monday–Thursday 08:30–18:00; Friday 08:30–16:00, Utrecht local time. There is no live availability check.</p><p><strong>Page-only state:</strong> no health information, assessment, payment, insurance claim, email or booking. Refreshing or leaving clears this checklist. A downloaded file remains on your device.</p></div><div class="actions"><button class="button" type="button" data-download>Save preparation plan (TXT) ↓</button><button class="outline" type="button" data-edit>Edit my choices</button><button class="outline" type="button" data-result-clear>Clear and start again</button></div><p id="download-status" class="download-status" role="status"></p></div>`;
  for(const checkbox of result.querySelectorAll('.prep-check input'))checkbox.addEventListener('change',updateCount);
  result.querySelector('[data-download]').addEventListener('click',download);
  result.querySelector('[data-edit]').addEventListener('click',()=>{result.hidden=true;editor.hidden=false;visit.focus();});
  result.querySelector('[data-result-clear]').addEventListener('click',()=>{clear();visit.focus();});
  editor.hidden=true;result.hidden=false;result.querySelector('#result-title').focus();
 });
 const initialSession=new URLSearchParams(location.search).get('session');
 if(initialSession){if(sessions[initialSession])form.querySelector(`#session-${initialSession}`).checked=true;history.replaceState(null,'',location.pathname+location.hash);}
 window.addEventListener('pagehide',clear);window.addEventListener('pageshow',event=>{if(event.persisted)clear();});
}
