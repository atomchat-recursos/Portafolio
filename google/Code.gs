/* Google Apps Script V8. Enable the advanced Calendar API service before deploying. */
const TIME_ZONE = 'America/Lima';
const DURATION_MINUTES = 60;
const ACTIVITIES = ['Conversar y tomar café', 'Salir a comer', 'Ir al cine', 'Pasear al aire libre', 'Juegos de mesa', 'Otra'];
const FOODS = ['Hamburguesas', 'Pizzas', 'Sopas', 'Makis', 'Otra'];
const HEADERS = ['Solicitud', 'Huella', 'Estado', 'Registrado', 'Nombre', 'Correo', 'Inicio', 'Fin', 'Actividad', 'Lugar', 'Comida', 'Comentarios', 'Evento'];

// Run manually in the Apps Script editor as the Google account owner.
// This function is never invoked by the public HTTP endpoints.
function inicializarAgenda() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La configuración está en curso. Reintenta.');
  try {
    const props = PropertiesService.getScriptProperties();
    // Verify access to the principal calendar before creating resources.
    const primary = Calendar.Calendars.get('primary');
    let calendarId = props.getProperty('CALENDAR_ID');
    if (!calendarId) {
      const calendar = Calendar.Calendars.insert({ summary: 'Entre amigos · Encuentros', description: 'Reservas del agendador Entre amigos', timeZone: TIME_ZONE });
      calendarId = calendar.id;
      props.setProperty('CALENDAR_ID', calendarId);
    }
    let spreadsheetId = props.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) {
      const spreadsheet = SpreadsheetApp.create('Entre amigos · Registro de citas');
      spreadsheetId = spreadsheet.getId();
      props.setProperty('SPREADSHEET_ID', spreadsheetId);
    }
    // Preserve any calendars the owner previously configured.
    if (!props.getProperty('BUSY_CALENDAR_IDS')) {
      props.setProperty('BUSY_CALENDAR_IDS', JSON.stringify(Array.from(new Set([primary.id, calendarId]))));
    }
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
    const sheet = spreadsheet.getSheetByName('Citas') || spreadsheet.insertSheet('Citas');
    if (sheet.getLastRow() === 0) { sheet.appendRow(HEADERS); sheet.setFrozenRows(1); }
    SpreadsheetApp.flush();
    const resources = {
      calendarUrl: 'https://calendar.google.com/calendar/u/0/r',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit',
      calendarId: calendarId
    };
    console.log(JSON.stringify(resources));
    return resources;
  } finally { lock.releaseLock(); }
}

function settings() {
  const p = PropertiesService.getScriptProperties();
  const calendarId = p.getProperty('CALENDAR_ID');
  const spreadsheetId = p.getProperty('SPREADSHEET_ID');
  if (!calendarId || !spreadsheetId) throw new Error('La agenda aún no está configurada. Contacta a la persona organizadora.');
  const rawBusyIds = p.getProperty('BUSY_CALENDAR_IDS');
  const busyIds = rawBusyIds ? JSON.parse(rawBusyIds) : [calendarId];
  if (!Array.isArray(busyIds) || busyIds.some(function (id) { return typeof id !== 'string' || !id.trim(); })) throw new Error('Invalid BUSY_CALENDAR_IDS');
  return { calendarId: calendarId, spreadsheetId: spreadsheetId, busyCalendarIds: Array.from(new Set([calendarId].concat(busyIds))) };
}
function json(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function respond(fn) {
  try { return json(Object.assign({ ok: true }, fn())); }
  catch (error) {
    console.error(error.stack || error.message);
    return json({ ok: false, error: error.publicMessage || 'No se pudo completar la solicitud. Reintenta en unos momentos o contacta a la persona organizadora.' });
  }
}
function fail(message) { const error = new Error(message); error.publicMessage = message; throw error; }
function doGet(e) {
  return respond(function () {
    if (!e || e.parameter.action !== 'availability') fail('Solicitud no válida.');
    const config = settings();
    return { slots: availableSlots(e.parameter.date, config.calendarId, config.busyCalendarIds) };
  });
}
function doPost(e) {
  return respond(function () {
    if (!e || !e.postData || e.postData.contents.length > 12000) fail('Solicitud no válida.');
    let data;
    try { data = JSON.parse(e.postData.contents); } catch (_) { fail('Solicitud no válida.'); }
    if (!data || data.action !== 'book') fail('Solicitud no válida.');
    return book(data);
  });
}
function dateWindow(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Elige una fecha válida.');
  const noon = new Date(date + 'T12:00:00-05:00');
  if (!isFinite(noon.getTime()) || Utilities.formatDate(noon, TIME_ZONE, 'yyyy-MM-dd') !== date) fail('Elige una fecha válida.');
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  if (date < today || noon.getTime() > Date.now() + 366 * 86400000) fail('Elige una fecha desde hoy y dentro del próximo año.');
  const day = noon.getUTCDay();
  const open = day === 0 || day === 6 ? 10 : 17;
  return { start: new Date(date + 'T' + open + ':00:00-05:00'), end: new Date(date + 'T22:00:00-05:00') };
}
function availableSlots(date, calendarId, busyCalendarIds) {
  const window = dateWindow(date);
  const ids = Array.from(new Set([calendarId].concat(busyCalendarIds || [])));
  const response = Calendar.Freebusy.query({ timeMin: window.start.toISOString(), timeMax: window.end.toISOString(), timeZone: TIME_ZONE, items: ids.map(function (id) { return { id: id }; }) });
  let busy = [];
  ids.forEach(function (id) {
    const calendar = response.calendars && response.calendars[id];
    if (!calendar || (calendar.errors && calendar.errors.length)) throw new Error('Free/busy calendar unavailable');
    busy = busy.concat(calendar.busy || []);
  });
  const slots = [];
  for (let start = window.start.getTime(); start + DURATION_MINUTES * 60000 <= window.end.getTime(); start += 30 * 60000) {
    const end = start + DURATION_MINUTES * 60000;
    if (start <= Date.now()) continue;
    if (busy.some(function (period) { return new Date(period.start).getTime() < end && new Date(period.end).getTime() > start; })) continue;
    slots.push({ start: new Date(start).toISOString(), label: Utilities.formatDate(new Date(start), TIME_ZONE, 'h:mm a') });
  }
  return slots;
}
function text(value, label, max, optional) {
  if (typeof value !== 'string') { if (optional && value == null) return ''; fail('Revisa el campo ' + label + '.'); }
  const result = value.trim();
  if ((!result && !optional) || result.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(result)) fail('Revisa el campo ' + label + '.');
  return result;
}
function validated(data) {
  const requestId = text(data.requestId, 'solicitud', 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) fail('Identificador de solicitud inválido.');
  const name = text(data.name, 'nombre', 100);
  const email = text(data.email, 'correo', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Revisa tu correo electrónico.');
  if (!ACTIVITIES.includes(data.activity) || !FOODS.includes(data.food)) fail('Selecciona una actividad y una comida.');
  const activity = data.activity === 'Otra' ? text(data.customActivity, 'otra actividad', 200) : data.activity;
  const food = data.food === 'Otra' ? text(data.customFood, 'otra comida', 200) : data.food;
  const location = text(data.location, 'lugar', 300);
  const comments = text(data.comments, 'comentarios', 1500, true);
  dateWindow(data.date);
  if (typeof data.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(data.time)) fail('Selecciona un horario válido.');
  const start = new Date(data.time);
  if (!isFinite(start.getTime()) || Utilities.formatDate(start, TIME_ZONE, 'yyyy-MM-dd') !== data.date) fail('La fecha y la hora no coinciden.');
  const end = new Date(start.getTime() + DURATION_MINUTES * 60000);
  return { requestId: requestId, name: name, email: email, activity: activity, food: food, location: location, comments: comments, date: data.date, start: start.toISOString(), end: end.toISOString() };
}
function digest(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
// Prevent user text from becoming spreadsheet formulas.
function cell(value) { return /^[=+@\-\t\r]/.test(value) ? "'" + value : value; }
function resultFor(booking) {
  return { dateLabel: Utilities.formatDate(new Date(booking.start), TIME_ZONE, 'dd/MM/yyyy'), timeLabel: Utilities.formatDate(new Date(booking.start), TIME_ZONE, 'h:mm a'), location: booking.location };
}
function book(data) {
  const booking = validated(data);
  const config = settings();
  const fingerprint = digest(JSON.stringify(booking));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail('La agenda está ocupada. Inténtalo nuevamente.');
  try {
    const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Citas') || spreadsheet.insertSheet('Citas');
    if (sheet.getLastRow() === 0) { sheet.appendRow(HEADERS); sheet.setFrozenRows(1); }
    const rows = sheet.getDataRange().getValues();
    const found = rows.findIndex(function (row, index) { return index > 0 && row[0] === booking.requestId; });
    let rowNumber = found + 1;
    if (found >= 0) {
      if (rows[found][1] !== fingerprint) fail('Esta solicitud ya se usó con otros datos. Recarga la página para crear un plan nuevo.');
      if (rows[found][2] === 'CONFIRMADA') return resultFor(booking);
      // Recover a booking if Calendar succeeded but the sheet update failed.
      const existing = Calendar.Events.list(config.calendarId, { privateExtendedProperty: ['requestId=' + booking.requestId], maxResults: 2 }).items || [];
      if (existing.some(function (event) { return event.status !== 'cancelled'; })) {
        sheet.getRange(rowNumber, 3).setValue('CONFIRMADA');
        SpreadsheetApp.flush();
        return resultFor(booking);
      }
    }
    const slots = availableSlots(booking.date, config.calendarId, config.busyCalendarIds);
    if (!slots.some(function (slot) { return slot.start === booking.start; })) fail('Ese horario ya no está disponible. Consulta la fecha nuevamente y elige otro.');
    const eventId = 'ea' + digest(booking.requestId);
    if (!rowNumber) {
      sheet.appendRow([booking.requestId, fingerprint, 'PENDIENTE', new Date().toISOString(), cell(booking.name), cell(booking.email), booking.start, booking.end, cell(booking.activity), cell(booking.location), cell(booking.food), cell(booking.comments), eventId]);
      rowNumber = sheet.getLastRow();
      SpreadsheetApp.flush();
    }
    Calendar.Events.insert({
      id: eventId,
      summary: 'Entre amigos · ' + booking.name,
      location: booking.location,
      description: 'Actividad: ' + booking.activity + '\nComida: ' + booking.food + '\nContacto: ' + booking.email + '\nComentarios: ' + booking.comments,
      start: { dateTime: booking.start, timeZone: TIME_ZONE },
      end: { dateTime: booking.end, timeZone: TIME_ZONE },
      transparency: 'opaque', visibility: 'private',
      extendedProperties: { private: { requestId: booking.requestId } }
    }, config.calendarId);
    sheet.getRange(rowNumber, 3).setValue('CONFIRMADA');
    SpreadsheetApp.flush();
    return resultFor(booking);
  } finally { lock.releaseLock(); }
}
