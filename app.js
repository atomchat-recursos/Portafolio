'use strict';
const config = window.AGENDA_CONFIG || {};
const form = document.querySelector('#booking-form');
const dateInput = document.querySelector('#date');
const timeInput = document.querySelector('#time');
const submit = document.querySelector('#submit');
const availability = document.querySelector('#availability-status');
const status = document.querySelector('#form-status');
let requestVersion = 0;
let requestId = crypto.randomUUID();
let submitting = false;
const limaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
dateInput.min = limaToday();
const connected = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.apiUrl || '');
document.querySelector('#setup-notice').hidden = connected;
function resetTimes(message) {
  timeInput.replaceChildren(new Option(message, ''));
  timeInput.disabled = true;
  submit.disabled = true;
}
async function api(action, data) {
  const url = new URL(config.apiUrl);
  let options = { redirect: 'follow' };
  if (action === 'availability') {
    url.searchParams.set('action', action);
    url.searchParams.set('date', data.date);
  } else {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    options.body = JSON.stringify({ ...data, action });
  }
  // Do not abort a booking: a request may still complete at Google after a timeout.
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('No pudimos comunicarnos con la agenda. Inténtalo de nuevo.');
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
  return result;
}
async function loadTimes() {
  const version = ++requestVersion;
  resetTimes('Consultando horarios…');
  if (!connected) { resetTimes('Pendiente de conexión con Google'); return; }
  if (!dateInput.value) { resetTimes('Elige primero una fecha'); return; }
  availability.textContent = 'Consultando la disponibilidad real del calendario…';
  try {
    const result = await api('availability', { date: dateInput.value });
    if (version !== requestVersion) return;
    resetTimes(result.slots.length ? 'Selecciona un horario' : 'No hay horarios disponibles');
    result.slots.forEach(slot => timeInput.add(new Option(slot.label, slot.start)));
    timeInput.disabled = !result.slots.length;
    availability.textContent = result.slots.length ? 'Horarios de Lima. Cada encuentro dura 1 hora.' : 'Prueba otra fecha para encontrar un momento libre.';
  } catch (error) {
    if (version !== requestVersion) return;
    resetTimes('No se pudo consultar');
    availability.textContent = error.message + ' Cambia la fecha para reintentar.';
  }
}
dateInput.addEventListener('change', loadTimes);
timeInput.addEventListener('change', () => { submit.disabled = !timeInput.value || submitting; });
for (const name of ['activity', 'food']) {
  form.querySelectorAll(`[name="${name}"]`).forEach(input => input.addEventListener('change', () => {
    const custom = form.elements[name].value === 'Otra';
    document.querySelector(`#custom-${name}-label`).hidden = !custom;
    form.elements[name === 'activity' ? 'customActivity' : 'customFood'].required = custom;
  }));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !connected || !form.reportValidity() || !timeInput.value) return;
  submitting = true;
  submit.disabled = true;
  status.textContent = 'Reservando tu encuentro…';
  const data = Object.fromEntries(new FormData(form));
  const originalDisabled = [...form.elements].map(element => [element, element.disabled]);
  originalDisabled.forEach(([element]) => { element.disabled = true; });
  try {
    const result = await api('book', { ...data, requestId });
    document.querySelector('#success-details').textContent = `${result.dateLabel} · ${result.timeLabel} · ${result.location}`;
    form.hidden = true;
    const success = document.querySelector('#success');
    success.hidden = false;
    success.focus();
  } catch (error) {
    status.textContent = error.message + ' Puedes reintentar con los mismos datos; la solicitud no se duplicará.';
  } finally {
    originalDisabled.forEach(([element, disabled]) => { element.disabled = disabled; });
    submitting = false;
    submit.disabled = !timeInput.value;
  }
});
document.querySelector('#another').addEventListener('click', () => {
  form.reset();
  form.hidden = false;
  document.querySelector('#success').hidden = true;
  document.querySelector('#custom-activity-label').hidden = true;
  document.querySelector('#custom-food-label').hidden = true;
  form.elements.customActivity.required = false;
  form.elements.customFood.required = false;
  requestId = crypto.randomUUID();
  status.textContent = '';
  dateInput.min = limaToday();
  resetTimes('Elige primero una fecha');
  form.elements.name.focus();
});
if (!connected) resetTimes('Pendiente de conexión con Google');
