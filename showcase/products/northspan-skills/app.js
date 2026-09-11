import {courses,experienceLevels,experienceLabels,money} from './data.js';
document.querySelectorAll('[data-showcase]').forEach(a=>{if(!location.pathname.startsWith('/showcase/products/'))a.href='/showcase/#work'});
const comparison=document.getElementById('comparison-results');
if(comparison){
const experience=document.getElementById('compare-experience'),timing=document.getElementById('compare-timing'),matches=document.getElementById('matches-only');
const update=()=>{
 let count=0;
 comparison.innerHTML=courses.map(c=>{
 const ready=experienceLevels[experience.value]>=c.level,cohorts=c.cohorts.filter(co=>timing.value==='any'||co.timing===timing.value);
 if(matches.checked&&(!ready||!cohorts.length))return '';
 count++;
 const status=!ready?'Check the starting requirement':!cohorts.length?'No published time matches':'Starting point and time match';
 return `<article class="compare-row"><div><h3>${c.name}</h3><p>${money(c.price)} · ${c.hours} hours</p></div><div><strong class="small">${status}</strong><p>${!ready?c.prerequisite:cohorts.length?cohorts.map(co=>co.label).join('<br>'):'Try weekday daytime or discuss a future cohort.'}</p></div><a class="text-link" href="#${c.id}">Read full course ↗</a></article>`;
 }).join('');
 if(!count)comparison.innerHTML='<div class="empty"><strong>No published options match both choices.</strong><p>Change your timing or starting point, or use the enquiry planner to discuss a future date. Full course details remain below.</p></div>';
};
for(const el of [experience,timing,matches])el.addEventListener('change',update);
update();
}
const form=document.getElementById('enquiry-form');
if(form){
const fields=document.getElementById('enquiry-fields'),course=document.getElementById('course'),experience=document.getElementById('experience'),cohort=document.getElementById('cohort'),group=document.getElementById('group'),count=document.getElementById('count'),basics=document.getElementById('basics'),error=document.getElementById('form-error'),result=document.getElementById('enquiry-result'),status=document.getElementById('planner-status');
let note='';
form.reset();
fields.disabled=false;
const updateCohorts=()=>{const c=courses.find(item=>item.id===course.value);cohort.innerHTML='<option value="">'+(c?'Choose a cohort':'Choose a course first')+'</option>'+(c?c.cohorts.map(co=>`<option value="${co.id}">${co.label}</option>`).join('')+'<option value="discuss">Discuss another date</option>':'')};
const updateCount=()=>{const individual=group.value==='individual';count.readOnly=individual;count.max=individual?'1':'12';if(individual)count.value='1';document.getElementById('count-hint').textContent=individual?'One adult learner. Choose employer team for a group.':'Employer groups: 1–12. Larger than a normal class needs discussion.'};
course.addEventListener('change',updateCohorts);
group.addEventListener('change',updateCount);
const query=new URLSearchParams(location.search);
if(courses.some(c=>c.id===query.get('course'))){course.value=query.get('course');updateCohorts();if([...cohort.options].some(o=>o.value===query.get('cohort')))cohort.value=query.get('cohort')}
if(query.get('group')==='employer')group.value='employer';
if(location.search)history.replaceState(null,'',location.pathname+location.hash);
updateCount();
const clear=()=>{
note='';result.hidden=true;result.innerHTML='';form.hidden=false;error.hidden=true;error.textContent='';status.textContent='Choices cleared. Nothing was stored or sent.';
setTimeout(()=>{updateCohorts();updateCount()},0);
};
form.addEventListener('reset',clear);
window.addEventListener('pageshow',event=>{if(event.persisted)form.reset()});
form.addEventListener('submit',event=>{
event.preventDefault();
const c=courses.find(item=>item.id===course.value),n=Number(count.value);
const co=c?.cohorts.find(item=>item.id===cohort.value);
let message='';
if(!c)message='Choose a course to prepare an enquiry.';
else if(!(experience.value in experienceLevels))message='Choose your starting experience.';
else if(!co&&cohort.value!=='discuss')message='Choose a published cohort or discuss another date.';
else if(!['individual','employer'].includes(group.value))message='Choose whether this is for one learner or an employer team.';
else if(!Number.isInteger(n)||n<1||n>12||(group.value==='individual'&&n!==1))message='Enter a whole number from 1 to 12 for a team, or 1 for an individual.';
else if(!basics.checked)message='Check the adult, English and arithmetic starting requirements before preparing the note.';
if(message){error.textContent=message;error.hidden=false;error.focus();return}
error.hidden=true;
const gap=experienceLevels[experience.value]<c.level,otherDate=cohort.value==='discuss',split=n>c.size;
const actions=[];
if(gap)actions.push('Starting skills need a conversation. '+c.prerequisite+' Discuss an appropriate first step before joining this course.');
else actions.push('Your selected starting point meets the published computer requirement. Confirm the complete prerequisite and practical arrangements before enrolment.');
if(otherDate)actions.push('No published cohort selected. Discuss a future date; no alternative date or place is promised.');
else actions.push('Ask about availability for '+co.label+'. The full cohort is needed; this note does not reserve a place.');
if(split)actions.push(`Your group of ${n} exceeds the normal class size of ${c.size}. Discuss a split group or separate delivery; the reference total is not a private-course quote.`);
else if(group.value==='employer')actions.push(`A team of ${n} is within the normal class size of ${c.size}. Confirm individual starting points and actual availability for all learners.`);
else actions.push('This note is for one adult learner. Ask about any practical learning arrangements through an appropriate real provider.');
const title=gap||otherDate||split?'A few points to discuss first.':'Your enquiry note is ready.';
const date=co?co.label:'Discuss another date';
const total=c.price*n;
note=['NORTHSPAN SKILLS - COURSE ENQUIRY PREPARATION','Fictional training centre / local demonstration. Nothing sent, booked or paid.','',c.name,'Status: '+title,'Starting experience: '+experienceLabels[experience.value],'Published requirement: '+c.prerequisite,'Cohort: '+date,'Learners: '+n+' ('+(group.value==='employer'?'employer team':'individual')+')','Reference fee: '+money(c.price)+' x '+n+' = '+money(total),'Reference fees are illustrative, not an invoice, private-course quote or offer.','Taught hours: '+c.hours+'; normal class size: '+c.size,'','POINTS FOR THE CONVERSATION',...actions.map((a,i)=>(i+1)+'. '+a),'','CLASSROOM EXERCISE',c.exercise,c.limits,'','INCLUDED','Classroom computers and temporary software access where needed; worksheets and stationery.','Not included: take-home software licence, lunch or accommodation.','','No personal data was requested. Page choices disappear on refresh or departure. This downloaded file remains on your device.','No accredited award, funding, job outcome or live place is promised.'].join('\n');
result.innerHTML=`<span class="pill">Course enquiry preparation / Nothing sent</span><h2 id="result-title" style="margin-top:22px">${title}</h2><p>${c.name}</p><div class="result-grid"><dl><div><dt>Starting experience</dt><dd>${experienceLabels[experience.value]}</dd></div><div><dt>Preferred cohort</dt><dd>${date}</dd></div><div><dt>Learning time and group</dt><dd>${c.hours} taught hours · ${n} learner${n===1?'':'s'}</dd></div></dl><div><span class="eyebrow">Illustrative reference total</span><div class="result-total">${money(total)}</div><p>${money(c.price)} per learner × ${n}</p><p class="small">Not an invoice, private-course quote or confirmed availability.</p></div></div><h3>What to discuss next</h3><ul>${actions.map(a=>`<li>${a}</li>`).join('')}</ul><h3>The work you will practise</h3><p>${c.exercise}</p><p class="small">${c.limits}</p><h3>Included in the classroom</h3><p>Computers and temporary software access where needed, worksheets and stationery. No take-home software licence, lunch or accommodation.</p><div class="buttons"><button class="button" type="button" data-download>Download my note (TXT)</button><button class="button light" type="button" data-edit>Edit choices</button><button class="button light" type="button" data-clear>Clear and start again</button></div><p class="small" style="margin-top:20px">Choices stay on this page only. A downloaded file remains on your device. No message, enrolment or payment takes place.</p>`;
form.hidden=true;result.hidden=false;status.textContent='Preparation note created on this page. Nothing was sent.';result.focus();
result.querySelector('[data-edit]').addEventListener('click',()=>{result.hidden=true;form.hidden=false;status.textContent='Editing your choices.';course.focus()});
result.querySelector('[data-clear]').addEventListener('click',()=>{form.reset();course.focus()});
result.querySelector('[data-download]').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([note],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='northspan-'+c.id+'-enquiry.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Your text note was downloaded. Nothing was sent to Northspan.'});
});
}
