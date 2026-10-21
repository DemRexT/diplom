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

  function inline(parent, text) {
    // Deliberately support only emphasis; arbitrary HTML, links and images remain text.
    text.split(/(\*\*[^*\n]+\*\*)/g).forEach(part => {
      if (part.startsWith('**') && part.endsWith('**')) parent.append(element('strong', part.slice(2, -2)));
      else parent.append(document.createTextNode(part));
    });
  }

  function renderSummary(container, text) {
    const lines = text.split('\n');
    let paragraph = [], list = null;
    const flush = () => {
      if (paragraph.length) {
        const p = element('p', undefined, 'summary-text'); inline(p, paragraph.join('\n')); container.append(p);
      }
      paragraph = []; list = null;
    };
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*```mermaid\s*$/i.test(line)) {
        const close = lines.findIndex((value, offset) => offset > index && /^\s*```\s*$/.test(value));
        if (close !== -1) {
          flush(); container.append(diagramFigure(lines.slice(index + 1, close).join('\n'))); index = close; continue;
        }
      }
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      const item = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
      if (heading) { flush(); const h = element('h3'); inline(h, heading[1]); container.append(h); }
      else if (/^>\s?/.test(line)) {
        flush(); const note = element('aside', undefined, 'study-callout'); inline(note, line.replace(/^>\s?/, '')); container.append(note);
      } else if (item) {
        if (paragraph.length) flush();
        const tag = item[2] ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) { list = element(tag.toLowerCase(), undefined, 'study-list'); container.append(list); }
        const li = element('li'); inline(li, item[3]); list.append(li);
      } else if (!line.trim()) flush();
      else { list = null; paragraph.push(line); }
    }
    flush();
    enhance(container);
  }
  window.StudyPresentation = {renderSummary, math, enhance, safeDiagram};
})();
