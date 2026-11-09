/* Render model-provided study formatting without allowing model-provided HTML. */
(() => {
  const diagrams = new WeakMap();
  let counter = 0;
  let queue = Promise.resolve();
  let initialized = false;
  const T = (key, vars) => (window.StudyI18n ? window.StudyI18n.t(key, vars) : key);
  const element = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };

  function math(root) {
    if (!root || !window.renderMathInElement) return;
    window.renderMathInElement(root, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '\\[', right: '\\]', display: true},
        {left: '\\(', right: '\\)', display: false},
        {left: '$', right: '$', display: false},
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'svg'],
      ignoredClasses: ['katex', 'no-math'],
      throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 10,
      errorColor: '#9b4939',
    });
  }

  function safeDiagram(source) {
    return source.length <= 12000
      && /^(?:flowchart\b|graph\b|sequenceDiagram\b|mindmap\b|pie\b|timeline\b)/.test(source.trim())
      && !/%%\{|^\s*(?:click|style|classDef|linkStyle)\b|^---|<\s*\/?[A-Za-z!]|(?:https?:|javascript:|data:)|url\s*\(/im.test(source);
  }

  function diagramFigure(source) {
    const figure = element('figure', undefined, 'study-diagram no-math');
    figure.append(element('figcaption', figure.dataset.caption || T('diagramCaption')), element('p', T('diagramBuilding'), 'diagram-status'));
    if (!safeDiagram(source)) {
      figure.querySelector('.diagram-status').textContent = T('diagramUnsafe');
      return figure;
    }
    diagrams.set(figure, {source, pending: true, queued: false});
    figure.dataset.diagram = 'pending';
    return figure;
  }

  function enhance(root) {
    math(root);
    root.querySelectorAll('[data-diagram="pending"]').forEach(figure => {
      const state = diagrams.get(figure);
      if (!state || state.queued || !state.pending) return;
      state.queued = true;
      queue = queue.then(async () => {
        state.queued = false;
        if (!figure.isConnected || !state.pending || !figure.getClientRects().length) return;
        if (!window.mermaid || !window.DOMPurify) {
          figure.querySelector('.diagram-status').textContent = T('diagramLoadFail');
          return;
        }
        state.pending = false;
        const scratch = element('div', undefined, 'diagram-scratch');
        figure.append(scratch);
        try {
          if (!initialized) {
            window.mermaid.initialize({
              startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
              maxTextSize: 12000, maxEdges: 80, suppressErrorRendering: true,
              fontFamily: 'Arial, sans-serif', theme: 'base', look: 'classic',
              themeVariables: {primaryColor: '#e5eedc', primaryTextColor: '#243831', primaryBorderColor: '#78966b', lineColor: '#638653', secondaryColor: '#e9eff6', tertiaryColor: '#f9efdd', fontSize: '15px', fontFamily: 'Arial, sans-serif'},
              flowchart: {htmlLabels: false, useMaxWidth: true, wrappingWidth: 260, padding: 20},
            });
            initialized = true;
          }
          const id = `study-diagram-${++counter}`;
          const {svg} = await window.mermaid.render(id, state.source, scratch);
          if (!figure.isConnected) return;
          const clean = window.DOMPurify.sanitize(svg, {
            USE_PROFILES: {svg: true, svgFilters: true},
            FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'iframe', 'object', 'embed'],
            FORBID_ATTR: ['onload', 'onclick', 'onerror'],
          });
          const template = document.createElement('template');
          template.innerHTML = clean; // Only DOMPurify's sanitized SVG is inserted as markup.
          const rendered = template.content.querySelector('svg');
          if (!rendered) throw new Error('No SVG');
          rendered.querySelectorAll('*').forEach(node => {
            for (const attribute of ['href', 'xlink:href']) {
              if (node.hasAttribute(attribute) && !node.getAttribute(attribute).startsWith('#')) node.removeAttribute(attribute);
            }
          });
          rendered.querySelectorAll('style').forEach(style => {
            if (/@import/i.test(style.textContent) || [...style.textContent.matchAll(/url\(\s*['"]?([^)'"\s]+)/gi)].some(match => !match[1].startsWith('#'))) style.remove();
          });
          const viewBox = (rendered.getAttribute('viewBox') || '').split(/\s+/).map(Number);
          if (Number.isFinite(viewBox[2]) && viewBox[2] > 0) {
            // Fitted to the page: as wide as the text (never wider than drawn) and at most 3/4 of the screen tall.
            rendered.removeAttribute('width'); rendered.removeAttribute('height');
            rendered.style.width = '100%';
            rendered.style.maxWidth = `${Math.min(Math.ceil(viewBox[2]), 12000)}px`;
            rendered.style.height = 'auto';
            rendered.style.maxHeight = '75vh';
            if (viewBox[3] > 0) rendered.style.aspectRatio = `${viewBox[2]} / ${viewBox[3]}`;
          }
          rendered.setAttribute('role', 'img');
          rendered.setAttribute('aria-label', T('diagramAria'));
          const viewport = element('div', undefined, 'diagram-viewport');
          viewport.tabIndex = 0; viewport.setAttribute('aria-label', T('diagramScroll'));
          viewport.append(rendered);
          viewport.onclick = () => lightbox(() => {
            const copy = rendered.cloneNode(true);
            copy.removeAttribute('id');
            copy.style.maxWidth = 'none'; copy.style.maxHeight = 'none';
            copy.style.width = `${Math.ceil(viewBox[2] || 800)}px`;
            return copy;
          });
          viewport.onkeydown = event => { if (event.key === 'Enter') viewport.onclick(); };
          figure.replaceChildren(element('figcaption', figure.dataset.caption || T('diagramCaption')), viewport, element('p', T('diagramHint'), 'diagram-hint'));
          figure.dataset.diagram = 'ready';
        } catch (_) {
          if (figure.isConnected) {
            figure.replaceChildren(element('figcaption', figure.dataset.caption || T('diagramCaption')), element('p', T('diagramFail')));
            figure.dataset.diagram = 'error';
          }
        } finally { scratch.remove(); }
      }).catch(() => {});
    });
  }

  let markdownParser = null;
  let formatCounter = 0;

  function normalizePresentation(text) {
    let value = String(text).replace(/\r\n?/g, '\n');
    // Some models unnecessarily wrap the entire document in a Markdown code fence.
    const wrapped = value.trim().match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
    if (wrapped) value = wrapped[1];
    if (!value.includes('\n') && /\\n\s*(?:#{1,6}\s|\|)/.test(value)) {
      value = value.replace(/\\n(?![A-Za-z])/g, '\n');
    }
    return value;
  }

  function shieldMath(text, env) {
    const prefix = `study-math-${++formatCounter}-`;
    const delimiters = [
      {open: String.raw`\\[`, close: String.raw`\\]`, display: true, escaped: true},
      {open: String.raw`\\(`, close: String.raw`\\)`, display: false, escaped: true},
      {open: '$$', close: '$$', display: true},
      {open: String.raw`\[`, close: String.raw`\]`, display: true},
      {open: String.raw`\(`, close: String.raw`\)`, display: false},
      {open: '$', close: '$', display: false},
    ];
    const isEscaped = (source, position) => {
      let slashes = 0;
      for (let i = position - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
      return slashes % 2 === 1;
    };
    function protect(source) {
      let result = '';
      for (let index = 0; index < source.length;) {
        if (source[index] === '`') {
          const run = source.slice(index).match(/^`+/)[0];
          const end = source.indexOf(run, index + run.length);
          if (end !== -1) { result += source.slice(index, end + run.length); index = end + run.length; continue; }
        }
        const delimiter = delimiters.find(item => source.startsWith(item.open, index)
          && !(item.open.startsWith('$') && isEscaped(source, index)));
        if (!delimiter) { result += source[index++]; continue; }
        const start = index + delimiter.open.length;
        let end = source.indexOf(delimiter.close, start);
        while (end !== -1 && delimiter.close.startsWith('$') && isEscaped(source, end)) end = source.indexOf(delimiter.close, end + delimiter.close.length);
        if (end === -1) { result += source[index++]; continue; }
        let formula = source.slice(start, end);
        if (delimiter.escaped) formula = formula.replace(/\\\\(?=[A-Za-z{}])/g, '\\');
        const key = prefix + env.formulas.size;
        env.formulas.set(key, {formula, display: delimiter.display});
        const placeholder = '`' + key + '`';
        result += delimiter.display ? '\n\n' + placeholder + '\n\n' : placeholder;
        index = end + delimiter.close.length;
      }
      return result;
    }
    // Leave code and Mermaid fences intact; LaTeX is only interpreted in prose.
    const lines = text.split('\n');
    let result = '', prose = [], fence = null;
    const flush = () => { if (prose.length) result += protect(prose.join('\n')) + '\n'; prose = []; };
    for (const line of lines) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (!fence && marker) { flush(); fence = marker[1]; result += line + '\n'; }
      else if (fence) {
        result += line + '\n';
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      } else prose.push(line);
    }
    flush();
    return result;
  }

  function renderFormula(container, entry) {
    if (!window.katex) { container.textContent = entry.formula; return; }
    const options = {
      displayMode: entry.display, throwOnError: true, trust: false,
      strict: 'ignore', maxExpand: 500, maxSize: 10, output: 'htmlAndMathml',
    };
    try {
      window.katex.render(entry.formula, container, options);
    } catch (error) {
      // A prime is already a superscript in TeX. Group the primed symbol before
      // a lower/upper index pair; this preserves the symbol and both indices.
      const grouped = entry.formula.replace(/(\\[A-Za-z]+|[A-Za-z])(['′]+)(?=_)/g,
        (_, base, primes) => '{' + base + primes.replace(/′/g, "'") + '}');
      if (grouped !== entry.formula) {
        try {
          window.katex.render(grouped, container, options);
          container.title = T('mathFixed');
          return;
        } catch (_) { /* Keep the original visible on demand, never guess its meaning. */ }
      }
      container.replaceChildren();
      container.classList.add('study-math-error', 'no-math');
      container.append(element('span', T('mathError')));
      const toggle = element('button', T('mathShow'));
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      const original = element('code', entry.formula); original.hidden = true;
      toggle.onclick = () => {
        original.hidden = !original.hidden;
        toggle.setAttribute('aria-expanded', String(!original.hidden));
        toggle.textContent = original.hidden ? T('mathShow') : T('mathHide');
      };
      container.append(toggle, original);
    }
  }

  function parser() {
    if (markdownParser) return markdownParser;
    if (!window.markdownit) return null;
    markdownParser = window.markdownit({html: false, linkify: false, typographer: false, breaks: true});
    markdownParser.disable(['image', 'link', 'autolink']);
    const code = markdownParser.renderer.rules.code_inline;
    const fence = markdownParser.renderer.rules.fence;
    markdownParser.renderer.rules.code_inline = (tokens, index, options, env, self) => {
      const formula = env.formulas.get(tokens[index].content);
      return formula ? `<span data-study-math="${tokens[index].content}"></span>` : code(tokens, index, options, env, self);
    };
    markdownParser.renderer.rules.fence = (tokens, index, options, env, self) => {
      const info = tokens[index].info.trim().toLowerCase();
      if (info === 'figure' && /^\d{1,3}$/.test(tokens[index].content.trim())) {
        return `<div data-study-figure="${Number(tokens[index].content.trim())}"></div>`;
      }
      if (info === 'mermaid') {
        const slot = env.diagrams.push(tokens[index].content) - 1;
        return `<div data-study-diagram-slot="${slot}"></div>`;
      }
      if (BLOCKS[info]) {
        const rows = blockRows(tokens[index].content);
        if (rows.length) {
          const slot = env.blocks.push({kind: info, rows}) - 1;
          return `<div data-study-block-slot="${slot}"></div>`;
        }
      }
      return fence(tokens, index, options, env, self);
    };
    return markdownParser;
  }

  // Interactive infographics: the model writes "left | right" lines in ```facts, ```steps or ```terms.
  function blockRows(content) {
    return content.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12).map(line => {
      const at = line.indexOf('|');
      return at === -1 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }).filter(([left]) => left);
  }

  function richText(tag, text, className) {
    const node = element(tag, undefined, className);
    insertFormatted(node, text, true);
    return node;
  }

  const BLOCKS = {
    facts(rows) {
      const figure = element('figure', undefined, 'study-block study-facts');
      const grid = element('div', undefined, 'facts-grid');
      rows.forEach(([value, label]) => {
        const card = element('div', undefined, 'fact-card');
        card.append(richText('strong', value, 'fact-value'), richText('span', label, 'fact-label'));
        grid.append(card);
      });
      figure.append(element('figcaption', T('factsCaption')), grid);
      return figure;
    },
    steps(rows) {
      const figure = element('figure', undefined, 'study-block study-steps');
      const list = element('ol', undefined, 'steps-track');
      const panel = element('div', undefined, 'step-panel');
      panel.setAttribute('aria-live', 'polite');
      const counter = element('p', undefined, 'step-counter');
      const title = element('h4', undefined, 'step-title');
      const body = element('div', undefined, 'step-body');
      const prev = element('button', T('prev'), 'secondary'), next = element('button', T('next'));
      prev.type = next.type = 'button';
      const nav = element('div', undefined, 'step-nav');
      nav.append(prev, next);
      panel.append(counter, title, body, nav);
      const buttons = rows.map(([name], index) => {
        const item = element('li');
        const button = element('button', undefined, 'step-dot');
        button.type = 'button';
        button.append(element('span', String(index + 1), 'step-number'), richText('span', name, 'step-name'));
        button.onclick = () => show(index);
        item.append(button); list.append(item);
        return button;
      });
      function show(index) {
        buttons.forEach((button, other) => {
          button.classList.toggle('active', other === index);
          button.classList.toggle('done', other < index);
          button.setAttribute('aria-current', other === index ? 'step' : 'false');
        });
        counter.textContent = T('stepOf', {n: index + 1, total: rows.length});
        insertFormatted(title, rows[index][0], true);
        insertFormatted(body, rows[index][1] || '', true);
        prev.disabled = index === 0; next.disabled = index === rows.length - 1;
        prev.onclick = () => show(index - 1); next.onclick = () => show(index + 1);
      }
      figure.append(element('figcaption', T('stepsCaption')), list, panel);
      show(0);
      return figure;
    },
    terms(rows) {
      const figure = element('figure', undefined, 'study-block study-terms');
      const grid = element('div', undefined, 'terms-grid');
      const cards = rows.map(([term, definition]) => {
        const card = element('button', undefined, 'term-card');
        card.type = 'button'; card.setAttribute('aria-pressed', 'false');
        const back = richText('span', definition || '—', 'term-definition');
        back.hidden = true;
        card.append(richText('strong', term, 'term-name'), back);
        card.onclick = () => flip(card, back.hidden);
        grid.append(card);
        return card;
      });
      function flip(card, open) {
        card.querySelector('.term-definition').hidden = !open;
        card.classList.toggle('open', open);
        card.setAttribute('aria-pressed', String(open));
      }
      const all = element('button', T('revealAll'), 'secondary terms-toggle');
      all.type = 'button';
      all.onclick = () => {
        const open = !cards.every(card => card.classList.contains('open'));
        cards.forEach(card => flip(card, open));
        all.textContent = open ? T('hideAll') : T('revealAll');
      };
      figure.append(element('figcaption', T('termsCaption')), grid, all);
      return figure;
    },
  };

  // Structured infographics from the server (a separate model request), rendered without model HTML.
  function caption(figure, text) {
    figure.prepend(element('figcaption', text));
    return figure;
  }

  function timeline(rows) {
    const figure = element('figure', undefined, 'study-block study-timeline');
    const list = element('ol', undefined, 'timeline-list');
    rows.forEach(([period, event]) => {
      const item = element('li');
      item.append(richText('span', period, 'timeline-period'), richText('span', event, 'timeline-event'));
      list.append(item);
    });
    figure.append(list);
    return caption(figure, T('timelineCaption'));
  }

  function treeFigure(data) {
    // Labels are cleaned so the generated Mermaid code is always valid and cannot carry markup.
    const label = mermaidLabel;
    const lines = ['flowchart TD'];
    let count = 0;
    const walk = (node, parent) => {
      const id = `n${count++}`;
      lines.push(`  ${id}["${label(node.label)}"]`);
      if (parent) lines.push(`  ${parent} --> ${id}`);
      (node.children || []).forEach(child => walk(child, id));
    };
    walk(data.root);
    const figure = diagramFigure(lines.join('\n'));
    figure.classList.add('study-tree');
    figure.dataset.caption = data.title || T('treeCaption');
    figure.querySelector('figcaption').textContent = figure.dataset.caption;
    return figure;
  }

  const mermaidLabel = text => String(text).replace(/\\[()[\]]/g, '').replace(/[<>"#;`{}|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '…';

  function flowFigure(data) {
    // Shapes follow flowchart conventions: rounded start/end, diamond decisions, boxes for actions.
    const ids = new Map(data.nodes.map((node, index) => [node.id, `f${index}`]));
    const shape = {start: ['(["', '"])'], end: ['(["', '"])'], decision: ['{"', '"}'], step: ['["', '"]']};
    const lines = ['flowchart TD'];
    data.nodes.forEach(node => {
      const [open, close] = shape[node.kind] || shape.step;
      lines.push(`  ${ids.get(node.id)}${open}${mermaidLabel(node.label)}${close}`);
    });
    data.edges.forEach(edge => {
      if (!ids.has(edge.from) || !ids.has(edge.to)) return;
      const label = edge.label ? `|"${mermaidLabel(edge.label).slice(0, 40)}"|` : '';
      lines.push(`  ${ids.get(edge.from)} -->${label} ${ids.get(edge.to)}`);
    });
    const figure = diagramFigure(lines.join('\n'));
    figure.classList.add('study-flow');
    figure.dataset.caption = data.title || T('flowCaption');
    figure.querySelector('figcaption').textContent = figure.dataset.caption;
    return figure;
  }

  function formulaCard(data) {
    const figure = element('figure', undefined, 'study-block study-formula');
    const shown = element('div', undefined, 'formula-main');
    renderFormula(shown, {formula: data.latex, display: true});
    figure.append(shown);
    if (data.legend && data.legend.length) {
      const legend = element('dl', undefined, 'formula-legend');
      data.legend.forEach(row => {
        const symbol = element('dt');
        renderFormula(symbol, {formula: row.symbol, display: false});
        legend.append(symbol, richText('dd', row.meaning));
      });
      figure.append(element('p', T('formulaWhere'), 'formula-where'), legend);
    }
    return caption(figure, data.title || T('formulaCaption'));
  }

  function codeBreakdown(data) {
    const figure = element('figure', undefined, 'study-block study-code no-math');
    const notes = new Map(data.notes.map(note => [note.line, note.note]));
    const listing = element('ol', undefined, 'code-lines');
    const panel = element('div', undefined, 'code-note');
    panel.setAttribute('aria-live', 'polite');
    const rows = data.code.split('\n').map((text, index) => {
      const number = index + 1;
      const item = element('li', undefined, notes.has(number) ? 'has-note' : '');
      const code = element('code', text || ' ');
      if (notes.has(number)) {
        const button = element('button', undefined, 'code-line');
        button.type = 'button';
        button.append(element('span', String(number), 'code-number'), code, element('span', '?', 'code-mark'));
        button.onclick = () => show(number);
        item.append(button);
      } else {
        const row = element('div', undefined, 'code-row');
        row.append(element('span', String(number), 'code-number'), code);
        item.append(row);
      }
      listing.append(item);
      return item;
    });
    function show(number) {
      rows.forEach((row, index) => row.classList.toggle('active', index + 1 === number));
      panel.replaceChildren(element('strong', T('codeLine', {n: number}), 'code-note-title'), richText('div', notes.get(number), 'code-note-text'));
    }
    const head = element('div', undefined, 'code-head');
    head.append(element('span', data.language || T('codeLanguage'), 'code-language'), element('span', T('codeHint'), 'code-hint'));
    const body = element('div', undefined, 'code-body');
    body.append(listing, panel);
    figure.append(head, body);
    show(data.notes[0].line);
    return caption(figure, data.title || T('codeCaption'));
  }

  // A picture of the guide: the page tells where its pictures are (window.StudyMedia), the text only their numbers.
  function picture(number) {
    const figure = element('figure', undefined, 'study-figure');
    const source = window.StudyMedia && window.StudyMedia(number);
    if (!source) {
      figure.append(element('p', T('figureMissing', {n: number}), 'figure-missing'));
      return figure;
    }
    const image = document.createElement('img');
    image.src = source.url; image.loading = 'lazy'; image.alt = T('figureAlt', {n: number});
    if (source.formula) {
      // A display formula kept as a picture of the page: as tall as in the original, without a frame.
      figure.classList.add('formula-figure');
      image.alt = T('formulaAlt');
      image.style.height = `${Math.max(1.2, Math.min((source.em || 2) * 1.15, 14))}em`;  // KaTeX text is a little larger than the PDF's.
      image.style.width = 'auto';
      figure.append(image);
      return figure;
    }
    // The whole picture is always visible (scaled down to fit); a click shows it on the whole screen.
    if (source.width && source.height) image.style.aspectRatio = `${source.width} / ${source.height}`;
    const zoom = element('button', undefined, 'figure-zoom');
    zoom.type = 'button'; zoom.title = T('figureZoom');
    zoom.append(image);
    zoom.onclick = () => lightbox(() => {
      const big = document.createElement('img');
      big.src = source.url; big.alt = image.alt;
      return big;
    });
    figure.append(zoom);
    return figure;
  }

  // Formulas that could not be read as text are small pictures inside the line: ⟦img:N⟧ in the text.
  function inlinePictures(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('⟦img:')) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const parts = node.nodeValue.split(/⟦img:(\d+)⟧/);
      const fragment = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (index % 2 === 0) { if (part) fragment.append(document.createTextNode(part)); return; }
        const source = window.StudyMedia && window.StudyMedia(Number(part));
        if (!source) { fragment.append(document.createTextNode(T('formulaAlt'))); return; }
        const image = document.createElement('img');
        image.src = source.url; image.alt = T('formulaAlt'); image.className = 'inline-formula';
        image.style.height = `${Math.max(1, Math.min((source.em || 1.3) * 1.1, 4))}em`;
        fragment.append(image);
      });
      node.replaceWith(fragment);
    });
  }

  // Full-screen view of a picture or a scheme: fitted to the screen, a click shows the natural size, Esc closes.
  function lightbox(make) {
    const overlay = element('div', undefined, 'study-lightbox');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.tabIndex = -1;
    const content = make();
    const close = element('button', '×', 'lightbox-close');
    close.type = 'button'; close.title = T('close'); close.setAttribute('aria-label', T('close'));
    const stage = element('div', undefined, 'lightbox-stage');
    stage.append(content);
    overlay.append(stage, close);
    const finish = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') finish(); };
    close.onclick = finish;
    overlay.onclick = event => { if (event.target === overlay || event.target === stage) finish(); };
    content.onclick = event => { event.stopPropagation(); overlay.classList.toggle('natural'); };
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.focus();
  }

  function chart(data) {
    const figure = element('figure', undefined, 'study-block study-chart');
    const max = Math.max(...data.items.map(item => item.value));
    const format = value => Number(value).toLocaleString(window.StudyI18n?.lang || 'ru', {maximumFractionDigits: 2}) + (data.unit ? ` ${data.unit}` : '');
    const list = element('ul', undefined, 'chart-bars');
    data.items.forEach(item => {
      const row = element('li', undefined, 'chart-row');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${item.label}: ${format(item.value)}`);
      const bar = element('span', undefined, 'chart-bar');
      bar.style.setProperty('--share', `${max ? Math.max(2, item.value / max * 100) : 0}%`);
      row.append(richText('span', item.label, 'chart-label'), bar, element('span', format(item.value), 'chart-value'));
      list.append(row);
    });
    figure.append(list);
    return caption(figure, data.title || T('chartCaption'));
  }

  function infographic(item) {
    const rows = (first, second) => item.items.map(row => [row[first], row[second]]);
    switch (item.type) {
      case 'facts': return BLOCKS.facts(rows('value', 'label'));
      case 'steps': return BLOCKS.steps(rows('title', 'text'));
      case 'terms': return BLOCKS.terms(rows('term', 'definition'));
      case 'timeline': return timeline(rows('period', 'event'));
      case 'tree': return treeFigure(item);
      case 'chart': return chart(item);
      case 'flow': return flowFigure(item);
      case 'formula': return formulaCard(item);
      case 'code': return codeBreakdown(item);
      default: return null;
    }
  }

  function completeBareTables(text) {
    const lines = text.split('\n'), result = [];
    let fence = null;
    const cells = line => {
      const value = line.trim();
      if (!value.startsWith('|') || !value.endsWith('|')) return null;
      return value.slice(1, -1).split(/(?<!\\)\|/);
    };
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        result.push(line); continue;
      }
      const first = !fence && cells(line);
      if (!first || first.length < 2) { result.push(line); continue; }
      const block = [line];
      while (index + 1 < lines.length) {
        const row = cells(lines[index + 1]);
        if (!row || row.length !== first.length) break;
        block.push(lines[++index]);
      }
      if (block.length > 1 && !cells(block[1]).every(cell => /^\s*:?-+:?\s*$/.test(cell))) {
        // A common model output omits the Markdown header separator; fix only this view.
        block.splice(1, 0, '|' + first.map(() => ' --- ').join('|') + '|');
      }
      result.push(...block);
    }
    return result.join('\n');
  }

  function insertFormatted(container, text, inlineOnly = false) {
    const md = parser();
    if (!md || !window.DOMPurify) { container.textContent = text; math(container); return; }
    const env = {formulas: new Map(), diagrams: [], blocks: []};
    const protectedText = completeBareTables(shieldMath(normalizePresentation(text), env));
    const html = inlineOnly ? md.renderInline(protectedText.trim(), env) : md.render(protectedText, env);
    const clean = window.DOMPurify.sanitize(html, {
      USE_PROFILES: {html: true},
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'img', 'image', 'a', 'foreignObject'],
    });
    const template = document.createElement('template');
    template.innerHTML = clean;
    container.replaceChildren(template.content);
    container.querySelectorAll('[data-study-math]').forEach(slot => {
      const entry = env.formulas.get(slot.dataset.studyMath);
      if (entry) renderFormula(slot, entry);
      slot.removeAttribute('data-study-math');
    });
    container.querySelectorAll('[data-study-diagram-slot]').forEach(slot => {
      const source = env.diagrams[Number(slot.dataset.studyDiagramSlot)];
      slot.replaceWith(diagramFigure(source));
    });
    container.querySelectorAll('[data-study-figure]').forEach(slot => slot.replaceWith(picture(Number(slot.dataset.studyFigure))));
    inlinePictures(container);
    container.querySelectorAll('[data-study-block-slot]').forEach(slot => {
      const block = env.blocks[Number(slot.dataset.studyBlockSlot)];
      slot.replaceWith(BLOCKS[block.kind](block.rows));
    });
    container.querySelectorAll('blockquote').forEach(note => note.classList.add('study-callout'));
    container.querySelectorAll('p').forEach(p => p.classList.add('summary-text'));
    container.querySelectorAll('table').forEach(table => {
      table.classList.add('study-table');
      const columns = table.rows[0] ? table.rows[0].cells.length : 0;
      // Wide tables get tighter cells so that they fit the page without scrolling.
      if (columns >= 12) table.classList.add('cols-12', 'cols-8', 'cols-5');
      else if (columns >= 8) table.classList.add('cols-8', 'cols-5');
      else if (columns >= 5) table.classList.add('cols-5');
      table.querySelectorAll('th').forEach(cell => cell.setAttribute('scope', 'col'));
      const viewport = element('div', undefined, 'study-table-viewport');
      viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', T('tableAria'));
      table.replaceWith(viewport); viewport.append(table);
    });
    if (!inlineOnly) enhance(container);
  }

  function renderSummary(container, text) { insertFormatted(container, text); }
  function inline(container, text) { insertFormatted(container, text, true); }
  window.StudyPresentation = {renderSummary, inline, math, enhance, safeDiagram, infographic};
})();
