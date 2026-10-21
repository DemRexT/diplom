/* Model output is data. This small arithmetic parser never executes JavaScript. */
(() => {
  const constants = {pi: Math.PI, e: Math.E};
  const functions = {sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos,
    exp: Math.exp, log: Math.log, min: Math.min, max: Math.max};
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function evaluate(source, values) {
    if (typeof source !== 'string' || source.length > 300) throw Error('Неверная формула');
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-z][a-z0-9_]*|\*\*|[+\-*/^(),]|\s+|./g) || [];
    const list = tokens.filter(token => !/^\s+$/.test(token));
    let index = 0, depth = 0, operations = 0;
    const peek = () => list[index];
    const consume = value => { if (peek() === value) { index++; return true; } return false; };
    const finite = value => {
      if (!Number.isFinite(value) || Math.abs(value) > 1e100) throw Error('Результат не определён при этих параметрах');
      return value;
    };
    function atom() {
      if (++depth > 16 || ++operations > 128) throw Error('Слишком сложное выражение');
      let result, token = list[index++];
      if (token === '(') {
        result = sum(); if (!consume(')')) throw Error('Не закрыта скобка');
      } else if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token || '')) result = Number(token);
      else if (own(functions, token) && consume('(')) {
        const args = [sum()];
        while (consume(',')) { if (args.length >= 4) throw Error('Много аргументов'); args.push(sum()); }
        if (!consume(')') || (!['min', 'max'].includes(token) && args.length !== 1)) throw Error('Неверные аргументы функции');
        result = functions[token](...args);
      } else if (own(values, token)) result = values[token];
      else if (own(constants, token)) result = constants[token];
      else throw Error('Неизвестный параметр или операция');
      depth--; return finite(result);
    }
    function power() {
      let result = atom();
      if (consume('^') || consume('**')) {
        const exponent = unary();
        if (Math.abs(exponent) > 12) throw Error('Степень вне диапазона');
        result = finite(result ** exponent);
      }
      return result;
    }
    function unary() {
      if (++operations > 128) throw Error('Слишком сложное выражение');
      if (consume('+')) return unary();
      if (consume('-')) return -unary();
      return power();
    }
    function product() {
      let result = unary();
      while (peek() === '*' || peek() === '/') {
        const op = list[index++], next = unary();
        result = finite(op === '*' ? result * next : result / next);
      }
      return result;
    }
    function sum() {
      let result = product();
      while (peek() === '+' || peek() === '-') {
        const op = list[index++], next = product(); result = finite(op === '+' ? result + next : result - next);
      }
      return result;
    }
    const result = sum();
    if (index !== list.length) throw Error('Лишние символы в выражении');
    return finite(result);
  }
  const node = (tag, text, className) => {
    const item = document.createElement(tag); if (text !== undefined) item.textContent = text;
    if (className) item.className = className; return item;
  };
  const rich = (tag, text) => {
    const item = node(tag); if (window.StudyPresentation) window.StudyPresentation.inline(item, text); else item.textContent = text;
    return item;
  };
  const number = value => new Intl.NumberFormat('ru-RU', {maximumSignificantDigits: 7, notation: Math.abs(value) >= 1e7 || (value !== 0 && Math.abs(value) < 1e-4) ? 'scientific' : 'standard'}).format(value);
  const svgNode = (tag, attributes, text) => {
    const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => item.setAttribute(key, value));
    if (text !== undefined) item.textContent = text; return item;
  };
  function plot(root, lab, values) {
    root.replaceChildren();
    const parameter = lab.parameters.find(item => item.name === lab.plot_variable);
    if (!parameter) return;
    const points = Array.from({length: 81}, (_, i) => {
      const x = parameter.minimum + (parameter.maximum - parameter.minimum) * i / 80;
      try { return [x, evaluate(lab.outputs[0].expression, {...values, [parameter.name]: x})]; }
      catch (_) { return [x, null]; }
    });
    const valid = points.filter(point => point[1] !== null);
    if (valid.length < 2) { root.append(node('p', 'Для этих параметров график недоступен.')); return; }
    let lower = Math.min(...valid.map(p => p[1])), upper = Math.max(...valid.map(p => p[1]));
    const padding = (upper - lower || Math.abs(upper) || 1) * .1; lower -= padding; upper += padding;
    const x = value => 68 + (value - parameter.minimum) / (parameter.maximum - parameter.minimum) * 480;
    const y = value => 216 - (value - lower) / (upper - lower) * 184;
    const svg = svgNode('svg', {viewBox: '0 0 600 270', role: 'img', 'aria-label': `Зависимость «${lab.outputs[0].label}» от «${parameter.label}»`});
    svg.append(svgNode('path', {d:'M68 28 V216 H548', fill:'none', stroke:'#789083'}));
    for (const [position, text, anchor] of [[68, number(parameter.minimum), 'start'], [548, number(parameter.maximum), 'end']]) {
      svg.append(svgNode('text', {x:position,y:235,'text-anchor':anchor}, text));
    }
    svg.append(svgNode('text',{x:60,y:38,'text-anchor':'end'},number(upper)), svgNode('text',{x:60,y:216,'text-anchor':'end'},number(lower)),
      svgNode('text',{x:308,y:259,'text-anchor':'middle'},parameter.name));
    let segment = [];
    const flush = () => { if (segment.length > 1) svg.append(svgNode('polyline',{points:segment.join(' '),fill:'none',stroke:'#527441','stroke-width':3})); segment=[]; };
    points.forEach(([px, py]) => { if (py === null) flush(); else segment.push(`${x(px)},${y(py)}`); }); flush();
    try {
      const result = evaluate(lab.outputs[0].expression, values);
      if (result >= lower && result <= upper) svg.append(svgNode('circle',{cx:x(values[parameter.name]),cy:y(result),r:5,fill:'#b86c36'}));
    } catch (_) { /* Undefined points are deliberately absent. */ }
    root.append(svg, node('p', `По вертикали: ${lab.outputs[0].label}${lab.outputs[0].unit ? ' ('+lab.outputs[0].unit+')' : ''}. Точка — текущие параметры. График построен по 81 точке.`, 'lab-chart-caption'));
  }
  function labView(lab) {
    const root = node('section', undefined, 'study-lab');
    root.append(node('p','Дополнительный учебный пример ИИ', 'lab-badge'),node('h3',lab.title),rich('p',lab.explanation),rich('p',lab.task),rich('p',lab.formula));
    const controls = node('div', undefined, 'lab-controls'), values = {}, inputs = [];
    const results = node('div', undefined, 'lab-results'); results.setAttribute('aria-live','polite');
    const chart = node('figure', undefined, 'lab-chart');
    const update = () => {
      results.replaceChildren();
      lab.outputs.forEach(output => {
        const row = node('p'); row.append(node('span',output.label+': '));
        try { row.append(node('strong',number(evaluate(output.expression, values)) + (output.unit ? ' '+output.unit : ''))); }
        catch (_) { row.append(node('span','Не определено при этих параметрах. Проверь условия примера.','lab-domain-error')); }
        results.append(row);
      });
      plot(chart, lab, values);
    };
    lab.parameters.forEach(parameter => {
      values[parameter.name] = parameter.initial;
      const label = node('label',parameter.label), slider=node('input'), field=node('input');
      slider.type='range'; field.type='number';
      [slider,field].forEach(input => {
        input.min=parameter.minimum; input.max=parameter.maximum; input.step=parameter.step; input.value=parameter.initial;
        input.setAttribute('aria-label',parameter.label+(input===slider ? ' — ползунок' : ' — число'));
      });
      slider.addEventListener('input',()=> { values[parameter.name]=Number(slider.value); field.value=slider.value; field.setCustomValidity(''); update(); });
      field.addEventListener('input',()=> {
        if (field.value==='' || !field.validity.valid || !Number.isFinite(Number(field.value))) return;
        values[parameter.name]=Number(field.value); slider.value=field.value; update();
      });
      field.addEventListener('change',()=> { if (field.value==='' || !field.validity.valid) { field.value=values[parameter.name]; } });
      label.append(slider,field); controls.append(label); inputs.push({parameter,slider,field});
    });
    const reset=node('button','Сбросить параметры'); reset.type='button';
    reset.onclick=()=> { inputs.forEach(({parameter,slider,field})=>{values[parameter.name]=parameter.initial; slider.value=field.value=parameter.initial;}); update(); };
    const details=node('details'), heading=node('summary','Как считается результат'); details.append(heading);
    lab.outputs.forEach(output=>{details.append(node('p',output.label),node('code',output.expression));});
    root.append(controls,results,chart,reset,details); update(); return root;
  }
  function render(root, labs) {
    if (!Array.isArray(labs) || !labs.length) return;
    const section=node('section',undefined,'study-labs'); section.append(node('h2','Исследуй на примере'),node('p','Меняй параметры, сравнивай результат и график. Дополнительные примеры созданы ИИ; формулы и условия стоит проверить перед публикацией.'));
    labs.slice(0,3).forEach(lab=>{
      try {
        const view=labView(lab);
        const title=[...root.querySelectorAll('h2,h3,h4')].find(item=>item.textContent.trim().toLocaleLowerCase()===String(lab.topic).trim().toLocaleLowerCase());
        if (title) {
          let position=title; while(position.nextElementSibling && !/^H[234]$/.test(position.nextElementSibling.tagName)) position=position.nextElementSibling;
          position.after(view);
        } else section.append(view);
      } catch (_) { section.append(node('p','Этот интерактивный пример не удалось открыть.')); }
    });
    if(section.querySelector('.study-lab') || section.children.length>2) root.append(section);
  }
  window.StudyLabs={evaluate,render};
})();
