/* Cross-site Apps Script transport: script loading for reads, iframe form for writes. */
'use strict';
window.AgendaTransport = (() => {
  const token = () => crypto.randomUUID().replaceAll('-', '');
  function availability(apiUrl, date) {
    return new Promise((resolve, reject) => {
      const callback = 'agenda_' + token();
      const script = document.createElement('script');
      const url = new URL(apiUrl);
      url.searchParams.set('action', 'availability');
      url.searchParams.set('date', date);
      url.searchParams.set('callback', callback);
      let timer;
      function cleanup() { clearTimeout(timer); script.remove(); delete window[callback]; }
      window[callback] = result => { cleanup(); resolve(result); };
      script.onerror = () => { cleanup(); reject(new Error('No pudimos conectar con la agenda. Inténtalo de nuevo.')); };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('La agenda no respondió. Inténtalo de nuevo o avisa a la persona organizadora.'));
      }, 30000);
      script.src = url.href;
      document.head.append(script);
    });
  }
  function book(apiUrl, data) {
    return new Promise((resolve, reject) => {
      const channel = token();
      const frame = document.createElement('iframe');
      frame.name = 'agenda_' + channel;
      frame.hidden = true;
      frame.title = 'Confirmación de la reserva';
      const form = document.createElement('form');
      form.hidden = true;
      form.method = 'POST';
      form.action = apiUrl;
      form.target = frame.name;
      for (const [name, value] of Object.entries({ payload: JSON.stringify({ ...data, action: 'book' }), channel })) {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value;
        form.append(input);
      }
      let timer;
      function cleanup() { clearTimeout(timer); window.removeEventListener('message', receive); form.remove(); frame.remove(); }
      function receive(event) {
        let origin;
        try { origin = new URL(event.origin); } catch (_) { return; }
        const google = origin.protocol === 'https:' && (origin.hostname === 'script.google.com' || origin.hostname.endsWith('.googleusercontent.com'));
        if (!google || event.data?.type !== 'agenda-result' || event.data.channel !== channel) return;
        cleanup(); resolve(event.data.result);
      }
      window.addEventListener('message', receive);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('No recibimos la confirmación. La reserva podría haberse creado; reintenta con los mismos datos para comprobarla sin duplicarla.'));
      }, 45000);
      document.body.append(frame, form);
      form.submit();
    });
  }
  return { availability, book };
})();
