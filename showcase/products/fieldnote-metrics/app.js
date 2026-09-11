import {weeks,stores,categories,products,selectedRows,totals,csv,money} from './data.js';
document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-toggle');
const nav=document.querySelector('#main-nav');
if(menu&&nav){menu.hidden=false;const close=()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');};menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';nav.classList.toggle('open',open);menu.setAttribute('aria-expanded',String(open));});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav.classList.contains('open')){close();menu.focus();}});nav.addEventListener('click',event=>{if(event.target.closest('a'))close();});}
const field=id=>document.getElementById(id);
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const names={monday:'Monday Brief',category:'Category Review',compare:'Store Compare'};
const params=new URLSearchParams(location.search);
const dashboard=field('report-dashboard');
if(dashboard){
  dashboard.querySelectorAll('button,select').forEach(control=>{control.disabled=false;});
  let view=Object.hasOwn(names,params.get('view'))?params.get('view'):'monday';
  let visibleRows=[];
  for(const key of ['week','store','category']){const value=params.get(key);if(value&&[...field(key).options].some(option=>option.value===value))field(key).value=value;}
  const chart=(values)=>`<div class="bar-chart">${values.map(value=>`<div class="bar-row"><div class="bar-label"><span>${value.name}</span><strong>${money(value.netSales)}</strong></div><div class="bar-track"><span style="width:${Math.round(value.netSales/Math.max(...values.map(item=>item.netSales))*100)}%;background:${value.color??'#4c3d58'}"></span></div></div>`).join('')}</div>`;
  function render(){
    const week=field('week').value,store=field('store').value,category=field('category').value;
    visibleRows=selectedRows(week,store,category);
    const total=totals(visibleRows);
    const previous=week===weeks[0]?totals(selectedRows(weeks[1],store,category)):null;
    const categoryValues=categories.filter(item=>category==='all'||item.id===category).map(item=>({...item,...totals(visibleRows.filter(row=>row.category===item.id))}));
    const storeValues=stores.filter(item=>store==='all'||item.id===store).map(item=>({...item,...totals(visibleRows.filter(row=>row.store===item.id))}));
    field('report-title').textContent=names[view];
    field('report-period').textContent=field('week').selectedOptions[0].textContent+' / '+field('store').selectedOptions[0].textContent+' / '+field('category').selectedOptions[0].textContent;
    field('net-sales').textContent=money(total.netSales);
    field('unit-total').textContent=String(total.units);
    field('flag-total').textContent=String(total.flags);
    field('sales-change').textContent=previous?((total.netSales-previous.netSales>=0?'+':'')+((total.netSales-previous.netSales)/previous.netSales*100).toFixed(1)+'% vs previous sample week'):'Previous comparison unavailable';
    field('unit-context').textContent=visibleRows.length+' contributing store/SKU rows';
    const top=[...categoryValues].sort((a,b)=>b.netSales-a.netSales)[0];
    let reportMarkup='';
    if(view==='monday'){
      reportMarkup=`<div class="chart-layout"><section><h3>The category picture</h3>${chart(categoryValues)}</section><aside class="reading-note"><p class="label">A QUESTION FOR THE TEAM</p><h3>${top.name} in focus.</h3><p>${top.name} accounts for ${(top.netSales/total.netSales*100).toFixed(1)}% of selected net sales. Which product rows explain the mix?</p><p>${total.flags} selected stock ${total.flags===1?'row has':'rows have'} fewer closing units than units sold during this week. Check incoming orders and local context before acting.</p><a class="inline-link" href="#source-rows">Check the contributing rows <span aria-hidden="true">↓</span></a></aside></div>`;
    }else if(view==='compare'){
      const leader=[...storeValues].sort((a,b)=>b.netSales-a.netSales)[0];
      reportMarkup=`<div class="chart-layout"><section><h3>Net sales by store</h3>${chart(storeValues)}</section><aside class="reading-note"><p class="label">READ THE CONTEXT</p><h3>${storeValues.length===1?leader.name+' is selected.':leader.name+' leads this cut.'}</h3><p>${storeValues.length===1?'Select all stores to compare locations.':'At '+money(leader.netSales)+', this is the largest total for the selected week and category.'}</p><p>Store size, opening hours and promotions are not in this dataset. These totals are not normalised performance rankings.</p><a class="inline-link" href="#source-rows">Reconcile the stores <span aria-hidden="true">↓</span></a></aside></div>`;
    }else{
      const productValues=products.filter(item=>category==='all'||item.category===category).map(product=>{const data=visibleRows.filter(row=>row.sku===product.sku);return{...product,...totals(data),closing:data.reduce((sum,row)=>sum+row.closing,0)};});
      reportMarkup=`<div class="chart-layout"><section><h3>Selected category mix</h3>${chart(categoryValues)}</section><aside class="reading-note"><p class="label">REPLENISHMENT REVIEW</p><h3>${total.flags} source rows to check.</h3><p>Flag rule: closing units are below units sold in the selected week. Product totals below group the selected stores; inspect source rows for individual store flags.</p><p>Coverage = closing units ÷ this week's units sold. This historical ratio is not a forecast or an order recommendation.</p></aside></div><div class="table-scroll" tabindex="0" role="region" aria-label="Product coverage table" style="margin-top:30px"><table class="data-table"><caption class="small">Selected product totals / historical coverage in weeks</caption><thead><tr><th scope="col">SKU</th><th scope="col">Product</th><th scope="col">Units sold</th><th scope="col">Closing units</th><th scope="col">Coverage</th><th scope="col">Flagged store rows</th></tr></thead><tbody>${productValues.map(product=>`<tr><td>${product.sku}</td><td>${product.name}</td><td>${product.units}</td><td>${product.closing}</td><td>${(product.closing/product.units).toFixed(1)} weeks</td><td>${product.flags}</td></tr>`).join('')}</tbody></table></div>`;
    }
    field('report-view').innerHTML=reportMarkup;
    field('source-body').innerHTML=visibleRows.map(row=>`<tr><td><button type="button" data-row="${row.id}" aria-label="Inspect row ${row.id}">${row.id} ↗</button></td><td>${stores.find(item=>item.id===row.store).name}</td><td>${row.product}<br><small>${row.sku}</small></td><td>${categories.find(item=>item.id===row.category).name}</td><td class="numeric">${row.units}</td><td class="numeric">${money(row.netSales)}</td><td class="numeric">${row.closing}</td><td>${row.closing<row.units?'<span class="flag">Review</span>':'—'}</td></tr>`).join('');
    field('row-count').textContent=String(visibleRows.length);
    field('report-status').textContent=names[view]+' updated: '+visibleRows.length+' rows, '+money(total.netSales)+' net sales, '+total.units+' units. Synthetic sample / CAD.';
    field('row-inspector').hidden=true;
    field('walkthrough-next').href='contact.html?report='+view;
    document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;render();}));
  for(const id of ['week','store','category'])field(id).addEventListener('change',render);
  field('reset-report').addEventListener('click',()=>{field('week').value=weeks[0];field('store').value='all';field('category').value='all';view='monday';history.replaceState(null,'',location.pathname);render();});
  field('source-body').addEventListener('click',event=>{
    const button=event.target.closest('[data-row]');if(!button)return;
    const row=visibleRows.find(item=>item.id===button.dataset.row);if(!row)return;
    field('inspector-title').textContent='Source row '+row.id+' / '+row.product;
    field('inspector-fields').innerHTML=[['Week starting',row.week],['Store',stores.find(item=>item.id===row.store).name],['SKU',row.sku],['Category',categories.find(item=>item.id===row.category).name],['Units sold',row.units],['Net sales (CAD)',row.netSales],['Closing units',row.closing],['Historical coverage',(row.closing/row.units).toFixed(2)+' weeks']].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    field('inspector-note').textContent='This synthetic row contributes CAD'+row.netSales+' and '+row.units+' units to the selected totals. '+(row.closing<row.units?'Review flag: '+row.closing+' closing units is less than '+row.units+' units sold.':'No review flag: closing units are at least the units sold in this week.')+' No order is created.';
    field('row-inspector').hidden=false;field('close-row').dataset.returnRow=row.id;field('inspector-title').focus();
  });
  field('close-row').addEventListener('click',()=>{field('row-inspector').hidden=true;document.querySelector('[data-row="'+field('close-row').dataset.returnRow+'"]')?.focus();});
  field('download-csv').disabled=false;
  field('download-csv').addEventListener('click',()=>download(csv(visibleRows),'fieldnote-'+field('week').value+'-'+field('store').value+'-'+field('category').value+'.csv','text/csv;charset=utf-8'));
  render();
}
const form=field('walkthrough-form');
if(form){
  let outline='';
  field('prepare-outline').disabled=false;
  const report=params.get('report');if(report&&Object.hasOwn(names,report))field('focus').value=report;
  const count=params.get('stores');if(['4','8'].includes(count))field('store-count').value=count;
  const clearResult=()=>{field('agenda-review').hidden=true;field('agenda-help').hidden=false;outline='';};
  form.addEventListener('input',clearResult);form.addEventListener('change',clearResult);
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const count=Number(field('store-count').value),focus=field('focus').value,ready=field('csv-ready').value;
    const plan=count<3||count>20?'Outside the standard 3–20 store plans. A separate scope discussion is needed.':count<=5?'Small Chain / CAD149 per month for 3–5 stores. Concept pricing; no subscription created.':'Growing Chain / CAD299 per month for 6–20 stores. Concept pricing; no subscription created.';
    const agenda=[{monday:'Start with your weekly trading meeting: who reads the headline, what comparison is useful and which follow-up questions matter?',category:'Start with product and category mappings, closing stock and the decisions your team makes before replenishment.',compare:'Start with consistent store IDs, reporting dates and context such as opening hours before comparing store totals.'}[focus],ready==='ready'?'Bring a description of your CSV columns and reporting period. Do not upload real sales data to this demonstration.':ready==='partial'?'List which columns are missing. Agree the store, product, category, week, units, net sales and closing-stock definitions before a trial.':'First confirm whether your POS can export the required weekly fields. Fieldnote does not supply POS hardware or a connector in this demo.','Review one sample week together and trace a total back to its source rows. Agree what onboarding work would be needed for '+count+' stores.'];
    field('agenda-title').textContent=names[focus]+' walkthrough outline';field('agenda-plan').textContent=plan;
    field('agenda-items').replaceChildren(...agenda.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    outline=['FIELDNOTE METRICS / WALKTHROUGH OUTLINE','Fictional company / local demonstration','Focus: '+names[focus],'Stores: '+count,'CSV readiness: '+field('csv-ready').selectedOptions[0].textContent,plan,...agenda.map((text,index)=>(index+1)+'. '+text),'Nothing sent or booked. No account, upload, subscription or payment. Answers remain in current-page memory.'].join('\n');
    field('agenda-help').hidden=true;field('agenda-review').hidden=false;field('agenda-title').focus();
  });
  field('edit-outline').addEventListener('click',()=>{clearResult();field('store-count').focus();});
  field('clear-outline').addEventListener('click',()=>{form.reset();history.replaceState(null,'',location.pathname);clearResult();field('store-count').focus();});
  field('download-outline').addEventListener('click',()=>{if(outline)download(outline,'fieldnote-walkthrough-outline.txt','text/plain;charset=utf-8');});
}
