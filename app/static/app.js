const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const e=document.createElement(tag); if(text)e.textContent=text;if(cls)e.className=cls;return e; };
$('file').addEventListener('change',()=>{const f=$('file').files[0];$('filename').textContent=f?f.name:'PDF, DOCX или TXT · до 10 МБ';$('submit').disabled=!f;});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));['summary','cards','quiz'].forEach(id=>$(id).hidden=id!==b.dataset.tab);});
function render(data){
 $('title').textContent=data.title;
 $('summary').replaceChildren(node('p',data.summary),node('h3','Главные мысли'));
 const ul=node('ul');data.key_points.forEach(p=>ul.append(node('li',p)));$('summary').append(ul);
 $('cards').replaceChildren(node('p','Нажми на карточку, чтобы увидеть объяснение.'));
 data.cards.forEach(c=>{const b=node('button',c.term,'card');let open=false;b.onclick=()=>{open=!open;b.textContent=open?c.explanation:c.term;b.setAttribute('aria-pressed',String(open));};$('cards').append(b);});
 $('quiz').replaceChildren();let answered=0,score=0;const total=node('p',`Отвечено: 0 из ${data.quiz.length}`);$('quiz').append(total);
 data.quiz.forEach((q,i)=>{const section=node('section',null,'question');section.append(node('h3',`${i+1}. ${q.question}`));const buttons=[];q.options.forEach((option,index)=>{const b=node('button',option,'option');buttons.push(b);b.onclick=()=>{buttons.forEach((x,j)=>{x.disabled=true;if(j===q.answer)x.classList.add('correct');});if(index!==q.answer)b.classList.add('wrong');else score++;answered++;section.append(node('p',q.explanation,'feedback'));total.textContent=answered===data.quiz.length?`Результат: ${score} из ${data.quiz.length}`:`Отвечено: ${answered} из ${data.quiz.length}`;};section.append(b);});$('quiz').append(section);});
 $('result').hidden=false;document.querySelector('[data-tab="summary"]').click();$('result').scrollIntoView({behavior:'smooth'});
}
$('upload').addEventListener('submit',async e=>{e.preventDefault();const f=$('file').files[0];if(!f)return;if(f.size>10*1024*1024){$('status').textContent='Файл больше 10 МБ. Выбери отдельную главу.';return;}$('submit').disabled=true;$('status').textContent='Читаем материал и готовим задания…';$('result').hidden=true;const form=new FormData();form.append('file',f);try{const res=await fetch('/api/material',{method:'POST',body:form});const data=await res.json();if(!res.ok)throw new Error(typeof data.detail==='string'?data.detail:'Не удалось обработать материал.');render(data);$('status').textContent='Готово. Можно переходить к изучению.';}catch(err){$('status').textContent=err.message||'Ошибка соединения. Попробуй ещё раз.';}finally{$('submit').disabled=false;}});
