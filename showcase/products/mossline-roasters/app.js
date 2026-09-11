document.documentElement.classList.add('js-ready');
const menu=document.querySelector('.menu');
const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav?.classList.contains('open')){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.focus();}});
if(!location.pathname.includes('/showcase/products/'))document.querySelectorAll('[data-showcase]').forEach(link=>{link.href='/showcase/#work';});
const form=document.querySelector('#bag-form');
if(form){
 const {coffees,grinds}=JSON.parse(document.querySelector('#coffee-data').textContent);
 const fields=Object.fromEntries(['coffee','size','quantity','grind'].map(id=>[id,document.getElementById(id)]));
 const get=id=>document.getElementById(id);
 const money=n=>'NZ$'+n.toFixed(2);
 const sizeName=n=>Number(n)===1000?'1kg':'250g';
 const find=id=>coffees.find(c=>c.id===id);
 let bag=[];let editing=-1;
 const key=line=>[line.coffee,line.size,line.grind].join('|');
 const total=()=>bag.reduce((sum,line)=>sum+find(line.coffee).prices[line.size]*line.quantity,0);
 const weight=()=>bag.reduce((sum,line)=>sum+Number(line.size)*line.quantity,0);
 const describe=line=>`${find(line.coffee).name} · ${sizeName(line.size)} · ${grinds[line.grind]} · ${line.quantity} pack${line.quantity===1?'':'s'}`;
 function invalidateReview(){get('review').hidden=true;}
 function resetError(){get('form-error').hidden=true;Object.values(fields).forEach(field=>field.removeAttribute('aria-invalid'));}
 function error(message,field){get('form-error').textContent=message;get('form-error').hidden=false;if(field){field.setAttribute('aria-invalid','true');field.focus();}}
 function showChoice(){
  const c=find(fields.coffee.value);const size=fields.size.value;
  get('selected-photo').hidden=!c;
  if(c)get('selected-photo').innerHTML=`<img src="assets/images/${c.image}-768.webp" width="768" height="512" alt="${c.name} 250g concept pack"><p>${c.notes} · ${c.method}<br>250g pack shown; your selected size is listed below.</p>`;
  get('unit-price').textContent=c&&size?money(c.prices[size])+' per '+sizeName(size)+' pack':'Choose a coffee and pack size.';
 }
 function render(message=''){
  invalidateReview();get('empty-bag').hidden=bag.length>0;get('totals').hidden=bag.length===0;get('clear-bag').disabled=bag.length===0;
  get('cart-list').innerHTML=bag.map((line,index)=>{const c=find(line.coffee);return `<li class="cart-line" data-index="${index}"><img src="assets/images/${c.image}-768.webp" width="80" height="80" alt=""><div><h3>${c.name}</h3><p>${sizeName(line.size)} · ${grinds[line.grind]}<br>${money(c.prices[line.size])} per pack</p><label class="line-qty" for="line-qty-${index}">Quantity<select id="line-qty-${index}" data-quantity="${index}" aria-label="Quantity for ${c.name}, ${sizeName(line.size)}, ${grinds[line.grind]}">${Array.from({length:9},(_,i)=>`<option value="${i+1}" ${line.quantity===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><div class="line-actions"><button class="plain" type="button" data-edit="${index}" aria-label="Edit ${c.name}, ${sizeName(line.size)}, ${grinds[line.grind]}">Change options</button><button class="plain" type="button" data-remove="${index}" aria-label="Remove ${c.name}, ${sizeName(line.size)}, ${grinds[line.grind]}">Remove</button></div></div><span class="line-total">${money(c.prices[line.size]*line.quantity)}</span></li>`;}).join('');
  const count=bag.reduce((sum,line)=>sum+line.quantity,0);get('bag-total').textContent=money(total());get('bag-weight').textContent=`${count} pack${count===1?'':'s'} · ${(weight()/1000).toFixed(2)}kg coffee. Pack prices only; no checkout, tax calculation or delivery.`;get('bag-status').textContent=message;
 }
 function exitEdit(){editing=-1;get('selector-title').textContent='Choose your coffee.';get('add-coffee').textContent='Add to demo bag ↗';get('cancel-edit').hidden=true;get('review-bag').disabled=false;}
 form.addEventListener('submit',event=>{
  event.preventDefault();resetError();
  if(!find(fields.coffee.value))return error('Choose one of the three coffees.',fields.coffee);
  if(!['250','1000'].includes(fields.size.value))return error('Choose a 250g or 1kg pack.',fields.size);
  const quantity=Number(fields.quantity.value);if(!Number.isInteger(quantity)||quantity<1||quantity>9)return error('Use a whole-number quantity from 1 to 9.',fields.quantity);
  if(!Object.hasOwn(grinds,fields.grind.value))return error('Choose whole bean or a brewing grind.',fields.grind);
  const line={coffee:fields.coffee.value,size:fields.size.value,grind:fields.grind.value,quantity};
  const matching=bag.findIndex((item,index)=>index!==editing&&key(item)===key(line));
  if(matching>=0&&bag[matching].quantity+quantity>9)return error('This matching coffee, size and grind would exceed 9 packs. Change its existing quantity or reduce this addition.',fields.quantity);
  const wasEditing=editing>=0;
  if(matching>=0){bag[matching].quantity+=quantity;if(wasEditing)bag.splice(editing,1);}else if(wasEditing){bag[editing]=line;}else{bag.push(line);}
  exitEdit();render((wasEditing?'Updated: ':'Added: ')+describe(line)+'.');fields.quantity.value='1';
 });
 for(const field of Object.values(fields))field.addEventListener('input',()=>{resetError();showChoice();});
 get('cart-list').addEventListener('change',event=>{const index=event.target.dataset.quantity;if(index===undefined)return;bag[Number(index)].quantity=Number(event.target.value);exitEdit();render('Quantity updated. Review again to download the new total.');get('line-qty-'+index)?.focus();});
 get('cart-list').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.remove!==undefined){const index=Number(button.dataset.remove);const removed=bag[index];bag.splice(index,1);exitEdit();render(find(removed.coffee).name+' removed.');get('clear-bag').disabled?fields.coffee.focus():get('clear-bag').focus();}
  if(button.dataset.edit!==undefined){editing=Number(button.dataset.edit);const line=bag[editing];for(const [id,field] of Object.entries(fields))field.value=String(line[id]);resetError();showChoice();get('selector-title').textContent='Change this selection.';get('add-coffee').textContent='Save these changes ↗';get('cancel-edit').hidden=false;get('review-bag').disabled=true;invalidateReview();fields.coffee.focus();}
 });
 form.addEventListener('reset',()=>{queueMicrotask(()=>{exitEdit();resetError();showChoice();});});
 get('cancel-edit').addEventListener('click',()=>{form.reset();get('bag-status').textContent='Changes cancelled. The existing bag is unchanged.';fields.coffee.focus();});
 get('clear-bag').addEventListener('click',()=>{bag=[];form.reset();render('Demo bag cleared. No selections are stored.');fields.coffee.focus();});
 get('review-bag').addEventListener('click',()=>{
  if(!bag.length||editing>=0)return;
  get('review-lines').innerHTML=bag.map(line=>`<li>${describe(line)}<br>${money(find(line.coffee).prices[line.size])} per pack · ${money(find(line.coffee).prices[line.size]*line.quantity)} line total</li>`).join('');
  get('review-total').textContent=money(total())+' · '+(weight()/1000).toFixed(2)+'kg';get('review').hidden=false;get('review-title').focus();
 });
 get('change-bag').addEventListener('click',()=>{invalidateReview();fields.coffee.focus();});
 get('download-bag').addEventListener('click',()=>{
  if(!bag.length||get('review').hidden)return;
  const text=['MOSSLINE ROASTERS - DEMO BAG','',...bag.map(line=>`${describe(line)}\nUnit: ${money(find(line.coffee).prices[line.size])}; line total: ${money(find(line.coffee).prices[line.size]*line.quantity)}`),'',`Bag total: ${money(total())}`,`Coffee weight: ${(weight()/1000).toFixed(2)}kg`,'','Fictional roastery / local concept demonstration. Prices are illustrative NZD pack prices. No order, tax calculation, payment, delivery or message was made. No personal details were collected. Refreshing or leaving the page clears the bag; this downloaded file remains on your device.'].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mossline-demo-bag.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);get('bag-status').textContent='Bag summary downloaded to your device. No order was sent.';
 });
 get('add-coffee').disabled=false;form.reset();
 const preset=new URLSearchParams(location.search).get('coffee');
 if(find(preset)){fields.coffee.value=preset;history.replaceState(null,'',location.pathname);}
 showChoice();render();
 window.addEventListener('pageshow',event=>{if(event.persisted){bag=[];form.reset();render();}});
}
