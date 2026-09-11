import {products,presets,money} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');
const navigation=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.setAttribute('aria-expanded','false');navigation.classList.remove('open');menu.focus();}});
if(location.pathname.startsWith('/showcase/products/'))document.querySelector('[data-showcase]')?.setAttribute('href','/showcase/#work');
const form=document.querySelector('#kit-form');
if(form){
 const $=id=>document.getElementById(id);
 let reviewed=null;
 const keys=Object.keys(products);
 const selected=()=>keys.filter(id=>$('include-'+id).checked).map(id=>({id,product:products[id],option:products[id].options.find(o=>o.id===(id==='trail'?'one':$('size-'+id).value))}));
 const quantity=()=>Number($('kit-quantity').value);
 const validQuantity=()=>Number.isInteger(quantity())&&quantity()>=1&&quantity()<=3;
 const clearError=()=>{$('kit-error').hidden=true;$('kit-error').textContent='';};
 const draft=()=>{
  const entries=selected();const q=quantity();const allSized=entries.every(e=>e.option);$('draft-empty').hidden=entries.length>0;
  $('draft-items').innerHTML=entries.map(({product:p,option:o})=>`<li><div><strong>${p.name}</strong><small>${o?o.dimension:'Choose a size to include this item'} · ${p.colour}</small></div><b>${o&&validQuantity()?money(o.price*q):'—'}</b></li>`).join('');
  $('draft-total').textContent=!validQuantity()?'Enter quantity':!allSized?'Choose sizes':money(entries.reduce((sum,e)=>sum+(e.option?.price||0)*q,0));
  $('draft-count').textContent=validQuantity()?`${q} ${q===1?'kit':'kits'} · ${entries.length} ${entries.length===1?'piece':'pieces'} per kit.`:'Enter a whole number from 1 to 3.';
 };
 const setInclude=id=>{const size=$('size-'+id);if(size){size.disabled=!$('include-'+id).checked;if(size.disabled)size.value='';}};
 const reset=(focus=false)=>{form.reset();keys.forEach(id=>{$('include-'+id).checked=false;setInclude(id);});$('kit-region').value='';$('kit-quantity').value='1';$('kit-editor').hidden=false;$('kit-review').hidden=true;$('kit-status').textContent='';$('download-status').textContent='';reviewed=null;clearError();draft();if(focus){$('kit-status').textContent='All choices cleared. Start with any piece.';$('include-tide').focus();}};
 $('kit-controls').disabled=false;reset();
 document.querySelectorAll('[data-preset]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>{const preset=presets[button.dataset.preset];keys.forEach(id=>{$('include-'+id).checked=id in preset.items;setInclude(id);if($('size-'+id)&&id in preset.items)$('size-'+id).value=preset.items[id];});clearError();draft();$('kit-status').textContent=`${preset.name} loaded. Previous product choices replaced; you can change any item below.`;});});
 keys.forEach(id=>$('include-'+id).addEventListener('change',()=>{setInclude(id);clearError();draft();}));
 form.addEventListener('input',()=>{clearError();draft();});form.addEventListener('change',()=>{clearError();draft();});
 const fail=(message,id)=>{$('kit-error').textContent=message;$('kit-error').hidden=false;$(id).focus();};
 form.addEventListener('submit',event=>{
  event.preventDefault();clearError();const entries=selected();
  if(!entries.length){fail('Choose at least one product for your kit.','include-tide');return;}
  const incomplete=entries.find(e=>!e.option);if(incomplete){fail(`Choose a ${incomplete.id==='tide'?'leash length':'towel size'} for the included ${incomplete.product.name}.`,'size-'+incomplete.id);return;}
  if(!validQuantity()){fail('Enter a whole number of kits from 1 to 3.','kit-quantity');return;}
  if(!['canada','elsewhere'].includes($('kit-region').value)){fail('Choose a destination region to see the service boundary.','kit-region');return;}
  reviewed={entries,q:quantity(),region:$('kit-region').value,total:entries.reduce((sum,e)=>sum+e.option.price*quantity(),0)};
  const {q,total,region}=reviewed;$('review-summary').textContent=`${q} ${q===1?'kit':'kits'}, with ${entries.length} ${entries.length===1?'piece':'pieces'} in each. Each line below includes ${q} ${q===1?'item':'items'}.`;
  $('review-lines').innerHTML=entries.map(({id,product:p,option:o})=>`<article class="review-line"><img src="assets/${id}-768.webp" alt="${p.name} in ${p.colour}" width="768" height="576"><div><h3>${p.name}</h3><p>${p.colour} · ${o.dimension}</p><p>${q} × ${money(o.price)} each</p></div><strong class="line-price">${money(o.price*q)}</strong></article>`).join('');
  $('review-total').textContent=money(total);$('review-region').classList.toggle('region-gap',region==='elsewhere');$('review-region').innerHTML=region==='canada'?'<strong>Canada / within our stated retail focus.</strong><p>This is a local item note, not a delivery check. No address, stock, tax, shipping date, payment or order is confirmed.</p>':'<strong>Outside Canada / supply route not available in this concept.</strong><p>Our current retail scope is Canada. You can keep this item note, but this selection does not create a shipping offer or a retailer relationship.</p>';
  $('review-care').innerHTML=entries.map(({product:p})=>`<li><strong>${p.name}</strong>${p.care} ${p.boundary}</li>`).join('');
  $('kit-editor').hidden=true;$('kit-review').hidden=false;$('download-status').textContent='';$('review-title').focus();$('kit-review').scrollIntoView({block:'start'});
 });
 $('edit-kit').addEventListener('click',()=>{$('kit-editor').hidden=false;$('kit-review').hidden=true;reviewed=null;$('kit-status').textContent='Your choices are ready to edit. Review again after making changes.';$('include-tide').focus();});
 $('clear-kit').addEventListener('click',()=>reset(true));$('reset-kit').addEventListener('click',()=>reset(true));
 $('download-kit').addEventListener('click',()=>{if(!reviewed)return;const {entries,q,region,total}=reviewed;const text=`PAWSHORE SUPPLY / YOUR WALKING KIT\nFictional company / concept website\nNo order placed\n\nNumber of kits: ${q}\nOne of each included product in every kit.\nDestination region: ${region==='canada'?'Canada':'Outside Canada'}\n${region==='elsewhere'?'SERVICE GAP: Supply outside Canada is not available in this concept. No shipping offer.':'Canada is within the stated retail focus; delivery and stock are not checked.'}\n\nITEMS\n${entries.map(({product:p,option:o})=>`${p.name} / ${p.colour} / ${o.dimension}\n${q} x ${money(o.price)} each = ${money(q*o.price)}\nMaterials: ${p.material}\nCare: ${p.care}\nUse boundary: ${p.boundary}`).join('\n\n')}\n\nItem total: ${money(total)} CAD\nNo discount, tax or delivery is calculated.\n\nDEMO BOUNDARY\nNo order, payment, stock, shipping or messages are connected. No personal or pet-health information is collected. Choices stay only on the current page and are discarded on refresh or departure. This downloaded file remains on your device. The selection does not establish suitability, dog fit, strength or safety certification. Physical care instructions take precedence.\n`;
  const objectURL=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=objectURL;anchor.download='pawshore-walking-kit.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);$('download-status').textContent='Your local kit note was prepared for download. No order or message was sent.';
 });
 const initialItem=new URLSearchParams(location.search).get('item');if(keys.includes(initialItem)){$('include-'+initialItem).checked=true;setInclude(initialItem);draft();$('kit-status').textContent=`${products[initialItem].name} included. Choose any required size and destination region.`;}
 if(location.search)history.replaceState(null,'',location.pathname+location.hash);
 window.addEventListener('pageshow',event=>{if(event.persisted)reset();});
}
