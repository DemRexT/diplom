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
  let activeAnimationStop = null;
  function plot(root, lab, values, onPick) {
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
    if(onPick){
      svg.setAttribute('tabindex','0');svg.style.cursor='crosshair';
      const pick=(value,keyboard=false)=>{
        const steps=Math.round((value-parameter.minimum)/parameter.step);
        const bounded=Math.max(parameter.minimum,Math.min(parameter.maximum,parameter.minimum+steps*parameter.step));
        onPick(Number(bounded.toFixed(10)),keyboard);
      };
      svg.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        const transform=svg.getScreenCTM();if(!transform)return;
        const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
        const local=point.matrixTransform(transform.inverse());
        pick(parameter.minimum+(local.x-68)/480*(parameter.maximum-parameter.minimum));
      });
      svg.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
        pick(event.key==='Home'?parameter.minimum:event.key==='End'?parameter.maximum:values[parameter.name]+(event.key==='ArrowLeft'?-1:1)*parameter.step,true);
      });
    }
    root.append(svg, node('p', `По вертикали: ${lab.outputs[0].label}${lab.outputs[0].unit ? ' ('+lab.outputs[0].unit+')' : ''}. Точка — текущие параметры. Нажми на график или используй стрелки ← →, чтобы переместить точку. График построен по 81 точке.`, 'lab-chart-caption'));
  }
  const shuffled = list => {
    const result=[...list];
    for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
    return result;
  };
  function visual(root, lab, values, mode) {
    root.replaceChildren();
    let results;
    try { results=lab.outputs.map(item=>evaluate(item.expression,values)); }
    catch(_){root.append(node('p','Визуализация недоступна: проверь область определения.'));return;}
    if(mode==='matrix') {
      const size=Math.sqrt(results.length);
      if(![2,3].includes(size))return;
      const grid=node('div',undefined,'lab-matrix');grid.style.gridTemplateColumns=`repeat(${size},minmax(0,1fr))`;
      const max=Math.max(1,...results.map(Math.abs));
      results.forEach((value,index)=>{
        const cell=node('div',undefined,'lab-matrix-cell');cell.style.backgroundColor=`hsl(${value<0?22:145} 45% ${96-30*Math.abs(value)/max}%)`;
        cell.append(node('small',lab.outputs[index].label),node('strong',number(value)));grid.append(cell);
      });root.append(grid,node('p','Цвет показывает знак и величину компоненты. Меняй параметры и наблюдай матрицу.','lab-chart-caption'));return;
    }
    if(mode==='vector') {
      const [a,b]=results,scale=Math.max(1,Math.abs(a),Math.abs(b))*1.2;
      const svg=svgNode('svg',{viewBox:'0 0 320 280',role:'img','aria-label':`Вектор (${number(a)}; ${number(b)})`});
      svg.append(svgNode('path',{d:'M20 140 H300 M160 20 V260',stroke:'#b3c5af',fill:'none'}));
      const endX=160+a/scale*115,endY=140-b/scale*115;
      svg.append(svgNode('path',{d:`M160 140 L${endX} ${endY}`,stroke:'#638653','stroke-width':5,fill:'none'}));
      const angle=Math.atan2(endY-140,endX-160),arrow=12;
      if(a!==0||b!==0)svg.append(svgNode('path',{d:`M${endX-arrow*Math.cos(angle-.5)} ${endY-arrow*Math.sin(angle-.5)} L${endX} ${endY} L${endX-arrow*Math.cos(angle+.5)} ${endY-arrow*Math.sin(angle+.5)}`,stroke:'#638653','stroke-width':4,fill:'none'}));
      svg.append(svgNode('text',{x:285,y:133},'x'),svgNode('text',{x:168,y:28},'y'));
      root.append(svg,node('p',`Компоненты: (${number(a)}; ${number(b)}). Масштаб осей: ±${number(scale)}.`,'lab-chart-caption'));return;
    }
    const max=Math.max(1e-12,...results.map(Math.abs));
    lab.outputs.forEach((output,index)=>{
      const row=node('div',undefined,'lab-bar-row'),track=node('div',undefined,'lab-bar-track'),bar=node('span');
      bar.style.width=`${Math.abs(results[index])/max*100}%`;bar.classList.toggle('negative',results[index]<0);track.append(bar);
      row.append(node('span',output.label),track,node('strong',number(results[index])));root.append(row);
    });root.append(node('p','Длина полосы — абсолютная величина, цвет — знак.','lab-chart-caption'));
  }
  function labView(lab, complete) {
    const root=node('section',undefined,'study-lab');
    root.append(node('p','Лаборатория · пример ИИ','lab-badge'),node('h3',lab.title),rich('p',lab.explanation),rich('p',lab.task),rich('p',lab.formula));
    const controls=node('div',undefined,'lab-controls'),values={},inputs=[];
    const results=node('div',undefined,'lab-results');results.setAttribute('aria-live','polite');
    const chart=node('figure',undefined,'lab-chart'),changes=node('p',undefined,'lab-changes');
    const filters=node('div',undefined,'lab-chart-filters'),axis=node('select'),outputSelect=node('select');
    lab.parameters.forEach((p,i)=>{const option=node('option',p.label);option.value=i;axis.append(option);});
    axis.value=Math.max(0,lab.parameters.findIndex(p=>p.name===lab.plot_variable));
    lab.outputs.forEach((p,i)=>{const option=node('option',p.label);option.value=i;outputSelect.append(option);});
    const axisLabel=node('label','Меняем на графике'),outputLabel=node('label','Наблюдаем результат');
    axisLabel.append(axis);outputLabel.append(outputSelect);filters.append(axisLabel,outputLabel);
    let mode=lab.visualization||'graph',prediction=false,frame=0,lastTick=0,direction=1;
    const toolbar=node('div',undefined,'lab-toolbar'),play=node('button','▶ Оживить'),compare=node('button','Сравнить с началом'),reset=node('button','Сбросить параметры');
    const compareState=node('p',undefined,'lab-comparison');compareState.hidden=true;
    let comparing=false;
    const predict=node('button','🎯 Предскажи результат'),predictionBox=node('div',undefined,'lab-prediction');predictionBox.hidden=true;
    const question=node('p'),guess=node('input'),check=node('button','Проверить'),reveal=node('button','Показать результат'),feedback=node('p');
    guess.type='number';guess.step='any';guess.setAttribute('aria-label','Твой прогноз');guess.placeholder='Твой ответ';
    feedback.setAttribute('role','status');predictionBox.append(question,guess,check,reveal,feedback);
    [play,compare,reset,predict,check,reveal].forEach(button=>button.type='button');
    const stop=()=>{cancelAnimationFrame(frame);frame=0;if(activeAnimationStop===stop)activeAnimationStop=null;play.textContent='▶ Оживить';play.setAttribute('aria-pressed','false');};
    const paint = () => {
      results.replaceChildren();
      lab.outputs.forEach(output=>{
        const row=node('p');row.append(node('span',output.label+': '));
        try{row.append(node('strong',number(evaluate(output.expression,values))+(output.unit?' '+output.unit:'')));}
        catch(_){row.append(node('span','Не определено при этих параметрах. Проверь условия примера.','lab-domain-error'));}results.append(row);
      });
      const output=lab.outputs[Number(outputSelect.value)],parameter=lab.parameters[Number(axis.value)];
      if(mode==='graph')plot(chart,{...lab,outputs:[output],plot_variable:parameter.name},values,(value,keyboard)=>{stop();setValue(parameter,value);paint();if(keyboard)chart.querySelector('svg')?.focus();});
      else visual(chart,lab,values,mode);
      filters.hidden=mode!=='graph';
      const changed=lab.parameters.filter(p=>values[p.name]!==p.initial);
      changes.textContent=changed.length?changed.map(p=>`${p.label}: ${number(p.initial)} → ${number(values[p.name])}`).join(' · '):'Начальные параметры. Что изменится, если сдвинуть ползунок?';
      if(comparing){
        const initial=Object.fromEntries(lab.parameters.map(p=>[p.name,p.initial]));
        compareState.replaceChildren(node('strong','Было → стало'));
        lab.outputs.forEach(item=>{
          try{const before=evaluate(item.expression,initial),after=evaluate(item.expression,values);compareState.append(node('span',`${item.label}: ${number(before)} → ${number(after)} (изменение ${number(after-before)})`));}
          catch(_){compareState.append(node('span',`${item.label}: значение не определено`));}
        });
      }
      if(prediction){question.textContent=`Чему равно «${output.label}» при текущих параметрах? Допустима погрешность 0,1% (для нуля — 0,000001).`;feedback.textContent='';}
    };
    const finishPrediction=()=>{prediction=false;results.hidden=false;chart.hidden=false;predictionBox.hidden=true;predict.textContent='🎯 Предскажи результат';};
    const setValue=(p,value)=>{values[p.name]=value;const item=inputs.find(i=>i.parameter===p);item.slider.value=item.field.value=value;};
    lab.parameters.forEach(parameter=>{
      values[parameter.name]=parameter.initial;
      const label=node('label',parameter.label),slider=node('input'),field=node('input');slider.type='range';field.type='number';
      [slider,field].forEach(input=>{input.min=parameter.minimum;input.max=parameter.maximum;input.step=parameter.step;input.value=parameter.initial;input.setAttribute('aria-label',parameter.label+(input===slider?' — ползунок':' — число'));});
      slider.addEventListener('input',()=>{stop();setValue(parameter,Number(slider.value));paint();});
      field.addEventListener('input',()=>{if(field.value===''||!field.validity.valid||!Number.isFinite(Number(field.value)))return;stop();values[parameter.name]=Number(field.value);slider.value=field.value;paint();});
      field.addEventListener('change',()=>{if(field.value===''||!field.validity.valid)field.value=values[parameter.name];});
      label.append(slider,field);controls.append(label);inputs.push({parameter,slider,field});
    });
    axis.onchange=outputSelect.onchange=()=>{stop();finishPrediction();paint();};
    const modes=node('div',undefined,'lab-modes');modes.setAttribute('aria-label','Вид визуализации');
    const modeNames={graph:'📈 График',bars:'▥ Сравнение',vector:'↗ Вектор',matrix:'▦ Матрица'};
    const available=[...new Set([mode,'graph','bars'])];
    available.forEach(value=>{const button=node('button',modeNames[value]);button.type='button';button.setAttribute('aria-pressed',String(mode===value));button.onclick=()=>{mode=value;finishPrediction();[...modes.children].forEach(item=>item.setAttribute('aria-pressed',String(item===button)));paint();};modes.append(button);});
    play.onclick=()=>{
      if(frame){stop();return;}activeAnimationStop?.();activeAnimationStop=stop;finishPrediction();play.textContent='❚❚ Пауза';play.setAttribute('aria-pressed','true');lastTick=0;
      const tick=time=>{
        if(!root.isConnected||!root.getClientRects().length||document.hidden){stop();return;}
        if(time-lastTick>=100){
          const p=lab.parameters[Number(axis.value)],steps=Math.ceil((p.maximum-p.minimum)/p.step),jump=Math.max(1,Math.floor(steps/70))*p.step;
          let next=values[p.name]+direction*jump;
          if(next>=p.maximum){next=p.maximum;direction=-1;}if(next<=p.minimum){next=p.minimum;direction=1;}
          setValue(p,Number(next.toFixed(10)));paint();lastTick=time;
        }frame=requestAnimationFrame(tick);
      };frame=requestAnimationFrame(tick);
    };
    compare.onclick=()=>{comparing=!comparing;compareState.hidden=!comparing;compare.setAttribute('aria-pressed',String(comparing));paint();};
    reset.onclick=()=>{stop();finishPrediction();inputs.forEach(({parameter})=>setValue(parameter,parameter.initial));paint();};
    predict.onclick=()=>{
      stop();
      let valid=false;
      for(let attempt=0;attempt<20;attempt++){
        lab.parameters.forEach(p=>{const steps=Math.floor((p.maximum-p.minimum)/p.step);setValue(p,Number((p.minimum+Math.floor(Math.random()*(steps+1))*p.step).toFixed(10)));});
        try{evaluate(lab.outputs[Number(outputSelect.value)].expression,values);valid=true;break;}catch(_){}
      }
      if(!valid){lab.parameters.forEach(p=>setValue(p,p.initial));}
      prediction=true;results.hidden=true;chart.hidden=true;comparing=false;compareState.hidden=true;guess.value='';predictionBox.hidden=false;predict.textContent='🎲 Новый раунд';paint();guess.focus();
    };
    check.onclick=()=>{
      if(!prediction){feedback.textContent='Начни новый раунд, чтобы проверить новый прогноз.';return;}
      if(guess.value===''||!Number.isFinite(Number(guess.value))){feedback.textContent='Введи число, затем проверь прогноз.';return;}
      try{
        const expected=evaluate(lab.outputs[Number(outputSelect.value)].expression,values);
        const correct=Math.abs(Number(guess.value)-expected)<=Math.max(1e-6,Math.abs(expected)*.001);
        feedback.textContent=correct?'Верно! Ты разобрался в этой зависимости. ✨':'Пока не совпало. Подставь текущие параметры в формулу и попробуй ещё раз.';
        if(correct){complete();prediction=false;results.hidden=false;chart.hidden=false;root.classList.add('activity-complete');}
      }catch(_){feedback.textContent='При этих параметрах ответ не определён. Измени параметры или начни новый раунд.';}
    };
    guess.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();check.click();}});
    reveal.onclick=()=>{prediction=false;results.hidden=false;chart.hidden=false;feedback.textContent='Сравни результат со своим расчётом. Попробуй новый раунд!';};
    const details=node('details'),heading=node('summary','Как считается результат');details.append(heading);
    lab.outputs.forEach(output=>details.append(node('p',output.label),node('code',output.expression)));
    toolbar.append(play,compare,predict,reset);root.append(controls,changes,modes,filters,results,chart,toolbar,compareState,predictionBox,details);paint();return root;
  }
  function challengeView(challenge,complete){
    const root=node('section',undefined,'study-challenge'),body=node('div',undefined,'challenge-body'),feedback=node('p');feedback.setAttribute('role','status');
    root.append(node('p',challenge.kind==='order'?'Собери последовательность':'Мини-миссия','lab-badge'),node('h3',challenge.title),rich('p',challenge.prompt),body);
    let order=[],selected=null;
    const explanation=rich('p',challenge.explanation);explanation.hidden=true;
    const draw=()=>{
      body.replaceChildren();
      order.forEach((id,index)=>{
        if(challenge.kind==='choice'){
          const button=rich('button',challenge.items[id]);button.type='button';button.setAttribute('aria-pressed',String(selected===id));
          button.onclick=()=>{selected=id;[...body.children].forEach(item=>item.setAttribute('aria-pressed',String(item===button)));feedback.textContent='';};body.append(button);
        }else{
          const row=node('div',undefined,'challenge-step'),text=rich('span',challenge.items[id]);
          const up=node('button','↑'),down=node('button','↓');up.type=down.type='button';up.setAttribute('aria-label',`Поднять шаг ${index+1}`);down.setAttribute('aria-label',`Опустить шаг ${index+1}`);up.disabled=index===0;down.disabled=index===order.length-1;
          const move=delta=>{[order[index],order[index+delta]]=[order[index+delta],order[index]];feedback.textContent='';draw();};up.onclick=()=>move(-1);down.onclick=()=>move(1);row.append(node('b',String(index+1)),text,up,down);body.append(row);
        }
      });
    };
    const reset=()=>{order=shuffled(challenge.items.map((_,i)=>i));if(challenge.kind==='order'&&order.every((id,i)=>id===challenge.answer[i]))order.push(order.shift());selected=null;feedback.textContent='';explanation.hidden=true;draw();};
    const check=node('button','Проверить'),show=node('button','Показать объяснение'),restart=node('button','Ещё раз');[check,show,restart].forEach(button=>button.type='button');
    check.onclick=()=>{
      if(challenge.kind==='choice'&&selected===null){feedback.textContent='Сначала выбери действие.';return;}
      const correct=challenge.kind==='choice'?selected===challenge.answer[0]:order.every((id,i)=>id===challenge.answer[i]);
      feedback.textContent=correct?'Миссия выполнена! ✨':'Попробуй ещё раз. Если застрял — открой объяснение.';
      if(correct){explanation.hidden=false;complete();root.classList.add('activity-complete');}
    };
    show.onclick=()=>{explanation.hidden=!explanation.hidden;};restart.onclick=reset;
    const actions=node('div',undefined,'lab-toolbar');actions.append(check,show,restart);root.append(actions,feedback,explanation);reset();return root;
  }
  function render(root,labs,challenges=[],modules=[]){
    const activities=[...(Array.isArray(labs)?labs:[]).map(data=>({kind:'lab',data})),...(Array.isArray(challenges)?challenges:[]).map(data=>({kind:'challenge',data})),...(Array.isArray(modules)?modules:[]).map(data=>({kind:'module',data}))];
    if(!activities.length)return;
    const headings=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const normalize=value=>String(value).toLocaleLowerCase().replace(/^\s*[\d.\s]+/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const fallback=node('section',undefined,'study-labs');fallback.append(node('h2','Игровая практика по теме'));
    const route=node('section',undefined,'study-route'),status=node('p'),progress=node('progress'),links=node('div',undefined,'activity-links');
    const completed=new Set();let total=0;const sync=()=>{status.textContent=`Исследовано: ${completed.size} из ${total}${total&&completed.size===total?' · Все миссии пройдены! 🌟':''}`;progress.max=Math.max(1,total);progress.value=completed.size;};
    route.append(node('h2','Твоя игровая лаборатория'),node('p','Крути параметры, оживляй формулы, проверяй прогнозы и собирай решения. Выполняй мини-миссии — отмечай свой прогресс.'),status,progress,links);
    activities.forEach(({kind,data},index)=>{
      try{
        const link=node('button',(kind==='lab'?'⚗ ':kind==='module'?'🎮 ':'◆ ')+data.title);link.type='button';
        const complete=()=>{completed.add(index);link.classList.add('completed');link.setAttribute('aria-label',data.title+' — пройдено');sync();};
        const view=kind==='lab'?labView(data,complete):kind==='module'?window.StudyModules.create(data,complete):challengeView(data,complete);
        total++;link.onclick=()=>view.scrollIntoView({behavior:'smooth',block:'center'});links.append(link);
        const topic=normalize(data.topic),heading=headings.find(item=>normalize(item.textContent)===topic);
        if(heading){let position=heading;while(position.nextElementSibling&&!headings.includes(position.nextElementSibling))position=position.nextElementSibling;position.after(view);}else fallback.append(view);
      }catch(_){fallback.append(node('p','Одну из активностей не удалось открыть. Остальные доступны.'));}
    });
    if(fallback.children.length>1)root.append(fallback);if(total)root.prepend(route);sync();
  }
  window.StudyLabs={evaluate,render};
})();
