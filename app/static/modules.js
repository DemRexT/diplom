/* Model code runs only in an opaque-origin iframe's dedicated Worker.
 * The Worker receives field values and drawing capabilities, never DOM/account data.
 */
(() => {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const tags = ['div','span','p','h3','h4','button','input','label','select','option','canvas','output','strong','small','br','fieldset','legend','section','ul','li'];
  const attrs = ['id','class','type','min','max','step','value','for','checked','selected','width','height','aria-label','title','placeholder','disabled'];

  // Serialized into the isolated document. No surrounding lexical scope is used.
  function workerRuntime(initial) {
    const send = self.postMessage.bind(self), handlers = new Map(), values = new Map(Object.entries(initial));
    const on = (kind, id, callback) => { if (typeof callback === 'function') handlers.set(kind + ':' + id, callback); };
    Object.defineProperty(self, 'playground', {value: Object.freeze({
      input: id => values.get(id) ?? '',
      onInput: (id, callback) => on('input', id, callback),
      onClick: (id, callback) => on('click', id, callback),
      onPointer: (id, callback) => on('pointer', id, callback),
      text: (id, value) => send({op: 'text', id, value: String(value).slice(0, 2000)}),
      value: (id, value) => { values.set(id, String(value)); send({op: 'value', id, value: String(value).slice(0, 200)}); },
      draw: (id, commands) => send({op: 'draw', id, commands}),
      complete: () => send({op: 'complete'}),
    }), writable: false, configurable: false});
    // CSP remains the network boundary; these also make unsupported APIs fail early.
    for (const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker']) {
      try { Object.defineProperty(self, name, {value: undefined, configurable: false, writable: false}); } catch (_) {}
    }
    self.addEventListener('message', event => {
      const {kind, id, value} = event.data || {};
      if (kind === 'input') values.set(id, value);
      const handler = handlers.get(kind + ':' + id);
      if (handler) handler(value);
    });
    setInterval(() => send({op: 'heartbeat'}), 500);
  }

  function frameRuntime(config) {
    const root = document.getElementById('playground-root');
    root.innerHTML = config.html; // Parent sanitized the fragment with a strict tag/attribute list.
    const style = document.createElement('style');
    style.textContent = config.css;
    document.head.append(style);
    const elements = new Map([...root.querySelectorAll('[id]')].map(element => [element.id, element]));
    const initial = Object.create(null);
    elements.forEach((element, id) => {
      if (['INPUT','SELECT'].includes(element.tagName)) initial[id] = element.type === 'checkbox' ? (element.checked ? '1' : '0') : element.value;
    });
    let active = true, lastHeartbeat = Date.now(), windowStart = Date.now(), messages = 0;
    const notify = (status, extra = {}) => parent.postMessage({type: 'study-module', token: config.token, status, ...extra}, '*');
    const sizing = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => notify('resize', {height: Math.ceil(root.getBoundingClientRect().height + 32)}));
    sizing?.observe(root);
    const url = URL.createObjectURL(new Blob([config.workerSource + '(' + JSON.stringify(initial).replace(/</g, '\\u003c') + ');\n' + config.javascript + '\nself.postMessage({op:"ready"});'], {type: 'text/javascript'}));
    let worker;
    const stop = failed => {
      if (!active) return;
      active = false;
      clearInterval(watchdog);
      worker?.terminate(); sizing?.disconnect(); URL.revokeObjectURL(url);
      notify(failed ? 'error' : 'stopped');
    };
    let watchdog;
    const finite = (value, limit = 2000) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
    const color = value => typeof value === 'string' && value.length <= 40 ? value : '#638653';
    function draw(canvas, commands) {
      if (canvas.tagName !== 'CANVAS' || !Array.isArray(commands) || commands.length > 300) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const item of commands) {
        if (!item || typeof item !== 'object') continue;
        ctx.fillStyle = ctx.strokeStyle = color(item.color);
        ctx.lineWidth = finite(item.width, 10) && item.width > 0 ? item.width : 2;
        ctx.beginPath();
        if (item.type === 'line' && [item.x1,item.y1,item.x2,item.y2].every(value => finite(value))) {
          ctx.moveTo(item.x1,item.y1); ctx.lineTo(item.x2,item.y2); ctx.stroke();
        } else if (item.type === 'rect' && [item.x,item.y,item.w,item.h].every(value => finite(value))) {
          ctx.fillRect(item.x,item.y,item.w,item.h);
        } else if (item.type === 'circle' && [item.x,item.y,item.r].every(value => finite(value)) && item.r >= 0 && item.r <= 1000) {
          ctx.arc(item.x,item.y,item.r,0,Math.PI*2); ctx.fill();
        } else if (item.type === 'text' && finite(item.x) && finite(item.y) && typeof item.text === 'string') {
          ctx.font = `${finite(item.size,40) && item.size > 0 ? item.size : 16}px Arial`;
          ctx.fillText(item.text.slice(0,200),item.x,item.y);
        } else if (item.type === 'polyline' && Array.isArray(item.points) && item.points.length <= 500) {
          const points = item.points.filter(p => Array.isArray(p) && p.length === 2 && p.every(value => finite(value)));
          points.forEach((point,index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point)); ctx.stroke();
        }
      }
    }
    try {
      worker = new Worker(url);
      worker.addEventListener('error', event => { event.preventDefault(); stop(true); });
      worker.addEventListener('messageerror', () => stop(true));
      worker.addEventListener('message', event => {
        if (!active) return;
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messages = 0; }
        if (++messages > 500) { stop(true); return; }
        const item = event.data;
        if (!item || typeof item !== 'object') return;
        if (item.op === 'heartbeat') { lastHeartbeat = Date.now(); return; }
        if (item.op === 'ready') { lastHeartbeat = Date.now(); notify('ready'); return; }
        if (item.op === 'complete') { notify('complete'); return; }
        const element = typeof item.id === 'string' && elements.get(item.id);
        if (!element) return;
        if (item.op === 'text' && typeof item.value === 'string') element.textContent = item.value.slice(0,2000);
        else if (item.op === 'value' && ['INPUT','SELECT'].includes(element.tagName) && typeof item.value === 'string') {
          if (element.type === 'checkbox') element.checked = item.value === '1'; else element.value = item.value.slice(0,200);
        } else if (item.op === 'draw') draw(element, item.commands);
      });
      watchdog = setInterval(() => { if (Date.now() - lastHeartbeat > 4000) stop(true); }, 500);
      const send = (kind, id, value) => { if (active) worker.postMessage({kind, id, value}); };
      elements.forEach((element,id) => {
        if (['INPUT','SELECT'].includes(element.tagName)) element.addEventListener('input', () => send('input', id, element.type === 'checkbox' ? (element.checked ? '1' : '0') : element.value.slice(0,200)));
        if (element.tagName === 'BUTTON') element.addEventListener('click', () => send('click', id, null));
        if (element.tagName === 'CANVAS') {
          let pressed = false;
          const pointer = event => {
            const rect = element.getBoundingClientRect();
            if (event.type === 'pointerdown') { pressed = true; element.setPointerCapture(event.pointerId); }
            if (event.type === 'pointerup' || event.type === 'pointercancel') pressed = false;
            send('pointer',id,{x: Math.max(0,Math.min(element.width,(event.clientX-rect.left)/Math.max(1,rect.width)*element.width)),y: Math.max(0,Math.min(element.height,(event.clientY-rect.top)/Math.max(1,rect.height)*element.height)),pressed,kind: event.type==='pointerdown'?'down':event.type==='pointermove'?'move':'up'});
          };
          ['pointerdown','pointermove','pointerup','pointercancel'].forEach(name => element.addEventListener(name,pointer));
        }
      });
      window.addEventListener('pagehide', () => stop(false), {once: true});
    } catch (_) { stop(true); }
  }

  function create(data, complete) {
    const root = node('section', undefined, 'study-module');
    root.append(node('p','Мини-игра · создана ИИ','lab-badge'), node('h3',data.title), node('p',data.explanation), node('p',data.task));
    const buttons = node('div', undefined, 'lab-toolbar'), start = node('button','Открыть мини-игру'), stop = node('button','Остановить'), status = node('p','Нажми «Открыть мини-игру», чтобы начать.');
    start.type = stop.type = 'button'; stop.hidden = true; status.setAttribute('role','status');
    const host = node('div', undefined, 'module-host');
    let frame, timer, observer, token, ready = false;
    const cleanup = () => {
      clearTimeout(timer); window.removeEventListener('message', receive); observer?.disconnect();
      frame?.remove(); frame = null; stop.hidden = true;
    };
    const failed = () => {
      cleanup(); status.textContent = 'Эту мини-игру не удалось запустить. Продолжай изучать теорию или другие задания.';
      start.textContent = 'Попробовать снова';
    };
    const receive = event => {
      if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'study-module' || event.data.token !== token) return;
      if (event.data.status === 'resize' && Number.isFinite(event.data.height)) frame.style.height = Math.max(300,Math.min(900,event.data.height)) + 'px';
      if (event.data.status === 'error') { failed(); return; }
      if (event.data.status === 'ready') { ready = true; clearTimeout(timer); status.textContent = 'Мини-игра готова. Попробуй выполнить задание!'; }
      if (event.data.status === 'complete' && ready) { complete(); root.classList.add('activity-complete'); status.textContent = 'Миссия выполнена! ✨'; }
    };
    start.onclick = () => {
      cleanup(); ready = false;
      if (!window.DOMPurify || typeof Worker === 'undefined') { failed(); return; }
      // Preserve logical ids such as "reset" for the capability bridge. The fragment
      // is never attached to the parent DOM; forms/name attributes are forbidden.
      const html = window.DOMPurify.sanitize(data.html, {ALLOWED_TAGS: tags, ALLOWED_ATTR: attrs, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, SANITIZE_DOM: false});
      const template = document.createElement('template'); template.innerHTML = html;
      template.content.querySelectorAll('input').forEach(input => { if (!['range','number','checkbox','text'].includes(input.type)) input.type='number'; input.maxLength=120; });
      template.content.querySelectorAll('canvas').forEach(canvas => { canvas.width=Math.min(900,Math.max(240,Number(canvas.width)||600)); canvas.height=Math.min(600,Math.max(160,Number(canvas.height)||360)); });
      const wrapper = document.createElement('div'); wrapper.append(template.content);
      token = [...crypto.getRandomValues(new Uint8Array(20))].map(value => value.toString(16).padStart(2,'0')).join('');
      const nonce = [...crypto.getRandomValues(new Uint8Array(20))].map(value => value.toString(16).padStart(2,'0')).join('');
      const config = {html: wrapper.innerHTML, css: data.css || '', javascript: data.javascript, token, workerSource: '(' + workerRuntime.toString() + ')'};
      const encoded = JSON.stringify(config).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
      const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
      frame = node('iframe'); frame.title=data.title; frame.setAttribute('sandbox','allow-scripts'); frame.referrerPolicy='no-referrer';
      frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'");
      frame.srcdoc = `<!doctype html><html lang="ru"><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px;font:16px/1.5 Arial,sans-serif;color:#243831;background:#fff}*{box-sizing:border-box}canvas{display:block;width:100%;height:auto;touch-action:none}input,select,button{font:inherit;max-width:100%}button{padding:8px 14px;cursor:pointer}input[type=range]{width:100%;accent-color:#638653}label{display:block;margin:12px 0}</style></head><body><main id="playground-root"></main><script nonce="${nonce}">(${frameRuntime.toString()})(${encoded});<\/script></body></html>`;
      window.addEventListener('message', receive);
      host.append(frame); stop.hidden=false; status.textContent='Запускаем мини-игру…'; start.textContent='Начать заново';
      timer=setTimeout(failed,7000);
      observer=new MutationObserver(() => { if (!root.isConnected) cleanup(); });
      observer.observe(document.body,{childList:true,subtree:true});
    };
    stop.onclick = () => { cleanup(); status.textContent='Мини-игра остановлена.'; start.textContent='Открыть мини-игру'; };
    buttons.append(start,stop); root.append(buttons,status,host);
    return root;
  }
  window.StudyModules = {create};
})();
