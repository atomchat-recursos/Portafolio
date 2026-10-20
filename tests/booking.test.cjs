const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('google/Code.gs', 'utf8');
const NOW = Date.parse('2026-10-20T20:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
function setup() {
  const rows = [];
  const events = [];
  let busy = [];
  let releaseCount = 0;
  let lockAvailable = true;
  let failConfirmation = false;
  let freebusyError = false;
  let insertError = false;
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: row => rows.push([...row]),
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.map(row => [...row]) }),
    getRange: (row, column) => ({ setValue(value) {
      if (failConfirmation) { failConfirmation = false; throw new Error('Transient sheet outage'); }
      rows[row - 1][column - 1] = value;
    } })
  };
  const context = vm.createContext({
    Date: Clock, console: { error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => ({ CALENDAR_ID: 'calendar', SPREADSHEET_ID: 'sheet' })[name] }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: content => ({ setMimeType: () => JSON.parse(content) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()],
      formatDate(date, zone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date).map(p => [p.type, p.value]));
        if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
        if (pattern === 'dd/MM/yyyy') return `${parts.day}/${parts.month}/${parts.year}`;
        return `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock: () => { releaseCount++; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }), flush() {} },
    Calendar: {
      Freebusy: { query: () => ({ calendars: { calendar: freebusyError ? { errors: [{ reason: 'notFound' }] } : { busy: [...busy, ...events.map(e => ({ start: e.start.dateTime, end: e.end.dateTime }))] } } }) },
      Events: {
        list: (_, options) => ({ items: events.filter(e => 'requestId=' + e.extendedProperties.private.requestId === options.privateExtendedProperty[0]) }),
        insert(event) {
          if (insertError) throw new Error('Calendar unavailable');
          if (events.some(e => e.id === event.id)) throw new Error('Duplicate');
          events.push(event); return event;
        }
      }
    }
  });
  vm.runInContext(source, context);
  return { context, rows, events, setBusy: value => { busy = value; }, setLock: value => { lockAvailable = value; }, failConfirmation: () => { failConfirmation = true; }, failInsert: value => { insertError = value; }, failFreebusy: () => { freebusyError = true; }, releases: () => releaseCount };
}
function data(overrides = {}) {
  return { action: 'book', requestId: 'cd8f3ce0-524f-4ccf-a3b1-123456789abc', name: 'Ana', email: 'ana@example.com', date: '2026-10-21', time: '2026-10-21T22:00:00.000Z', activity: 'Ir al cine', food: 'Makis', location: 'Miraflores, Lima', comments: '', ...overrides };
}
function slots(context, date) { return context.availableSlots(date, 'calendar'); }
function post(context, value) { return context.doPost({ postData: { contents: JSON.stringify(value) } }); }

test('weekday starts at 17:00, ends by 22:00, has nine half-hour starts', () => {
  const { context } = setup();
  const result = slots(context, '2026-10-21');
  assert.equal(result.length, 9);
  assert.equal(result[0].start, '2026-10-21T22:00:00.000Z');
  assert.equal(result.at(-1).start, '2026-10-22T02:00:00.000Z');
});
for (const date of ['2026-10-24', '2026-10-25']) test(`weekend ${date} starts at 10:00 and ends by 22:00`, () => {
  const { context } = setup();
  const result = slots(context, date);
  assert.equal(result.length, 23);
  assert.equal(result[0].start, date + 'T15:00:00.000Z');
  assert.match(result.at(-1).start, /T02:00:00.000Z$/);
});
test('busy intervals exclude every overlapping slot but allow adjacent slots', () => {
  const app = setup();
  app.setBusy([{ start: '2026-10-21T23:00:00Z', end: '2026-10-22T00:00:00Z' }]);
  const starts = slots(app.context, '2026-10-21').map(s => s.start);
  assert.ok(starts.includes('2026-10-21T22:00:00.000Z'));
  assert.ok(!starts.includes('2026-10-21T22:30:00.000Z'));
  assert.ok(!starts.includes('2026-10-21T23:30:00.000Z'));
  assert.ok(starts.includes('2026-10-22T00:00:00.000Z'));
});
test('all-day busy calendar has no slots', () => {
  const app = setup();
  app.setBusy([{ start: '2026-10-21T05:00:00Z', end: '2026-10-22T05:00:00Z' }]);
  assert.equal(slots(app.context, '2026-10-21').length, 0);
});
test('invalid, past, and out-of-range dates fail', () => {
  const { context } = setup();
  for (const date of ['2026-02-30', '2026-10-19', '2028-10-20', '2026-13-01', 'bad']) assert.throws(() => slots(context, date));
});
test('past times are filtered on the current date', () => {
  const { context } = setup();
  vm.runInContext("Date.now = () => new Date('2026-10-20T23:15:00Z').getTime()", context);
  assert.equal(slots(context, '2026-10-20')[0].start, '2026-10-20T23:30:00.000Z');
});
test('freebusy errors fail closed and do not expose internal errors', () => {
  const app = setup(); app.failFreebusy();
  const response = app.context.doGet({ parameter: { action: 'availability', date: '2026-10-21' } });
  assert.equal(response.ok, false);
  assert.ok(!response.error.includes('notFound'));
});
test('reservation creates a private calendar event and a confirmed sheet row', () => {
  const app = setup();
  const result = post(app.context, data());
  assert.equal(result.ok, true);
  assert.equal(result.dateLabel, '21/10/2026');
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].start.dateTime, '2026-10-21T22:00:00.000Z');
  assert.equal(app.events[0].end.dateTime, '2026-10-21T23:00:00.000Z');
  assert.equal(app.events[0].visibility, 'private');
  assert.equal(app.rows[1][2], 'CONFIRMADA');
  assert.equal(app.releases(), 1);
});
test('retries are idempotent and changed payloads are rejected', () => {
  const app = setup();
  assert.equal(post(app.context, data()).ok, true);
  assert.equal(post(app.context, data()).ok, true);
  assert.equal(post(app.context, data({ location: 'Otro lugar' })).ok, false);
  assert.equal(app.events.length, 1);
  assert.equal(app.rows.length, 2);
});
test('a second booking cannot take an occupied slot', () => {
  const app = setup(); post(app.context, data());
  const response = post(app.context, data({ requestId: 'cd8f3ce0-524f-4ccf-a3b1-123456789abd' }));
  assert.equal(response.ok, false);
  assert.match(response.error, /ya no está disponible/);
  assert.equal(app.events.length, 1);
});
test('a successful calendar write recovers after a failed sheet confirmation', () => {
  const app = setup(); app.failConfirmation();
  assert.equal(post(app.context, data()).ok, false);
  assert.equal(app.rows[1][2], 'PENDIENTE');
  assert.equal(app.events.length, 1);
  assert.equal(post(app.context, data()).ok, true);
  assert.equal(app.events.length, 1);
  assert.equal(app.rows[1][2], 'CONFIRMADA');
});
test('failed calendar insert leaves a recoverable pending row', () => {
  const app = setup(); app.failInsert(true);
  assert.equal(post(app.context, data()).ok, false);
  assert.equal(app.rows[1][2], 'PENDIENTE');
  app.failInsert(false);
  assert.equal(post(app.context, data()).ok, true);
  assert.equal(app.rows.length, 2);
  assert.equal(app.events.length, 1);
});
test('lock refusal creates no event or row', () => {
  const app = setup(); app.setLock(false);
  assert.equal(post(app.context, data()).ok, false);
  assert.equal(app.events.length, 0);
  assert.equal(app.rows.length, 0);
});
test('server rejects forged slots and invalid form data', () => {
  for (const overrides of [
    { time: '2026-10-21T21:00:00.000Z' },
    { time: '2026-10-22T02:30:00.000Z' },
    { time: '2026-10-21T22:15:00.000Z' },
    { date: '2026-10-22' }, { email: 'bad' }, { name: '' },
    { activity: 'invalid' }, { food: 'invalid' },
    { activity: 'Otra', customActivity: '' }, { food: 'Otra', customFood: '' },
    { comments: 'a'.repeat(1501) }, { requestId: 'bad' }
  ]) {
    const app = setup();
    assert.equal(post(app.context, data(overrides)).ok, false, JSON.stringify(overrides));
    assert.equal(app.events.length, 0);
  }
});
test('custom options are saved and spreadsheet formulas are escaped', () => {
  const app = setup();
  assert.equal(post(app.context, data({ name: '=1+1', activity: 'Otra', customActivity: 'Visitar museo', food: 'Otra', customFood: 'Ensalada', comments: '@SUM(A1)' })).ok, true);
  assert.equal(app.rows[1][4], "'=1+1");
  assert.equal(app.rows[1][8], 'Visitar museo');
  assert.equal(app.rows[1][10], 'Ensalada');
  assert.equal(app.rows[1][11], "'@SUM(A1)");
});
test('invalid API requests are rejected', () => {
  const { context } = setup();
  assert.equal(context.doGet({ parameter: { action: 'private-data' } }).ok, false);
  assert.equal(context.doPost({ postData: { contents: '{bad' } }).ok, false);
  assert.equal(post(context, { action: 'delete' }).ok, false);
});
