document.documentElement.classList.add("js");
const menu=document.querySelector(".menu"),nav=document.querySelector("#main-nav");
menu?.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")!=="true";menu.setAttribute("aria-expanded",String(open));nav.classList.toggle("open",open);});
document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&menu?.getAttribute("aria-expanded")==="true"){menu.setAttribute("aria-expanded","false");nav.classList.remove("open");menu.focus();}});
const choices=document.querySelectorAll("[data-feature]");
for(const button of choices)button.addEventListener("click",()=>{const selected=button.dataset.feature;for(const other of choices)other.setAttribute("aria-pressed",String(other===button));for(const panel of document.querySelectorAll(".feature-panel"))panel.hidden=panel.id!=="feature-"+selected;});
const form=document.querySelector("#demo-form");
if(form){
  const feature=form.elements.namedItem("feature"),force=form.elements.namedItem("force"),review=document.querySelector("#demo-review");
  const selected=new URLSearchParams(location.search).get("feature");
  if(["profile","height","force"].includes(selected))feature.value=selected;
  const updateForce=()=>{const active=feature.value==="force";document.querySelector(".force-field").hidden=!active;force.disabled=!active;};
  updateForce();feature.addEventListener("change",updateForce);
  let briefText="";
  form.addEventListener("input",()=>{review.hidden=true;briefText="";});
  form.addEventListener("submit",(event)=>{
    event.preventDefault();if(!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form)),size=Number(data.size);
    const model={profile:"O300",height:"G20",force:"F8"}[data.feature];
    const notes=[],checklist=["Bring representative samples and identify the feature and intended result-recording method.","Agree the fixture or reference arrangement before judging a catalogue specification."];
    let constrained=false;
    if(data.feature==="profile"){
      notes.push("O300 uses the external silhouette and a manual XY stage; lens field of view and workholding need review.");
      checklist.push("Show the intended viewing orientation and record sample mass; the illustrative stage-load limit is 5 kg.");
      if(size>150){constrained=true;notes.push("This sample exceeds the 150 mm first-review threshold. Stage travel is not a guaranteed sample envelope; review workholding and the visible field before selecting O300.");}
      if(data.condition==="soft")notes.push("Non-contact viewing may help, but confirm the sample can be held without changing its shape.");
    }
    if(data.feature==="height"){
      notes.push("G20 uses a contact probe and a suitable surface plate. Its 0.01 mm display increment is not an accuracy claim.");
      checklist.push("Identify a stable reference face and make the intended contact point accessible.");
      if(size>300){constrained=true;notes.push("The sample dimension exceeds G20's 300 mm travel. Review the actual measurement orientation or a different instrument.");}
      if(data.condition==="soft"){constrained=true;notes.push("A soft sample can change under contact. A different method or supporting fixture needs review.");}
    }
    if(data.feature==="force"){
      notes.push("F8 combines a manual stand and a matched force gauge. The stand alone does not measure force.");
      checklist.push("Define push or pull direction, anticipated force and the grips or contact fixture.");
      if(Number(data.force)>500){constrained=true;notes.push("The anticipated force exceeds the matched 500 N gauge range. A different gauge/stand configuration must be reviewed.");}
      if(size>200){constrained=true;notes.push("This sample needs a clearance review against the 200 mm crosshead travel and the space occupied by fixtures.");}
      if(data.condition==="soft")notes.push("Include how the sample is supported and the intended loading point; fixture contact can change the observed behaviour.");
    }
    if(data.condition==="unstable"){constrained=true;notes.push("Repeatable workholding is unresolved. Establish the sample support before choosing the final instrument.");}
    if(data.reporting==="automated"){constrained=true;notes.push("Automatic export or a continuous trace is outside all three configurations. These instruments use operator-recorded results; discuss another system if automation is essential.");}
    if(data.market==="Other"){constrained=true;notes.push("Your market is outside the stated distributor area. Confirm coverage before arranging a real demonstration.");}
    else checklist.push("Confirm the local distributor and demonstration arrangements for "+data.market+".");
    const label=String(data.sample||"Unlabelled example sample").trim();
    const status=constrained?"Review the constraints before selecting.":"Candidate for an application demonstration.";
    const inputs=label+" / "+size+" mm / "+data.condition+" sample / "+data.market+(data.feature==="force"?" / anticipated "+Number(data.force)+" N":"")+".";
    document.querySelector("#review-title").textContent=model+" — "+{profile:"external profile",height:"step height",force:"push / pull"}[data.feature];
    document.querySelector("#review-status").textContent=status;document.querySelector("#review-inputs").textContent=inputs;
    for(const [selector,items]of [["#review-notes",notes],["#review-checklist",checklist]]){const list=document.querySelector(selector);list.replaceChildren();for(const item of items){const li=document.createElement("li");li.textContent=item;list.append(li);}}
    briefText="ORLEN METROLOGY / APPLICATION BRIEF\nFictional company / concept website\nNo measurement performed. No appointment booked. Nothing sent.\n\n"+model+"\n"+status+"\n"+inputs+"\nReporting: "+data.reporting+"\n\nSelection notes:\n- "+notes.join("\n- ")+"\n\nPrepare:\n- "+checklist.join("\n- ")+"\n\nThese are illustrative preparation notes, not a capability approval, certification or quotation. Data remains in this page; downloaded copies stay on your device.\n";
    review.hidden=false;review.focus();
  });
  document.querySelector("#edit-brief").addEventListener("click",()=>{review.hidden=true;feature.focus();});
  document.querySelector("#clear-brief").addEventListener("click",()=>{form.reset();feature.value="profile";updateForce();briefText="";review.hidden=true;feature.focus();});
  document.querySelector("#download-brief").addEventListener("click",()=>{if(!briefText)return;const url=URL.createObjectURL(new Blob([briefText],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="orlen-application-brief.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
}
