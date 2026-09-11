document.documentElement.classList.add('js');
const menu=document.querySelector('[data-menu]'),navigation=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.dataset.open=String(open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');navigation.dataset.open='false';menu.focus();}});
if(!location.pathname.startsWith('/showcase/products/'))document.querySelector('[data-showcase]')?.setAttribute('href','/showcase/#work');

const form=document.querySelector('[data-trip]');
if(form){
 const journeys=JSON.parse(document.querySelector('#journey-data').textContent);
 const panel=document.querySelector('[data-planner-panel]');
 const output=document.querySelector('[data-output]');
 const fields=[...form.querySelectorAll('select')];
 const error=document.querySelector('[data-error]');
 let noteText='';
 const windowNotes={spring:'For a March–May trip, compare your proposed dates with the opening days of your selected visits and the actual transport services. The broad window does not confirm a timetable, weather or room availability.',summer:'For a June–August trip, establish exact dates, preferred room arrangements and which parts of each day you want left open before checking providers. No seasonal rate, weather or availability is assumed.',autumn:'For a September–November trip, decide your exact dates and any fixed commitments first, then check visits and transport around them. The window alone cannot establish opening days, fares or weather.',winter:'For a December–February trip, discuss the indoor alternatives you would enjoy and any holiday-period dates before checking providers. No seasonal opening, weather or service availability is promised.',unsure:'Choose a provisional month and identify any fixed commitments before requesting availability or comparing travel costs. This outline has no dated services, live prices or reservations.'};
 form.reset();
 const params=new URLSearchParams(location.search),preset=params.get('journey');
 if(journeys.some(r=>r.id===preset))form.elements.namedItem('journey').value=preset;
 if(params.has('journey'))history.replaceState(null,'',location.pathname);
 form.querySelector('[data-submit]').disabled=false;
 function element(tag,text,cls){const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;}
 function list(selector,items){document.querySelector(selector).replaceChildren(...items.map(t=>element('li',t)));}
 function reset(){form.reset();fields.forEach(f=>f.removeAttribute('aria-invalid'));error.hidden=true;panel.hidden=false;output.hidden=true;noteText='';document.querySelector('[data-download-status]').textContent='';fields[0].focus();}
 form.querySelector('[data-clear]').addEventListener('click',reset);
 document.querySelector('[data-reset]').addEventListener('click',reset);
 document.querySelector('[data-edit]').addEventListener('click',()=>{panel.hidden=false;output.hidden=true;fields[0].focus();});
 function buildDays(route,data){
  const nights=Number(data.nights),first=Math.floor(nights/2),moveDay=first+1;
  const items=[];
  const counters=[0,0];
  for(let day=1;day<=nights+1;day++){
   const baseIndex=day<moveDay?0:1,base=route.bases[baseIndex];
   let kind,title,copy;
   if(day===1){kind='arrival';title='Arrive in '+base;copy='Reach your selected stay and settle in. Keep the day clear of timed visits; an actual arrival service and access arrangements are still to be confirmed.';}
   else if(day===moveDay){kind='transfer';title=route.bases[0]+' to '+route.bases[1];copy=route.move+' Leave the rest of the day for settling into the second base.';}
   else if(day===nights+1){kind='departure';title='Continue from '+base;copy='Check your actual onward tickets, pickup and luggage arrangements. No timed connection or airport transfer is included in this outline.';}
   else{
    counters[baseIndex]++;
    const ordinal=counters[baseIndex];
    const open=day===nights||(data.pace==='slow'&&ordinal%2===0);
    if(open){kind='open';title='A day to keep open in '+base;copy='Return to a favourite place, rest near your stay or decide locally how much to do. No extra destination or booked activity is required.';}
    else{kind='focus';const activityIndex=data.pace==='slow'?Math.floor((ordinal-1)/2):(ordinal-1);const choices=route.activities[baseIndex][data.interest];const selected=choices[activityIndex%choices.length];title=selected[0];copy=selected[1];if(data.pace==='curious'&&data.party!=='family')copy+=' If it appeals, add one short nearby browse or cafe pause; keep it optional.';else copy+=' Keep the remainder of the day open.';}
    if(data.party==='family')copy+=' Family pause: allow an unhurried break back near the stay instead of a second outing.';
   }
   items.push({day,base,kind,title,copy});
  }
  return items;
 }
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const invalid=fields.filter(f=>!f.value||![...f.options].some(o=>o.value===f.value));
  fields.forEach(f=>f.setAttribute('aria-invalid',String(invalid.includes(f))));
  if(invalid.length){error.textContent='Choose an option for all six questions before building your outline.';error.hidden=false;invalid[0].focus();return;}
  error.hidden=true;
  const data=Object.fromEntries(fields.map(f=>[f.name,f.value]));
  const route=journeys.find(r=>r.id===data.journey);
  if(!route)return;
  const nights=Number(data.nights),first=Math.floor(nights/2),second=nights-first;
  const gaps=[];
  if(nights===3)gaps.push('Three nights are too short for this studio’s two-base sample rhythm. Allow at least five nights for this outline, or discuss a separate single-base visit. No day-by-day route is proposed for the current length.');
  if(data.party==='large')gaps.push('A party of seven or more is outside the private-group scope of these samples. Group rooms, movement and coordination need a different planning conversation. This outline does not imply capacity or availability.');
  const questions=[data.party==='family'?'Discuss the children’s age ranges, room arrangement and a suitable walking/rest rhythm in a future conversation; no personal details are collected here.':data.party==='group'?'Agree the preferred room split, a shared meeting point and which decisions need the whole group.':'Discuss whether a single shared room, walking rhythm and independent meal choices suit both travellers.'];
  questions.push(data.pace==='slow'?'Keep alternate focus days open, with no second planned outing. Agree which single visit matters most in each base.':'Choose the focus days you value and treat any second short browse as optional. The final full day stays open.');
  questions.push(data.interest==='food'?'Identify food preferences and the kinds of meals you enjoy before selecting any restaurants; no tasting or table is booked.':data.interest==='culture'?'Choose which collections or history themes matter, then verify admissions and opening days.':'Discuss comfortable distances, surfaces, slopes and indoor alternatives before choosing walks; this is not a navigation route.');
  questions.push('Keep accommodation, tickets, transfers, meals, admissions and any guiding separate from the studio planning fee.');
  const title=gaps.length?'Adjust the scope before the route.':`${route.name}, at your rhythm.`;
  const days=gaps.length?[]:buildDays(route,data);
  const focusCount=days.filter(d=>d.kind==='focus').length;
  const summary=gaps.length?'Your choices are saved in this page as a discussion note. The conditions below mean a suitable day-by-day itinerary is not proposed yet.':`${nights} nights across ${route.bases[0]} and ${route.bases[1]}, with one inter-base move and ${nights+1} calendar days. ${focusCount} suggested focus days; arrival, transfer, departure and the final full day remain free of fixed visits. This is a first planning outline, not an offer or booking.`;
  document.querySelector('#outline-title').textContent=title;
  document.querySelector('[data-summary]').textContent=summary;
  const contextLines=fields.map(f=>`${form.querySelector(`label[for="${f.id}"]`).textContent}: ${f.selectedOptions[0].textContent}`);
  document.querySelector('[data-context]').textContent=contextLines.join(' · ');
  document.querySelector('[data-gap]').hidden=!gaps.length;list('[data-gap-list]',gaps);
  const allocation=document.querySelector('[data-allocation]');allocation.hidden=!!gaps.length;
  allocation.replaceChildren(element('span',`${route.bases[0]} · ${first} nights`),element('span','', 'line'),element('span',`${route.bases[1]} · ${second} nights`));
  document.querySelector('[data-window-note]').textContent=windowNotes[data.window];
  list('[data-questions]',questions);
  const dayList=document.querySelector('[data-days]');dayList.hidden=!!gaps.length;
  dayList.replaceChildren(...days.map(d=>{const li=element('li','', 'day');li.dataset.kind=d.kind;li.dataset.base=d.base;li.dataset.day=String(d.day);const number=element('span',String(d.day).padStart(2,'0'),'day-number');number.setAttribute('aria-hidden','true');const copy=element('div');copy.append(element('span',`Day ${d.day} · ${d.base} · ${d.kind}`,'day-meta'),element('h3',d.title),element('p',d.copy));li.append(number,copy);return li;}));
  noteText=['WAYFARER LOOM','LOCAL TRIP PLANNING NOTE','',title,summary,'',...contextLines,'',...(gaps.length?['SCOPE TO RESOLVE',...gaps.map(g=>'- '+g)]:['BASE NIGHTS',`${route.bases[0]}: ${first} nights`,`${route.bases[1]}: ${second} nights`]),'','TRAVEL WINDOW',windowNotes[data.window],'','PLANNING QUESTIONS',...questions.map(q=>'- '+q),'',...(days.length?['DAY-BY-DAY OUTLINE',...days.flatMap(d=>[`Day ${d.day} | ${d.base} | ${d.kind}`,d.title,d.copy,''])]:[]),'Fictional studio / concept website. No enquiry, booking, ticket or payment was made. No quote, schedule, availability, visa advice or navigation route is supplied. Current page state is discarded on refresh or departure; this downloaded file stays on your device.'].join('\n');
  panel.hidden=true;output.hidden=false;document.querySelector('#outline-title').focus();
 });
 document.querySelector('[data-download]').addEventListener('click',()=>{if(!noteText)return;const url=URL.createObjectURL(new Blob([noteText],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='wayfarer-trip-note.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);document.querySelector('[data-download-status]').textContent='Trip note download prepared. No message or booking was sent.';});
 window.addEventListener('pageshow',event=>{if(event.persisted)reset();});
}
