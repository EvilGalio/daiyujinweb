document.documentElement.classList.add('js-ready');
const menu=document.querySelector('.menu');const nav=document.querySelector('#navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav?.classList.contains('open')){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.focus();}});
if(!location.pathname.includes('/showcase/products/'))document.querySelectorAll('[data-showcase]').forEach(link=>link.href='/showcase/#work');
const detailData=document.querySelector('#detail-data');
if(detailData){const piece=JSON.parse(detailData.textContent);document.querySelectorAll('[data-piece-size]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>{const size=piece.sizes.find(s=>s.id===button.dataset.pieceSize);document.querySelector('#piece-drawing').innerHTML=globalThis.formsteadDrawing(piece,size);document.querySelector('#size-copy').textContent=`${size.l} × ${size.d} × ${size.h} mm`;document.querySelectorAll('[data-piece-size]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));});});}
const form=document.querySelector('#configuration');
if(form){
 const {pieces,finishes}=JSON.parse(document.querySelector('#config-data').textContent);
 const fields=Object.fromEntries(['piece','size','finish','quantity','region','access','timing'].map(id=>[id,document.getElementById(id)]));
 const regions={be:'Belgium',nl:'Netherlands',other:'Elsewhere'};
 const accessOptions={checked:'Measured, on one accessible level',unchecked:'Not measured yet',stairs:'Includes stairs or a narrow turn'};
 const timings={standard:'Planning around 8–12 weeks after approval',flexible:'Flexible; discuss an available slot',urgent:'Needed in under 6 weeks'};
 const $=id=>document.getElementById(id);
 const dimension=size=>`${size.l} × ${size.d} × ${size.h} mm`;
 let downloadText='';
 function clearError(){ $('form-error').hidden=true;Object.values(fields).forEach(field=>field.removeAttribute('aria-invalid')); }
 function refreshSizes(){const piece=pieces.find(p=>p.id===fields.piece.value);fields.size.replaceChildren(new Option(piece?'Choose a size':'Choose a piece first',''));if(piece)for(const size of piece.sizes)fields.size.add(new Option(dimension(size),size.id));fields.size.disabled=!piece;}
 function preview(){
  const piece=pieces.find(p=>p.id===fields.piece.value);$('preview').hidden=!piece;$('preview-empty').hidden=!!piece;if(!piece)return;
  $('preview-title').textContent=piece.name;$('preview-image').src=`assets/images/${piece.id}-768.webp`;$('preview-image').alt=`${piece.name} in Natural oak, larger size shown`;$('preview-spec').href=piece.file;
  const size=piece.sizes.find(s=>s.id===fields.size.value);const finish=finishes[fields.finish.value];const quantity=Number(fields.quantity.value);
  $('configured-drawing').hidden=!size||!finish;
  if(size&&finish){$('configured-drawing').innerHTML=globalThis.formsteadDrawing(piece,size,fields.finish.value);$('preview-details').textContent=`${dimension(size)} · ${finish.name}`;$('finish-description').textContent=finish.description;const area=size.l*size.d/1000000;$('preview-footprint').textContent=`${area.toFixed(3)} m² per piece${Number.isInteger(quantity)&&quantity>=1&&quantity<=6?` · ${(area*quantity).toFixed(3)} m² for ${quantity} ${quantity===1?'piece':'pieces'}`:''}`;}
  else{$('preview-details').textContent='Choose a size and finish to see the configuration.';$('finish-description').textContent='';$('preview-footprint').textContent='';}
 }
 function reset(focus=false){form.reset();refreshSizes();clearError();preview();$('choose-layout').hidden=false;$('result').hidden=true;$('download-status').textContent='';downloadText='';if(focus)fields.piece.focus();}
 form.reset();refreshSizes();$('create-note').disabled=false;$('clear-form').disabled=false;
 const initial=pieces.find(piece=>piece.id===new URLSearchParams(location.search).get('piece'));if(initial){fields.piece.value=initial.id;refreshSizes();}if(location.search)history.replaceState(null,'',location.pathname);preview();
 fields.piece.addEventListener('change',()=>{refreshSizes();clearError();preview();});
 form.addEventListener('input',()=>{clearError();preview();});form.addEventListener('change',()=>{clearError();preview();});
 function invalid(field,message){fields[field].setAttribute('aria-invalid','true');$('form-error').textContent=message;$('form-error').hidden=false;fields[field].focus();}
 form.addEventListener('submit',event=>{
  event.preventDefault();clearError();const piece=pieces.find(p=>p.id===fields.piece.value);if(!piece)return invalid('piece','Choose one of the three furniture pieces.');
  const size=piece.sizes.find(s=>s.id===fields.size.value);if(!size)return invalid('size','Choose one of the listed sizes for this piece.');
  const finish=finishes[fields.finish.value];if(!finish)return invalid('finish','Choose Natural oak or Warm brown oak.');
  const quantity=Number(fields.quantity.value);if(!Number.isInteger(quantity)||quantity<1||quantity>6)return invalid('quantity','Choose a whole quantity from 1 to 6.');
  const region=regions[fields.region.value];if(!region)return invalid('region','Choose the destination region.');
  const access=accessOptions[fields.access.value];if(!access)return invalid('access','Choose the current room and access status.');
  const timing=timings[fields.timing.value];if(!timing)return invalid('timing','Choose a timing expectation.');
  const gaps=[];if(fields.region.value==='other')gaps.push('The destination is outside Belgium and the Netherlands. A separate service-region decision is needed; delivery is not offered or priced by this note.');
  if(fields.timing.value==='urgent')gaps.push('Under six weeks is outside the collection’s 8–12 week planning assumption. No accelerated production or arrival date can be confirmed here.');
  const questions=[`Review a physical ${finish.name} sample and confirm the written ${dimension(size)} specification for ${quantity} ${quantity===1?'piece':'pieces'}.`];
  if(fields.access.value==='unchecked')questions.push('Measure the intended room, door openings and full access route before assessing suitability. The furniture footprint does not check the space around it.');
  if(fields.access.value==='stairs')questions.push('Review stair widths, landings, narrow turns and any handling or assembly requirements with the workshop. Do not assume the selected piece will pass through.');
  if(fields.access.value==='checked')questions.push('Keep the measured room and access dimensions ready for workshop review. A self-check is useful context, not a delivery or fit approval.');
  if(piece.id==='lowline')questions.push('Review Lowline’s room position, intended contents and any restraint or wall-fixing plan for the actual wall type. No load or tip-resistance rating is supplied.');
  if(piece.id==='trest')questions.push('Allow for actual chairs, the trestle supports and movement around the table. The stated table footprint is not a recommended dining-area size.');
  if(piece.id==='fold')questions.push('Confirm the intended residential seating use and the circulation route. Fold is a fixed bench, not a folding mechanism or step.');
  if(fields.timing.value==='flexible')questions.push('Ask which production slot could suit the agreed specification. A flexible timing preference has not reserved capacity.');
  else if(fields.timing.value==='standard')questions.push('Confirm the actual production and delivery schedule in writing. Eight to twelve weeks after final approval remains a planning assumption.');
  else questions.push('Discuss a different date or whether the workshop can accept the scope before proceeding. This note cannot promise an urgent slot.');
  const area=size.l*size.d/1000000;
  const specs=[['Piece',piece.name],['Dimensions',dimension(size)],['Finish',finish.name],['Quantity',String(quantity)],['Per-piece footprint',`${area.toFixed(3)} m²`],['Total footprint',`${(area*quantity).toFixed(3)} m² — not a room-fit check`],['Destination',region],['Access',access],['Timing',timing]];
  $('result-title').textContent=gaps.length?'A configuration with scope gaps.':'Your configuration, ready to discuss.';
  $('result-intro').textContent=gaps.length?'Your choices are recorded below. Resolve the listed gaps before treating this as a suitable commission. No quotation, delivery or production commitment has been made.':'Your selections are within the collection’s stated region and planning options. The workshop would still need to confirm suitability, a physical finish sample, price and schedule in writing.';
  $('scope-alert').hidden=!gaps.length;$('scope-gaps').replaceChildren(...gaps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('result-specs').replaceChildren(...specs.map(([label,value])=>{const row=document.createElement('div');const dt=document.createElement('dt');const dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);return row;}));
  $('result-questions').replaceChildren(...questions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  downloadText=['FORMSTEAD FURNITURE — LOCAL CONFIGURATION NOTE','Fictional furniture workshop / concept website','',gaps.length?'STATUS: Scope gaps to resolve':'STATUS: Ready for a scope discussion','',...specs.map(([label,value])=>`${label}: ${value}`),'Dimensions are nominal length x depth x height. Floor area is a footprint, not a room-fit, access or capacity assessment.','','SCOPE GAPS',...(gaps.length?gaps:['None identified by these limited selections. Actual suitability still needs review.']),'','QUESTIONS FOR THE WORKSHOP',...questions.map((text,index)=>`${index+1}. ${text}`),'','No quotation, order, production slot, payment, message or delivery is created. No personal data has been requested. Choices stay only on the current page; this downloaded file remains on your device.','No actual price, certification, tested load rating, material warranty or confirmed lead time is provided.'].join('\n');
  $('choose-layout').hidden=true;$('result').hidden=false;$('download-status').textContent='';$('result-title').focus();
 });
 $('edit-note').addEventListener('click',()=>{$('result').hidden=true;$('choose-layout').hidden=false;$('download-status').textContent='';fields.piece.focus();});
 $('clear-form').addEventListener('click',()=>reset(true));$('clear-note').addEventListener('click',()=>reset(true));
 $('download-note').addEventListener('click',()=>{if(!downloadText)return;const blob=new Blob([downloadText],{type:'text/plain;charset=utf-8'});const objectUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=objectUrl;link.download=`formstead-${fields.piece.value}-configuration.txt`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);$('download-status').textContent='Your configuration note was prepared as a TXT download. No message was sent.';});
 window.addEventListener('pageshow',event=>{if(event.persisted)reset();});
}
