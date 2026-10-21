/* Render model-provided study formatting without allowing model-provided HTML. */
(() => {
  const diagrams = new WeakMap();
  let counter = 0;
  let queue = Promise.resolve();
  let initialized = false;
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
      && /^(?:flowchart\b|graph\b|sequenceDiagram\b|mindmap\b|pie\b)/.test(source.trim())
      && !/%%\{|^\s*(?:click|style|classDef|linkStyle)\b|^---|<\s*\/?[A-Za-z!]|(?:https?:|javascript:|data:)|url\s*\(/im.test(source);
  }

  function diagramFigure(source) {
    const figure = element('figure', undefined, 'study-diagram no-math');
    figure.append(element('figcaption', 'Наглядная схема'), element('p', 'Строим схему…', 'diagram-status'));
    if (!safeDiagram(source)) {
      figure.querySelector('.diagram-status').textContent = 'Эту схему не удалось отобразить. Объяснение темы остаётся в конспекте.';
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
          figure.querySelector('.diagram-status').textContent = 'Не удалось загрузить оформление схемы. Обнови страницу.';
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
            rendered.style.width = `${Math.min(Math.ceil(viewBox[2]), 12000)}px`;
            rendered.style.maxWidth = 'none';
          }
          rendered.setAttribute('role', 'img');
          rendered.setAttribute('aria-label', 'Схема по содержанию учебного материала');
          const viewport = element('div', undefined, 'diagram-viewport');
          viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Схема; широкую схему можно прокручивать');
          viewport.append(rendered);
          figure.replaceChildren(element('figcaption', 'Наглядная схема'), viewport, element('p', 'Широкую схему можно прокручивать в сторону.', 'diagram-hint'));
          figure.dataset.diagram = 'ready';
        } catch (_) {
          if (figure.isConnected) {
            figure.replaceChildren(element('figcaption', 'Наглядная схема'), element('p', 'Не удалось построить схему. Продолжай читать объяснение в конспекте.'));
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
          container.title = 'Исправлена группировка штриха при отображении; исходная запись сохранена.';
          return;
        } catch (_) { /* Keep the original visible on demand, never guess its meaning. */ }
      }
      container.replaceChildren();
      container.classList.add('study-math-error', 'no-math');
      container.append(element('span', 'Формула содержит ошибку записи. '));
      const toggle = element('button', 'Показать исходную формулу');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      const original = element('code', entry.formula); original.hidden = true;
      toggle.onclick = () => {
        original.hidden = !original.hidden;
        toggle.setAttribute('aria-expanded', String(!original.hidden));
        toggle.textContent = original.hidden ? 'Показать исходную формулу' : 'Скрыть исходную формулу';
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
      if (tokens[index].info.trim().toLowerCase() === 'mermaid') {
        const slot = env.diagrams.push(tokens[index].content) - 1;
        return `<div data-study-diagram-slot="${slot}"></div>`;
      }
      return fence(tokens, index, options, env, self);
    };
    return markdownParser;
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
    const env = {formulas: new Map(), diagrams: []};
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
    container.querySelectorAll('blockquote').forEach(note => note.classList.add('study-callout'));
    container.querySelectorAll('p').forEach(p => p.classList.add('summary-text'));
    container.querySelectorAll('table').forEach(table => {
      table.classList.add('study-table');
      table.querySelectorAll('th').forEach(cell => cell.setAttribute('scope', 'col'));
      const viewport = element('div', undefined, 'study-table-viewport');
      viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', 'Учебная таблица; широкую таблицу можно прокручивать');
      table.replaceWith(viewport); viewport.append(table);
    });
    if (!inlineOnly) enhance(container);
  }

  function renderSummary(container, text) { insertFormatted(container, text); }
  function inline(container, text) { insertFormatted(container, text, true); }
  window.StudyPresentation = {renderSummary, inline, math, enhance, safeDiagram};
})();
