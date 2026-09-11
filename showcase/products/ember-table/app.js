import {dateInPortland,addDays,dateValid,exampleSittings} from './data.js';
const form=document.querySelector('#table-form');
if(form){
 const date=document.querySelector('#date');const service=document.querySelector('#service');const party=document.querySelector('#party');const noteForm=document.querySelector('#note-form');const menu=document.querySelector('#menu-interest');const pairing=document.querySelector('#pairing');const pairingLabel=document.querySelector('#pairing-label');const result=document.querySelector('#table-result');const status=document.querySelector('#sitting-status');const times=document.querySelector('#sittings');
 let snapshot=null;let note='';
 function refreshRange(){date.min=dateInPortland();date.max=addDays(date.min,27);}
 refreshRange();
 const setPreset=new URLSearchParams(location.search).get('menu')==='set';menu.value=setPreset?'set':'plates';pairingLabel.hidden=menu.value!=='set';
 document.querySelector('#check-times').disabled=false;document.querySelector('#clear-choices').disabled=false;
 function invalidate(){result.hidden=true;note='';}
 function invalidateSittings(){invalidate();snapshot=null;noteForm.hidden=true;times.replaceChildren();status.textContent='Choices changed. Check example sittings again.';}
 for(const input of [date,service,party]){input.addEventListener('input',invalidateSittings);input.addEventListener('change',invalidateSittings);}
 menu.addEventListener('change',()=>{pairingLabel.hidden=menu.value!=='set';if(menu.value!=='set')pairing.checked=false;invalidate();});pairing.addEventListener('change',invalidate);
 form.addEventListener('submit',event=>{
  event.preventDefault();refreshRange();invalidate();noteForm.hidden=true;snapshot=null;times.replaceChildren();
  if(!dateValid(date.value,date.min,date.max)){status.textContent='Choose a valid date within the next 28 days in Portland.';date.focus();return;}
  const count=Number(party.value);if(!Number.isInteger(count)||count<1||count>10){status.textContent='Choose between 1 and 10 guests.';return;}
  const availability=exampleSittings(date.value,service.value,count);status.textContent=availability.message;
  if(!availability.slots.length)return;
  snapshot={date:date.value,service:service.value,party:count,slots:availability.slots};
  for(const time of availability.slots){const label=document.createElement('label');const radio=document.createElement('input');radio.type='radio';radio.name='sitting';radio.value=time;radio.required=true;radio.addEventListener('change',invalidate);label.append(radio,document.createTextNode(time));times.append(label);}
  noteForm.hidden=false;
 });
 noteForm.addEventListener('submit',event=>{
  event.preventDefault();refreshRange();
  const selected=times.querySelector('input:checked');
  if(!snapshot||!selected||!snapshot.slots.includes(selected.value)||!dateValid(snapshot.date,date.min,date.max)||!exampleSittings(snapshot.date,snapshot.service,snapshot.party).slots.includes(selected.value)){invalidateSittings();status.textContent='Check example sittings again before preparing a note.';return;}
  const formatted=new Intl.DateTimeFormat('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(snapshot.date+'T12:00:00Z'));
  const [h,m]=selected.value.split(':').map(Number);const end=new Date(Date.UTC(2000,0,1,h,m+90)).toISOString().slice(11,16);
  const set=menu.value==='set';
  const rows=[['Date',formatted],['Service',snapshot.service==='lunch'?'Sunday lunch':'Dinner'],['Sitting',`${selected.value}–${end} · Portland local time · 90 minutes`],['Party',`${snapshot.party} ${snapshot.party===1?'guest':'guests'}`],['Menu interest',set?'Vegetarian set: ember carrots, mushroom & barley bowl, poached pear. One of each per guest.':'Choose individual plates from the six-dish menu. No meal price estimated.']];
  if(set){rows.push(['Food subtotal',`$${42*snapshot.party} USD ($42 × ${snapshot.party} guests)`]);rows.push(['Pairing',pairing.checked?`$${15*snapshot.party} USD ($15 × ${snapshot.party} guests). Small serves of apple & rosemary spritz, lemon verbena iced tea and tart cherry soda.`:'No pairing selected.']);rows.push(['Illustrative subtotal',`$${(42+(pairing.checked?15:0))*snapshot.party} USD. Tax and gratuity are not calculated or collected.`]);}
  const list=document.createElement('dl');for(const [label,value]of rows){const row=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const description=document.createElement('dd');description.textContent=value;row.append(term,description);list.append(row);}
  document.querySelector('#note-content').replaceChildren(list);
  note=['EMBER TABLE · FICTIONAL RESTAURANT','TABLE-REQUEST NOTE',...rows.map(([key,value])=>`${key}: ${value}`),'No reservation has been made. No real availability, table hold, email or payment.','Example recipes are not allergy or cross-contact guarantees.','Current-page choices clear on reload. This downloaded note stays on your device.'].join('\n\n');
  result.hidden=false;document.querySelector('#result-title').focus();
 });
 document.querySelector('#download-note').addEventListener('click',()=>{if(!note)return;const url=URL.createObjectURL(new Blob([note],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='ember-table-request-note.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 document.querySelector('#edit-note').addEventListener('click',()=>{invalidate();date.focus();});
 document.querySelector('#clear-choices').addEventListener('click',()=>{form.reset();noteForm.reset();menu.value='plates';pairing.checked=false;pairingLabel.hidden=true;invalidateSittings();status.textContent='Choices cleared. No reservation was made.';const url=new URL(location.href);url.searchParams.delete('menu');history.replaceState(null,'',url.pathname+url.search+url.hash);date.focus();});
}
