import {gear,money} from './catalog.js';
const form=document.querySelector('#kit-form');
if(form){
 const fields=Object.fromEntries(['outing','weather','load','pack','pack-qty','pad-qty'].map(id=>[id,document.getElementById(id)]));
 const result=document.querySelector('#kit-result'),error=document.querySelector('#kit-error');
 const outingLabels={short:'A short local loop',day:'A whole walking day',overnight:'An overnight trip'};
 const weatherLabels={dry:'Mostly dry',showers:'Passing showers',rain:'Prolonged rain'};
 let note='';
 const read=()=>({pack:gear.find(p=>p.id===fields.pack.value&&p.capacity),packQty:Number(fields['pack-qty'].value),padQty:Number(fields['pad-qty'].value),load:Number(fields.load.value),outing:fields.outing.value,weather:fields.weather.value});
 function guidance(s){const notes=[];
  if(!s.pack)notes.push('No walking bag selected. A pad-only list has no carrying capacity to compare.');
  else if(s.load>s.pack.capacity)notes.push(`Capacity gap: your ${s.load} L estimate exceeds one ${s.pack.name} by ${s.load-s.pack.capacity} L. ${s.pack.capacity===8&&s.load<=22?'Consider Ridge 22, then check your actual kit.':'This range may not cover your load.'}`);
  else notes.push(`${s.pack.name}: ${s.pack.capacity-s.load} L of nominal room beyond your ${s.load} L estimate. Shape, weight and personal fit still need checking.`);
  if(s.outing==='overnight')notes.push('Outside this range: Cairnfield is designed for short local outings and day walks, not overnight or extreme trips. This list is not a recommended overnight setup.');
  else if(s.outing==='day'&&s.pack?.capacity===8)notes.push('For a whole day, check that all layers, food and other essentials really fit the smaller sling. Choose more room if they do not.');
  if(s.weather==='showers')notes.push('Passing showers: neither bag has sealed seams or a waterproof rating. Protect weather-sensitive contents separately.');
  if(s.weather==='rain')notes.push('Prolonged rain: these bags are not waterproof. This is a material suitability gap; do not treat the kit as a complete wet-weather solution.');
  if(s.weather==='dry')notes.push('Mostly dry does not mean guaranteed dry. Check conditions and protect sensitive contents as needed.');
  return notes;
 }
 function valid(s){return (fields.pack.value==='none'||Boolean(s.pack))&&Number.isInteger(s.load)&&s.load>=1&&s.load<=30&&Number.isInteger(s.padQty)&&s.padQty>=0&&s.padQty<=4&&(!s.pack||(Number.isInteger(s.packQty)&&s.packQty>=1&&s.packQty<=4))&&Object.hasOwn(outingLabels,s.outing)&&Object.hasOwn(weatherLabels,s.weather);}
 function update(){const s=read();fields['pack-qty'].disabled=!s.pack;error.textContent='';const fill=document.querySelector('#volume-fill');fill.style.width=s.pack?Math.min(100,Math.max(0,s.load/s.pack.capacity*100))+'%':'0%';fill.classList.toggle('over',Boolean(s.pack&&s.load>s.pack.capacity));document.querySelector('#live-capacity').textContent=s.pack?`${s.load} L selected / ${s.pack.capacity} L in one ${s.pack.name}`:'No bag selected.';document.querySelector('#live-guidance').replaceChildren();if(valid(s))for(const text of guidance(s)){const p=document.createElement('p');p.textContent=text;if(/gap:|Outside this range:|Prolonged rain:/.test(text))p.className='gap';document.querySelector('#live-guidance').append(p);}}
 function clear(){form.reset();fields.pack.value='none';fields['pad-qty'].value='0';form.hidden=false;result.hidden=true;note='';update();fields.pack.focus();}
 const preset=new URLSearchParams(location.search).get('item');if(gear.some(p=>p.id===preset)){if(preset==='fold-sit-pad')fields['pad-qty'].value='1';else fields.pack.value=preset;}
 form.addEventListener('input',update);form.addEventListener('change',update);
 form.addEventListener('submit',event=>{event.preventDefault();const s=read();if(!valid(s)){error.textContent='Check the whole-number quantities and load range before reviewing.';return;}if(!s.pack&&!s.padQty){error.textContent='Choose a bag or at least one sit pad to make a kit note.';fields.pack.focus();return;}
  const lines=[];if(s.pack)lines.push({p:s.pack,qty:s.packQty});if(s.padQty)lines.push({p:gear[2],qty:s.padQty});const total=lines.reduce((n,l)=>n+l.p.price*l.qty,0),weight=lines.reduce((n,l)=>n+l.p.weight*l.qty,0),notes=guidance(s);
  document.querySelector('#result-lines').innerHTML=`<ul class="result-list">${lines.map(({p,qty})=>`<li><div><strong>${qty} × ${p.name}</strong><p>${p.colour} · ${p.weight} g each · ${money(p.price)} each</p></div><span>${money(p.price*qty)}</span></li>`).join('')}</ul><div class="result-total"><span>Illustrative total</span><span>${money(total)}</span></div><p>${weight} g empty equipment · no shipping or payment</p>`;
  const guidanceBox=document.querySelector('#result-guidance');guidanceBox.className='result-guidance';guidanceBox.innerHTML='<h3>Read before choosing.</h3>';for(const text of notes){const p=document.createElement('p');p.textContent=text;guidanceBox.append(p);}
  note=['CAIRNFIELD EQUIPMENT - LOCAL KIT NOTE','Fictional company / concept products. This is not an order.','',...lines.map(({p,qty})=>`${qty} x ${p.name} (${p.colour}) - ${money(p.price*qty)}; ${p.weight*qty} g`),'',`Illustrative total: ${money(total)}`,`Empty equipment weight: ${weight} g`,outingLabels[s.outing],weatherLabels[s.weather],`Estimated packed volume: ${s.load} L`,'',...notes,'','Current-page demonstration. No payment, live stock, delivery or message.'].join('\n');form.hidden=true;result.hidden=false;result.focus();
 });
 document.querySelector('#edit-kit').addEventListener('click',()=>{form.hidden=false;result.hidden=true;note='';fields.pack.focus();});
 document.querySelector('#clear-kit').addEventListener('click',clear);
 document.querySelector('#download-kit').addEventListener('click',()=>{if(!note)return;const url=URL.createObjectURL(new Blob([note],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='cairnfield-kit-note.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 update();
}
