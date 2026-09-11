document.documentElement.classList.add('js');
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
if (menu && nav) {
  menu.hidden = false;
  const close = () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && nav.classList.contains('open')) { close(); menu.focus(); } });
  nav.addEventListener('click', event => { if (event.target.closest('a')) close(); });
}
const form = document.querySelector('#source-form');
if (form) {
  const field = id => document.getElementById(id);
  const review = field('source-review');
  const aside = field('planner-help');
  let preparedText = '';
  field('prepare-source').disabled = false;
  const params = new URLSearchParams(location.search);
  for (const key of ['source', 'use']) {
    const value = params.get(key);
    if (value && [...field(key).options].some(option => option.value === value)) field(key).value = value;
  }
  const systems = {sediment: 'Sediment Rack SR-20', carbon: 'Carbon Stage CS-40', pilot: 'Reuse Pilot RP-10'};
  let requested = systems[params.get('system')];
  if (requested) { field('selected-context').textContent = 'Starting conversation: ' + requested + '. The preparation list is not a recommendation for this equipment.'; field('selected-context').hidden = false; }
  const invalidate = () => { review.hidden = true; aside.hidden = false; preparedText = ''; };
  const demandState = () => { field('demand').disabled = field('unknown-demand').checked; field('demand').required = !field('unknown-demand').checked; };
  form.addEventListener('input', () => { demandState(); invalidate(); });
  form.addEventListener('change', () => { demandState(); invalidate(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const source = field('source').value;
    const use = field('use').value;
    const region = field('region').value;
    const text = id => field(id).selectedOptions[0].textContent;
    const items = [];
    const alerts = [];
    const sourceItems = {
      rain: 'Bring a catchment and storage sketch, roof/catchment observations and records of seasonal changes in stored water.',
      bore: 'Bring the bore/source history and any available water analysis, with sample dates and operating conditions.',
      surface: 'Bring a source-location sketch and records of changing conditions. Agree what evidence is needed before discussing treatment.',
      reuse: 'Start with a bounded Reuse Pilot discussion: describe the upstream process, inputs that may change and the proposed trial end point.',
      unknown: 'Identify where the water comes from and who holds its records before selecting equipment or planning a trial.'
    };
    items.push(sourceItems[source]);
    if (use === 'drinking') {
      alerts.push('Drinking-water assessment is outside our scope. This planner cannot determine safety or recommend a potable system. Seek an appropriately qualified local provider.');
    } else {
      items.push({irrigation:'Describe the ornamental crop, irrigation method and operating pattern. Record the end-use requirements separately from the filter choice.',rinse:'Bring the process-rinse requirement from the equipment or process owner, including which stages use the water.',wash:'Describe the non-contact wash task, where the water goes afterwards and any separation requirements to discuss.'}[use]);
    }
    items.push(field('variability').value === 'stable' ? 'Include the records behind the stable-source description, and note when operating conditions last changed.' : field('variability').value === 'seasonal' ? 'List wet/dry season differences and notable changes in colour, sediment or operating conditions; observations do not replace analysis.' : 'Keep a source-change log so the review can identify what is still unknown.');
    items.push(field('report').value === 'recent' ? 'Have the existing report ready with its date, source and sampling context. The review determines whether further evidence is needed.' : field('report').value === 'older' ? 'Bring the older report and a list of changes since sampling; agree whether new analysis is needed.' : 'Agree appropriate sampling containers, timing and handling with a laboratory before taking samples. Rillworks does not provide laboratory analysis.');
    items.push(field('unknown-demand').checked ? 'Record daily operating demand and peak-use periods before sizing is discussed; demand has not yet been measured.' : 'Stated demand: ' + Number(field('demand').value) + ' m³/day. Bring the measurement basis and peak-use pattern; this number does not establish equipment capacity.');
    items.push('Prepare a plant-area sketch with pipe routes, isolation points, access for maintenance and indoor/outdoor conditions.');
    if (region === 'outside') alerts.push('Your site is outside our North Island service area. Coverage must be resolved before a Rillworks project can be scoped.');
    else items.push('Site area: ' + text('region') + '. A visit would be agreed only after a scope discussion; none is booked here.');
    const title = use === 'drinking' ? 'A scope limit to resolve first.' : source === 'reuse' ? 'Your reuse-pilot preparation.' : 'Your source review starts here.';
    field('review-title').textContent = title;
    field('review-summary').textContent = text('source') + ' → ' + text('use') + ' / ' + text('region');
    field('review-alerts').replaceChildren(...alerts.map(value => { const p = document.createElement('p'); p.className = 'review-alert'; p.textContent = value; return p; }));
    field('review-list').replaceChildren(...items.map(value => { const li = document.createElement('li'); li.textContent = value; return li; }));
    preparedText = ['RILLWORKS WATER / SOURCE PREPARATION', 'Fictional company / local demonstration', title, field('review-summary').textContent, requested ? 'Initial interest: ' + requested : '', '', ...alerts, '', ...items.map((value,index)=>(index+1)+'. '+value), '', 'No enquiry sent. No laboratory analysis, quotation, appointment, equipment recommendation or water-safety determination. Inputs stay in current-page memory; a downloaded file is saved by your browser.'].filter(Boolean).join('\n');
    aside.hidden = true; review.hidden = false; field('review-title').focus({ preventScroll: true }); review.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  field('edit-source').addEventListener('click', () => { invalidate(); field('source').focus(); });
  field('clear-source').addEventListener('click', () => { form.reset(); requested = undefined; demandState(); invalidate(); field('selected-context').hidden = true; history.replaceState(null, '', location.pathname); field('source').focus(); });
  field('download-source').addEventListener('click', () => {
    if (!preparedText) return;
    const url = URL.createObjectURL(new Blob([preparedText], {type:'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rillworks-source-preparation.txt'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  demandState();
}
