const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menuButton.textContent = open ? 'Close' : 'Menu';
  navigation?.classList.toggle('is-open', open);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    menuButton.click();
    menuButton.focus();
  }
});
navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a') && menuButton?.getAttribute('aria-expanded') === 'true') menuButton.click();
});

const enquiryForm = document.querySelector('#enquiry-form');
if (enquiryForm) {
  const field = (name) => enquiryForm.elements.namedItem(name);
  const partDefaults = {
    'nd-14': { process: 'milling', material: 'aluminium', quantity: 100 },
    'nd-28': { process: 'milling', material: 'aluminium', quantity: 50 },
    'nd-32': { process: 'turning', material: 'stainless', quantity: 200 },
  };
  const review = document.querySelector('#enquiry-review');
  const errorBox = document.querySelector('#form-errors');
  const status = document.querySelector('#download-status');
  let downloadText = '';

  function applyPart(value) {
    const selected = partDefaults[value];
    if (!selected) return;
    field('process').value = selected.process;
    field('material').value = selected.material;
    field('quantity').value = selected.quantity;
    field('finish').value = 'machined';
  }

  const query = new URLSearchParams(window.location.search);
  if (Object.hasOwn(partDefaults, query.get('part'))) {
    field('part').value = query.get('part');
    applyPart(query.get('part'));
  } else if (['aluminium', 'stainless', 'acetal'].includes(query.get('material'))) {
    field('material').value = query.get('material');
  }
  field('part').addEventListener('change', () => applyPart(field('part').value));
  function showError(message, input) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    input?.focus();
  }
  function label(name) {
    const select = field(name);
    return select.options[select.selectedIndex].text;
  }
  function showForm(reset) {
    if (reset) {
      enquiryForm.reset();
      history.replaceState(null, '', window.location.pathname);
      downloadText = '';
    }
    review.hidden = true;
    enquiryForm.hidden = false;
    errorBox.hidden = true;
    status.textContent = '';
    field('part').focus();
  }
  document.querySelector('#edit-enquiry').addEventListener('click', () => showForm(false));
  document.querySelector('#reset-enquiry').addEventListener('click', () => showForm(true));

  enquiryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const invalid = [...enquiryForm.elements].find((input) => input.willValidate && !input.checkValidity());
    if (invalid) {
      const message = invalid.name === 'process'
        ? 'Choose a machining process, or select process advice.'
        : invalid.name === 'quantity'
          ? 'Enter a whole-number batch quantity from 1 to 10,000.'
          : 'Check the highlighted field before reviewing your enquiry.';
      showError(message, invalid);
      return;
    }
    const values = Object.fromEntries(new FormData(enquiryForm).entries());
    if (values.finish === 'anodised' && values.material !== 'aluminium') {
      showError('This workshop coordinates anodising only for aluminium. Change the material or choose another finish.', field('finish'));
      return;
    }
    const quantity = Number(values.quantity);
    const inspections = new FormData(enquiryForm).getAll('inspection');
    let fitTitle = 'Within our published planning scope';
    let fitDescription = 'The process, material and batch fit the regular workshop scope. A drawing review is still required before manufacturability, price or timing can be confirmed.';
    if (values.process === 'fabrication') {
      fitTitle = 'Outside our machining services';
      fitDescription = 'We do not offer casting or sheet-metal fabrication. This brief can help you approach a suitable supplier; it is not an accepted Noll Datum machining enquiry.';
    } else if (quantity < 25 || quantity > 500) {
      fitTitle = 'Outside our regular batch range';
      fitDescription = quantity < 25
        ? 'Our regular work starts at 25 pieces. A smaller quantity needs a separate conversation about setup cost and whether this workshop is a suitable route.'
        : 'Our regular batches stop at 500 pieces. A larger quantity needs a capacity and delivery-pattern review before this workshop could consider it.';
    } else if (values.process === 'review' || values.material === 'review') {
      fitTitle = 'Process or material review needed';
      fitDescription = 'Your batch is within our regular range, but the manufacturing process or exact material has not been established. Resolve that choice before treating this as a machining scope.';
    }
    const checklist = [];
    if (values.drawingStatus === 'released') checklist.push('Provide the released drawing and matching model; confirm ' + (values.revision.trim() ? 'revision ' + values.revision.trim() : 'the revision identifier') + ' before work is planned.');
    if (values.drawingStatus === 'draft') checklist.push('Resolve open drawing notes and issue a controlled revision before manufacturing is released.');
    if (values.drawingStatus === 'none') checklist.push('Prepare a dimensioned drawing and matching model. No drawing is uploaded or generated by this tool.');
    if (values.process === 'milling') checklist.push('Identify the mounting datums, deep pockets and features that may require an additional milling setup.');
    if (values.process === 'turning') checklist.push('Specify bore fit, face relationships and any radial features that need a secondary operation.');
    if (values.process === 'review') checklist.push('Describe the geometry so an engineer can determine whether milling, turning or a combined route is appropriate.');
    if (values.process === 'fabrication') checklist.push('Find a supplier offering your required casting or sheet-metal process; this workshop cannot fulfil that route.');
    if (values.material === 'acetal') checklist.push('Confirm the acetal grade and intended assembly conditions with your design team; material suitability remains a design responsibility.');
    if (values.material === 'stainless') checklist.push('Confirm stainless 303 on the drawing. A different stainless grade needs a new manufacturing review.');
    if (values.material === 'review') checklist.push('Specify the exact material grade before a price or production route can be agreed.');
    if (values.finish === 'anodised') checklist.push('Agree colour, visible faces and masking requirements with the externally coordinated anodising scope before machining.');
    if (values.finish === 'review') checklist.push('Define the finish and any appearance or mating requirements before the manufacturing route is accepted.');
    if (inspections.includes('critical')) checklist.push('Name the critical features and agree the sampling plan for the dimensional report.');
    if (inspections.includes('firstoff')) checklist.push('Agree the first-off review checkpoint and who would authorise the rest of the batch.');
    if (inspections.includes('material')) checklist.push('Request the exact supplier material documentation required and confirm its availability at quotation.');
    if (!inspections.length) checklist.push('Agree the inspection scope. No dimensional report or material certificate is implied by an unchecked option.');
    checklist.push('Confirm the requested delivery date, packaging and repeat-order pattern in a real quotation conversation.');
    document.querySelector('#fit-title').textContent = fitTitle;
    document.querySelector('#fit-description').textContent = fitDescription;
    const rows = [
      ['Starting point', label('part')],
      ['Process', label('process')],
      ['Material', label('material')],
      ['Batch quantity', quantity.toLocaleString('en-GB') + ' parts'],
      ['Finish', label('finish')],
      ['Drawing', label('drawingStatus') + (values.revision.trim() ? ' / ' + values.revision.trim() : '')],
      ['Inspection requests', inspections.length ? inspections.map(v => ({critical:'Critical-feature report',firstoff:'First-off review',material:'Material documentation'})[v]).join('; ') : 'To be agreed'],
    ];
    const details = document.querySelector('#review-details');
    details.replaceChildren();
    for (const [name, value] of rows) {
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = name;
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(heading, cell);
      details.append(row);
    }
    const list = document.querySelector('#review-checklist');
    list.replaceChildren();
    for (const item of checklist) {
      const li = document.createElement('li');
      li.textContent = item;
      list.append(li);
    }
    const note = document.querySelector('#review-notes');
    note.textContent = values.notes.trim() ? 'Assembly priority: ' + values.notes.trim() : '';
    note.hidden = !values.notes.trim();
    downloadText = [
      'NOLL DATUM / LOCAL DEMONSTRATION ENQUIRY',
      'Fictional company. Nothing has been sent. Not a quote or production acceptance.',
      '', fitTitle, fitDescription, '',
      ...rows.map(([name, value]) => name + ': ' + value), '',
      'QUESTIONS FOR REVIEW', ...checklist.map(item => '- ' + item),
      ...(values.notes.trim() ? ['', 'Assembly priority: ' + values.notes.trim()] : []),
      '', 'This page stores entries only while it is open. The downloaded file remains on your device.',
    ].join('\n');
    enquiryForm.hidden = true;
    review.hidden = false;
    status.textContent = '';
    review.focus();
    review.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
  });

  document.querySelector('#download-enquiry').addEventListener('click', () => {
    if (!downloadText) return;
    const blob = new Blob([downloadText], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'noll-datum-demo-enquiry.txt';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Your download has been prepared. Nothing was sent to Noll Datum.';
  });
}
