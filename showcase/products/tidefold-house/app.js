document.documentElement.classList.add('js');

const navToggle = document.querySelector('.nav-toggle');
const navigation = document.querySelector('#house-nav');
navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') !== 'true';
  navToggle.setAttribute('aria-expanded', String(open));
  navigation.dataset.open = String(open);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
    navToggle.setAttribute('aria-expanded', 'false');
    navigation.dataset.open = 'false';
    navToggle.focus();
  }
});

if (!location.pathname.startsWith('/showcase/products/')) {
  const returnLink = document.querySelector('.showcase-return');
  if (returnLink) returnLink.href = '/showcase/#work';
}

const form = document.querySelector('#stay-form');
if (form) {
  const rooms = JSON.parse(document.querySelector('#room-data').textContent);
  const arrival = form.elements.namedItem('arrival');
  const departure = form.elements.namedItem('departure');
  const guests = form.elements.namedItem('guests');
  const preference = form.elements.namedItem('room');
  const errorBox = document.querySelector('#planner-error');
  const results = document.querySelector('#room-results');
  const summary = document.querySelector('#stay-summary');
  const status = document.querySelector('#planner-status');
  const currency = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fields = [arrival, departure, guests, preference];
  let criteria = null;

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function dateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toISOString().slice(0, 10) === value ? date.getTime() : null;
  }

  function readCriteria(showErrors = true) {
    const errors = [];
    const start = dateValue(arrival.value);
    const end = dateValue(departure.value);
    const party = Number(guests.value);
    const selected = preference.value;
    const nights = start !== null && end !== null ? (end - start) / 86400000 : 0;
    if (start === null) errors.push([arrival, 'Choose your arrival date.']);
    else if (arrival.value < todayISO()) errors.push([arrival, 'Choose today or a future arrival date.']);
    if (end === null) errors.push([departure, 'Choose your departure date.']);
    else if (start !== null && nights < 1) errors.push([departure, 'Departure must be after arrival.']);
    else if (start !== null && nights > 14) errors.push([departure, 'This planner supports stays of 1–14 nights. Please shorten your stay.']);
    if (!Number.isInteger(party) || party < 1 || party > 6) errors.push([guests, 'Choose how many guests will stay, including children.']);
    if (selected !== 'any' && !rooms.some(room => room.id === selected)) errors.push([preference, 'Choose one of our three room categories.']);
    if (showErrors) {
      fields.forEach(field => field.removeAttribute('aria-invalid'));
      if (errors.length) {
        errors.forEach(([field]) => field.setAttribute('aria-invalid', 'true'));
        errorBox.textContent = errors.map(([,message]) => message).join(' ');
        errorBox.hidden = false;
        errors[0][0].focus();
      } else {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
    }
    return errors.length ? null : { arrival: arrival.value, departure: departure.value, start, end, nights, guests: party, preference: selected };
  }

  function moveTo(element) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  function clearOutput(message = '') {
    criteria = null;
    results.hidden = true;
    results.replaceChildren();
    summary.hidden = true;
    summary.replaceChildren();
    errorBox.hidden = true;
    errorBox.textContent = '';
    fields.forEach(field => field.removeAttribute('aria-invalid'));
    status.textContent = message;
  }

  function showChoices() {
    clearOutput();
    criteria = readCriteria();
    if (!criteria) return;
    const matches = rooms.filter(room => room.guests >= criteria.guests && (criteria.preference === 'any' || criteria.preference === room.id));
    const description = `${dayFormat.format(criteria.start)} – ${dayFormat.format(criteria.end)} · ${criteria.nights} ${criteria.nights === 1 ? 'night' : 'nights'} · ${criteria.guests} ${criteria.guests === 1 ? 'guest' : 'guests'}`;
    results.hidden = false;
    if (!matches.length) {
      const tooMany = criteria.guests > 4;
      results.innerHTML = `<div class="empty-result"><h2 id="results-title" tabindex="-1">No room fits this plan.</h2><p>${tooMany ? 'Our largest room sleeps four. A party of five or six would need more than one room; this demo plans one room at a time.' : 'Your preferred room sleeps up to two guests. The Family Loft can accommodate up to four.'}</p><button type="button" class="button outline" data-adjust="${tooMany ? 'guests' : 'room'}">${tooMany ? 'Change party size' : 'Show all room types'}</button></div>`;
      status.textContent = 'No compatible room. Your stay has not been reserved.';
    } else {
      results.innerHTML = `<h2 id="results-title" tabindex="-1">${matches.length === 1 ? 'A room for your stay.' : 'Your room choices.'}</h2><p class="result-context">${description}<br>Capacity matches only. Live availability is not checked.</p>${matches.map(room => `<article class="quote-card"><img src="assets/${room.image}-768.webp" width="768" height="512" alt="${room.name}" loading="lazy" decoding="async"><div><h3>${room.name}</h3><p>${room.area} m² · Up to ${room.guests} guests · ${room.level}</p><p>${criteria.nights} ${criteria.nights === 1 ? 'night' : 'nights'} × ${currency.format(room.rate)} · Breakfast included</p><div class="quote-bottom"><strong>${currency.format(room.rate * criteria.nights)} total</strong><button class="button" type="button" data-choose="${room.id}" aria-label="Choose this room: ${room.name}">Choose this room</button></div></div></article>`).join('')}`;
      status.textContent = `${matches.length} compatible room ${matches.length === 1 ? 'category' : 'categories'}. Choose a room to make a local stay summary.`;
    }
    moveTo(document.querySelector('#results-title'));
  }

  function makeSummary(id) {
    const current = readCriteria();
    const room = rooms.find(item => item.id === id);
    if (!current || !criteria || JSON.stringify(current) !== JSON.stringify(criteria) || !room || room.guests < current.guests || (current.preference !== 'any' && room.id !== current.preference)) {
      clearOutput('Your choices changed. Show room choices again before selecting a room.');
      return;
    }
    results.hidden = true;
    summary.hidden = false;
    summary.innerHTML = `${'<span class="eyebrow">Your illustrative stay</span>'}<h2 id="summary-title" tabindex="-1">A little time, set aside.</h2><p>Your plan is ready to review. This is a local summary, not a booking or a request sent to the hotel.</p><dl class="summary-facts"><div><dt>Room</dt><dd>${room.name}</dd></div><div><dt>Guests</dt><dd>${current.guests} ${current.guests === 1 ? 'guest' : 'guests'}</dd></div><div><dt>Arrival</dt><dd>${dayFormat.format(current.start)}<br>15:00–20:00</dd></div><div><dt>Departure</dt><dd>${dayFormat.format(current.end)}<br>By 11:00</dd></div></dl><table class="costs"><caption class="sr-only">Illustrative stay cost</caption><tbody><tr><th scope="row">${room.name}<br>${current.nights} ${current.nights === 1 ? 'night' : 'nights'} × ${currency.format(room.rate)}</th><td>${currency.format(current.nights * room.rate)}</td></tr><tr><th scope="row">Breakfast for ${current.guests}, each morning</th><td>Included · €0</td></tr><tr><th scope="row">Total illustration</th><td>${currency.format(current.nights * room.rate)}</td></tr></tbody></table><div class="form-actions"><button class="button light" type="button" data-edit>Change my stay</button><button class="plain-button" type="button" data-clear>Clear this plan</button></div><p class="summary-disclaimer">No live inventory, reservation, payment or email is connected. No personal information has been collected. This summary exists only in this page; a refresh clears it. Supper, transfers and other services are not included or reserved.</p>`;
    status.textContent = 'Your illustrative stay summary is ready. No booking or payment was made.';
    moveTo(document.querySelector('#summary-title'));
  }

  arrival.min = todayISO();
  departure.min = todayISO();
  const queryRoom = new URLSearchParams(location.search).get('room');
  if (rooms.some(room => room.id === queryRoom)) preference.value = queryRoom;

  form.addEventListener('submit', event => {
    event.preventDefault();
    showChoices();
  });
  form.addEventListener('input', () => {
    const hadOutput = !summary.hidden || !results.hidden;
    clearOutput(hadOutput ? 'Your choices changed. Show room choices again for an updated plan.' : '');
  });
  form.addEventListener('change', () => {
    const hadOutput = !summary.hidden || !results.hidden;
    clearOutput(hadOutput ? 'Your choices changed. Show room choices again for an updated plan.' : '');
  });
  form.addEventListener('reset', () => clearOutput('Planner cleared. No information has been saved.'));
  results.addEventListener('click', event => {
    const choose = event.target.closest('button[data-choose]');
    if (choose) makeSummary(choose.dataset.choose);
    const adjust = event.target.closest('button[data-adjust]');
    if (adjust?.dataset.adjust === 'room') {
      preference.value = 'any';
      showChoices();
    } else if (adjust?.dataset.adjust === 'guests') {
      clearOutput('Change your party size, then show room choices again.');
      guests.focus();
    }
  });
  summary.addEventListener('click', event => {
    if (event.target.closest('button[data-edit]')) {
      clearOutput('Change your dates, party size or room preference, then show room choices again.');
      moveTo(arrival);
    }
    if (event.target.closest('button[data-clear]')) {
      form.reset();
      moveTo(arrival);
    }
  });
}
