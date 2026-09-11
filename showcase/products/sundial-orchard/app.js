import {flavours,casePrice} from './data.js';
function saveNote(text,name){if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function makeList(rows){const list=document.createElement('dl');for(const [key,value]of rows){const row=document.createElement('div');const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value;row.append(dt,dd);list.append(row);}return list;}
const mix=document.querySelector('#mix-form');
if(mix){
 const inputs=flavours.map(f=>document.querySelector('#count-'+f.id));const cases=document.querySelector('#case-count');const result=document.querySelector('#case-result');const status=document.querySelector('#mix-status');const tray=document.querySelector('#case-tray');let note='';
 const preset=new URLSearchParams(location.search).get('flavour');const initial=flavours.findIndex(f=>f.id===preset);if(initial>=0)inputs[initial].value='1';
 const read=()=>inputs.map(input=>input.value===''?NaN:Number(input.value));
 function update(){
  const counts=read();const valid=counts.every(n=>Number.isInteger(n)&&n>=0&&n<=6);const total=valid?counts.reduce((a,b)=>a+b,0):0;const quantity=Number(cases.value);
  result.hidden=true;note='';document.querySelector('#can-count').textContent=valid?String(total):'–';document.querySelector('#basket-cans').textContent=`Plan: ${quantity*6} cans in ${quantity} ${quantity===1?'case':'cases'}`;document.querySelector('#basket-price').textContent=`AUD ${casePrice*quantity}`;
  status.textContent=!valid?'Use whole numbers from 0 to 6 for each flavour.':total>6?`You have ${total} cans. Remove ${total-6} to make a six-can case.`:total===6?'Six cans, all yours. Your mix is ready to review.':`${6-total} ${6-total===1?'spot':'spots'} left. Choose your next flavour.`;
  document.querySelector('#review-case').disabled=!valid||total!==6||![1,2,3].includes(quantity);
  for(const button of mix.querySelectorAll('[data-adjust]')){const index=flavours.findIndex(f=>f.id===button.dataset.flavour);button.disabled=Number(button.dataset.adjust)>0?(!valid||total>=6):(!Number.isFinite(counts[index])||counts[index]<=0);}
  tray.replaceChildren();const chosen=[];if(valid)counts.forEach((count,i)=>{for(let n=0;n<count;n++)chosen.push(flavours[i]);});
  for(let i=0;i<6;i++){const slot=document.createElement('div');const flavour=chosen[i];slot.className='tray-slot'+(flavour?' filled '+flavour.colour:'');const title=document.createElement('span');title.textContent=flavour?flavour.name:String(i+1);const small=document.createElement('small');small.textContent=flavour?'250 ml':'Pick a flavour';slot.append(title,small);tray.append(slot);}
 }
 for(const button of mix.querySelectorAll('[data-adjust]'))button.addEventListener('click',()=>{const i=flavours.findIndex(f=>f.id===button.dataset.flavour);const value=Number(inputs[i].value)+Number(button.dataset.adjust);if(value>=0&&value<=6)inputs[i].value=String(value);update();});
 for(const input of [...inputs,cases]){input.addEventListener('input',update);input.addEventListener('change',update);}
 document.querySelector('#equal-mix').disabled=false;document.querySelector('#clear-mix').disabled=false;
 document.querySelector('#equal-mix').addEventListener('click',()=>{inputs.forEach(input=>input.value='2');update();});
 document.querySelector('#clear-mix').addEventListener('click',()=>{mix.reset();inputs.forEach(input=>input.value='0');const url=new URL(location.href);url.searchParams.delete('flavour');history.replaceState(null,'',url.pathname+url.search+url.hash);update();status.textContent='Your mix is cleared. Choose six cans to start again.';inputs[0].focus();});
 mix.addEventListener('submit',event=>{
  event.preventDefault();const counts=read();const quantity=Number(cases.value);if(!counts.every(n=>Number.isInteger(n)&&n>=0&&n<=6)||counts.reduce((a,b)=>a+b,0)!==6||![1,2,3].includes(quantity)){update();return;}
  const rows=[['Case quantity',`${quantity} identical ${quantity===1?'case':'cases'} · ${quantity*6} cans · 250 ml per can`]];
  flavours.forEach((f,i)=>{if(counts[i])rows.push([f.name,`${counts[i]} per case × ${quantity} ${quantity===1?'case':'cases'} = ${counts[i]*quantity} cans · ${f.sku}`]);});
  rows.push(['Illustrative subtotal',`AUD ${casePrice*quantity} (${quantity} × AUD ${casePrice}). Tax and delivery are not calculated or charged.`]);
  const list=makeList(rows);const ingredient=document.createElement('div');ingredient.className='note-ingredients';const title=document.createElement('h3');title.textContent='In your chosen flavours';ingredient.append(title);
  flavours.forEach((f,i)=>{if(counts[i]){const p=document.createElement('p');p.textContent=`${f.name}: ${f.ingredients}`;ingredient.append(p);}});
  document.querySelector('#case-note').replaceChildren(list,ingredient);
  note=['SUNDIAL ORCHARD · FICTIONAL COMPANY','SIX-CAN CASE NOTE',...rows.map(([key,value])=>`${key}: ${value}`),'ILLUSTRATIVE INGREDIENTS',...flavours.filter((_,i)=>counts[i]>0).map(f=>`${f.name}: ${f.ingredients}`),'Recipes are illustrative, not tested labels or dietary assurances.','This is a case note, not an order confirmation. No payment, delivery or email.','Choices clear on reload. Downloaded notes stay on your device.'].join('\n\n');
  result.hidden=false;document.querySelector('#case-result-title').focus();
 });
 document.querySelector('#download-case').addEventListener('click',()=>saveNote(note,'sundial-orchard-case-note.txt'));
 document.querySelector('#edit-case').addEventListener('click',()=>{result.hidden=true;note='';inputs[0].focus();});
 update();
}
const wholesale=document.querySelector('#wholesale-form');
if(wholesale){
 const business=document.querySelector('#business-type');const region=document.querySelector('#region');const trial=document.querySelector('#trial-size');const lead=document.querySelector('#lead-flavour');const result=document.querySelector('#wholesale-result');let note='';
 document.querySelector('#prepare-wholesale').disabled=false;document.querySelector('#clear-wholesale').disabled=false;
 const invalidate=()=>{result.hidden=true;note='';};wholesale.addEventListener('input',invalidate);wholesale.addEventListener('change',invalidate);
 wholesale.addEventListener('submit',event=>{
  event.preventDefault();const flavour=flavours.find(f=>f.id===lead.value);if(!wholesale.checkValidity()||!flavour)return;
  const exceptional=business.value==='online'||region.value==='outside';
  const title=exceptional?'Start with a channel check.':'A first taste for your counter.';
  const next=region.value==='outside'?'The initial concept serves Australia. Confirm export eligibility, labelling and distribution before considering samples.':business.value==='online'?'The initial concept focuses on physical grocers, cafés and restaurants. Discuss online channel eligibility and fulfilment requirements first.':`Discuss a small physical retail trial in ${region.selectedOptions[0].textContent}. Availability, freight and terms still need confirmation.`;
  const trialAdvice={small:'Start by comparing one or two single-flavour cartons after tasting. Confirm minimum order rules before assuming a small order is available.',medium:'Discuss a three-to-five-carton opening mix and how much fridge or shelf space it would use. Confirm carton dimensions and delivery terms.',large:'Plan a staged trial before a larger opening order. Discuss replenishment, storage, rotation and delivery capacity; no stock is reserved.'}[trial.value];
  const businessAdvice={grocer:'Check shelf placement, a readable shelf ticket, barcode requirements and a verified retail label.',cafe:'Discuss chilled counter space, single-can service and the drinks already on your menu.',restaurant:'Consider the three flavours alongside lunch or dinner dishes, then confirm service and storage needs.',online:'Confirm whether this channel is supported, together with case packaging, dispatch and customer-service responsibilities.'}[business.value];
  const rows=[['Business',business.selectedOptions[0].textContent],['Region',region.selectedOptions[0].textContent],['Trial interest',trial.selectedOptions[0].textContent+' · 24 cans per single-flavour carton'],['Lead flavour',`${flavour.name}: ${flavour.short} This is the discussion focus; the proposed sample remains two of each flavour.`],['Proposed sample','2 Blood Orange + 2 Pear & Ginger + 2 Lemon Myrtle. Six 250 ml cans in total. Not dispatched.'],['Start here',next],['For your business',businessAdvice],['Quantity discussion',trialAdvice],['Before any supply','Confirm tested labels, actual ingredients, shelf life, storage conditions, trade prices, minimums, delivery and payment terms.']];
  document.querySelector('#wholesale-title').textContent=title;document.querySelector('#wholesale-note').replaceChildren(makeList(rows));
  note=['SUNDIAL ORCHARD · FICTIONAL COMPANY','SAMPLE CONVERSATION BRIEF',title,...rows.map(([key,value])=>`${key}: ${value}`),'No sample is dispatched. No price, approval, booking, payment or email.','Example contact trade@sundialorchard.example is not a monitored inbox.','Answers clear on reload. This downloaded brief stays on your device.'].join('\n\n');result.hidden=false;document.querySelector('#wholesale-title').focus();
 });
 document.querySelector('#download-wholesale').addEventListener('click',()=>saveNote(note,'sundial-orchard-sample-brief.txt'));
 document.querySelector('#edit-wholesale').addEventListener('click',()=>{invalidate();business.focus();});
 document.querySelector('#clear-wholesale').addEventListener('click',()=>{wholesale.reset();invalidate();business.focus();});
}
