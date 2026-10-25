const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
let user = null;
let selected = null;
let uploadController = null;
let generation = 0;
const materialMatch = window.location.pathname.match(/^\/materials\/(\d+)\/?$/);
const materialId = materialMatch ? materialMatch[1] : null;

async function openCurrentMaterial() {
  if (!materialId || !user) return;
  const version = generation;
  const data = await api(`/api/materials/${materialId}`);
  if (version !== generation) return;
  render(data);
  document.title = `${data.title} · Суть`;
  if (user.role === 'student') {
    await api(`/api/materials/${materialId}/view`, {method: 'POST'});
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {'X-Study-Request': '1', ...options.headers},
  });
  const data = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 && user) setUser(null);
    throw new Error(errorMessage(response, data, 'Проверьте заполненные поля.'));
  }
  return data;
}
async function readJson(response) {
  // A proxy or server crash may answer with HTML or an empty body instead of JSON.
  try { return await response.json(); } catch (_) { return null; }
}
function errorMessage(response, data, fallback) {
  if (typeof data?.detail === 'string') return data.detail;
  if (response.status === 413) return 'Файл слишком большой для сервера.';
  if (response.status >= 500) return 'Сервер временно недоступен. Попробуйте ещё раз через минуту.';
  return fallback;
}
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
function json(method, body) {
  return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
}
function notice(message) { $('notice').textContent = message; }
function setUser(value) {
  uploadController?.abort();
  uploadController = null;
  generation++;
  user = value;
  selected = null;
  $('auth').hidden = !!user;
  $('workspace').hidden = !user;
  $('logout').hidden = !user;
  $('teacher-upload').hidden = user?.role !== 'teacher' || !!materialId;
  $('hero').hidden = !!materialId;
  $('steps').hidden = !!materialId;
  $('library-panel').hidden = !!materialId || user?.role === 'admin';
  $('admin-panel').hidden = user?.role !== 'admin';
  $('back-library').hidden = !materialId;
  $('result').hidden = true;
  $('library').replaceChildren();
  $('statistics').replaceChildren();
  ['source', 'summary', 'ask', 'quiz', 'admin-groups', 'admin-group', 'admin-teacher'].forEach(id => $(id).replaceChildren());
  $('create-teacher').reset();
  $('material-url').value = '';
  $('title').textContent = '';
  $('material-author').textContent = '';
  $('account-label').textContent = user ? `${user.name} · ${({teacher: 'Преподаватель', student: 'Студент', admin: 'Администратор'})[user.role]}` : 'Личный кабинет';
  $('group-label').textContent = user?.role === 'student' ? `Группа: ${user.group}` : '';
  const groups = user?.groups || [];
  $('target-group').replaceChildren();
  const placeholder = node('option', 'Выберите группу'); placeholder.value = '';
  $('target-group').append(placeholder);
  groups.forEach(group => {
    const option = node('option', `${group.name} (#${group.id})`); option.value = group.id;
    $('target-group').append(option);
  });
  $('no-groups').hidden = groups.length !== 0;
  if (user?.role === 'teacher') {
    $('group-label').textContent = groups.length ? groups.map(g => `${g.name}: код регистрации ${g.invite_code}`).join(' · ') : 'Группы пока не назначены администратором.';
  }
}
async function refreshLibrary() {
  const version = generation;
  const materials = await api('/api/materials');
  if (version !== generation) return;
  $('library').replaceChildren();
  $('library-empty').hidden = materials.length !== 0;
  for (const material of materials) {
    const button = node('a', null, 'library-item');
    button.href = `/materials/${material.id}`;
    button.append(node('strong', material.title), node('span', `${material.teacher_name} · ${material.group_name}`, 'library-meta'));
    if (user.role === 'teacher') button.append(node('span', material.published ? 'Опубликован' : 'Черновик', material.published ? 'chip chip-live' : 'chip'));
    $('library').append(button);
  }
}
for (const [formId, endpoint] of [['login-form', 'login'], ['register-form', 'register']]) {
  $(formId).onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(event.target));
      setUser(await api('/api/auth/' + endpoint, json('POST', data)));
      event.target.reset();
      notice('');
      if (materialId) await openCurrentMaterial();
      else if (user.role === 'admin') await loadAdmin();
      else await refreshLibrary();
    } catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  };
}
$('logout').onclick = async () => {
  try { await api('/api/auth/logout', {method: 'POST'}); setUser(null); notice('Вы вышли из аккаунта.'); }
  catch (error) { notice(error.message); }
};
$('file').onchange = () => {
  const file = $('file').files[0];
  $('filename').textContent = file ? file.name : 'PDF (включая сканы), DOCX или TXT · до 10 МБ';
  $('submit').disabled = !file;
};
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(other => {
    other.classList.toggle('active', other === button);
    other.setAttribute('aria-selected', String(other === button));
    other.tabIndex = other === button ? 0 : -1;
  });
  ['source', 'summary', 'ask', 'quiz'].forEach(id => $(id).hidden = id !== button.dataset.tab);
  window.StudyPresentation?.enhance($(button.dataset.tab));
});
function render(data) {
  selected = data;
  $('material-url').value = new URL(`/materials/${data.id}`, window.location.origin).href;
  $('title').textContent = data.title;
  $('material-author').textContent = `Преподаватель: ${data.teacher_name} · Группа: ${data.group_name}`;
  $('statistics').hidden = true;
  $('teacher-actions').hidden = user.role !== 'teacher';
  $('publish').textContent = data.published ? 'Снять с публикации' : 'Опубликовать для группы';
  setStatusChip(data.published);
  renderSource(data);
  $('summary').replaceChildren();
  renderSummary($('summary'), data.summary);
  renderAsk(data);
  renderQuiz(data);
  $('result').hidden = false;
  typesetMath($('result'));
  document.querySelector('[data-tab="summary"]').click();
  $('result').scrollIntoView({behavior: 'smooth'});
}
function setStatusChip(published) {
  $('material-status').hidden = user.role !== 'teacher';
  $('material-status').textContent = published ? 'Опубликован для группы' : 'Черновик — студенты не видят';
  $('material-status').classList.toggle('chip-live', !!published);
}
document.querySelector('[role=tablist]').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const next = tabs[(tabs.indexOf(document.activeElement) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.click(); next.focus();
});
function renderSource(data) {
  const root = $('source');
  root.replaceChildren(node('h3', 'Методичка полностью'));
  if (!data.source) {
    root.append(node('p', 'Полный текст этого материала не сохранён: он был загружен до обновления. Загрузите методичку заново, чтобы видеть её целиком.'));
    return;
  }
  const pages = Math.max(1, Math.round(data.source.length / 1800));
  root.append(node('p', `Текст извлечён из файла без изменений; для сканов — результат распознавания. Около ${pages} стр., ${data.source.length.toLocaleString('ru-RU')} символов.`, 'source-note'),
    node('div', data.source, 'source-text'));
}
function questionItem(item) {
  const article = node('article', null, 'qa-item');
  const question = node('div', null, 'qa-bubble qa-question');
  question.append(node('p', user.role === 'teacher' ? `${item.author_name} · ${date(item.created_at)}` : date(item.created_at), 'qa-meta'), node('p', item.question, 'qa-text'));
  const answer = node('div', null, 'qa-bubble qa-answer');
  const body = node('div', null, 'qa-body');
  renderSummary(body, item.answer);
  answer.append(node('p', 'Ответ по методичке', 'qa-meta'), body);
  article.append(question, answer);
  return article;
}
function pendingItem(text) {
  const article = node('article', null, 'qa-item');
  const question = node('div', null, 'qa-bubble qa-question');
  question.append(node('p', 'Только что', 'qa-meta'), node('p', text, 'qa-text'));
  const answer = node('div', null, 'qa-bubble qa-answer qa-pending');
  answer.setAttribute('aria-label', 'Ищем ответ в методичке');
  answer.append(node('span'), node('span'), node('span'));
  article.append(question, answer);
  return article;
}
function renderAsk(data) {
  const root = $('ask');
  root.replaceChildren(node('h3', 'Вопрос по методичке'), node('p', user.role === 'teacher'
    ? 'Здесь студенты задают вопросы по материалу. Ниже — все их вопросы и ответы. Задайте свой вопрос, чтобы проверить, как помощник отвечает.'
    : 'Спроси, что непонятно. Ответ строится только по тексту этой методички — если в ней ответа нет, помощник честно скажет.', 'ask-intro'));
  const history = node('div', null, 'qa-history');
  history.setAttribute('aria-live', 'polite');
  const empty = node('p', user.role === 'teacher' ? 'Вопросов пока нет.' : 'Здесь появятся твои вопросы и ответы.', 'qa-empty');
  const form = node('form', null, 'ask-form');
  const field = node('textarea');
  field.required = true; field.minLength = 3; field.maxLength = 1000; field.rows = 3;
  field.placeholder = 'Например: чем вторая нормальная форма отличается от третьей?';
  field.setAttribute('aria-label', 'Вопрос по методичке');
  const footer = node('div', null, 'ask-footer');
  const counter = node('span', '0 / 1000', 'ask-counter');
  const submit = node('button', 'Спросить');
  footer.append(node('span', 'Ctrl + Enter — отправить', 'ask-hint'), counter, submit);
  const status = node('p', null, 'ask-status'); status.setAttribute('role', 'status');
  form.append(field, footer, status);
  root.append(history, empty, form);
  const show = (item, replace) => {
    const article = questionItem(item);
    if (replace) replace.replaceWith(article); else history.append(article);
    empty.hidden = true;
    typesetMath(article); window.StudyPresentation?.enhance(article);
    return article;
  };
  field.oninput = () => { counter.textContent = `${field.value.length} / 1000`; };
  field.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit(); };
  const version = generation;
  api(`/api/materials/${data.id}/questions`).then(items => {
    if (version !== generation || selected?.id !== data.id) return;
    items.forEach(item => show(item));
  }).catch(error => { status.textContent = error.message; });
  form.onsubmit = async event => {
    event.preventDefault();
    const text = field.value.trim();
    if (text.length < 3) { status.textContent = 'Вопрос слишком короткий.'; return; }
    submit.disabled = true; status.textContent = '';
    const pending = pendingItem(text);
    history.append(pending); empty.hidden = true;
    pending.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    try {
      const item = await api(`/api/materials/${data.id}/questions`, json('POST', {question: text}));
      if (version !== generation || selected?.id !== data.id) return;
      show(item, pending); field.value = ''; field.oninput();
    } catch (error) {
      pending.remove(); empty.hidden = history.children.length > 0;
      status.textContent = error.message;
    } finally { submit.disabled = false; field.focus(); }
  };
}
function renderQuiz(data) {
  $('quiz').replaceChildren();
  if (user.role === 'teacher') {
    renderQuizEditor(data);

    return;
  }
  const form = node('form');
  const answers = Array(data.quiz.length).fill(null);
  const sections = [];
  data.quiz.forEach((question, index) => {
    const section = node('fieldset', null, 'question');
    section.append(richNode('legend', `${index + 1}. ${question.question}`));
    question.options.forEach((option, choice) => {
      const label = node('label', null, 'quiz-choice');
      const input = node('input');
      input.type = 'radio'; input.name = `question-${index}`; input.value = choice; input.required = true;
      input.onchange = () => answers[index] = choice;
      label.append(input, richNode('span', option));
      section.append(label);
    });
    sections.push(section);
    form.append(section);
  });
  const submit = node('button', 'Проверить и сохранить результат');
  const feedback = node('p');
  feedback.setAttribute('role', 'status');
  form.append(submit, feedback);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = await api(`/api/materials/${data.id}/attempts`, json('POST', {answers, quiz_revision: data.quiz_revision}));
      feedback.textContent = `Результат: ${result.score} из ${result.total}. Сохранён для преподавателя.`;
      result.feedback.forEach((item, index) => {
        sections[index].disabled = true;
        sections[index].append(richNode('p', `Правильный ответ: ${data.quiz[index].options[item.answer]}\n${item.explanation}`, 'feedback'));
      });
      typesetMath($('quiz'));
    } catch (error) { feedback.textContent = error.message; submit.disabled = false; }
  };
  $('quiz').append(form);
}
$('publish').onclick = async () => {
  if (!selected) return;
  try {
    const result = await api(`/api/materials/${selected.id}`, json('PATCH', {published: !selected.published}));
    selected.published = result.published;
    $('publish').textContent = result.published ? 'Снять с публикации' : 'Опубликовать для группы';
    setStatusChip(result.published);
    notice(result.published ? 'Материал опубликован для вашей группы.' : 'Материал скрыт от студентов.');
  } catch (error) { notice(error.message); }
};
$('show-stats').onclick = async () => {
  if (!selected) return;
  const version = generation;
  const id = selected.id;
  try {
    const rows = await api(`/api/materials/${id}/stats`);
    if (version !== generation || selected?.id !== id) return;
    $('statistics').replaceChildren(node('h3', 'Активность студентов'), node('p', 'Просмотр означает открытие материала, а не подтверждённое прочтение.'));
    if (!rows.length) $('statistics').append(node('p', 'В группе пока нет студентов.'));
    else {
      const table = node('table');
      const head = node('tr');
      ['Студент', 'Первый просмотр', 'Последний просмотр', 'Открытий', 'Попыток', 'Последний результат'].forEach(title => head.append(node('th', title)));
      const thead = node('thead'); thead.append(head); table.append(thead);
      const tbody = node('tbody');
      rows.forEach(row => {
        const tr = node('tr');
        [row.name + ' (' + row.username + ')', date(row.first_view), date(row.last_view), row.views, row.attempts, row.last_score === null ? '—' : `${row.last_score}/${row.total} (версия ${row.last_quiz_revision}${row.last_quiz_revision !== row.current_quiz_revision ? ', прежний тест' : ''})`].forEach(value => tr.append(node('td', String(value))));
        tbody.append(tr);
      });
      table.append(tbody); $('statistics').append(table);
    }
    $('statistics').hidden = false;
  } catch (error) { notice(error.message); }
};
async function streamMaterial(form, onEvent, signal) {
  const response = await fetch('/api/material?stream=true', {method: 'POST', body: form, signal, headers: {'X-Study-Request': '1'}});
  if (!response.ok) throw new Error(errorMessage(response, await readJson(response), 'Не удалось обработать материал.'));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', complete = false;
  const accept = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.detail);
    if (event.type === 'complete') complete = true;
    onEvent(event);
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      pending += decoder.decode(value, {stream: !done});
      let boundary;
      while ((boundary = pending.indexOf('\n')) !== -1) { accept(pending.slice(0, boundary)); pending = pending.slice(boundary + 1); }
      if (done) break;
    }
    if (pending.trim()) accept(pending);
    if (!complete) throw new Error('Соединение прервалось до сохранения материала. Повторите загрузку.');
  } finally { reader.releaseLock(); }
}
$('upload').onsubmit = async event => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { $('status').textContent = 'Файл больше 10 МБ. Выбери отдельную главу.'; return; }
  if (!$('target-group').value) { $('status').textContent = 'Администратор должен назначить вам группу.'; return; }
  const version = generation;
  $('submit').disabled = true;
  const started = Date.now();
  const progress = () => {
    const seconds = Math.round((Date.now() - started) / 1000);
    $('status').textContent = `Читаем методичку и выделяем суть… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. Большие тексты обрабатываются по частям, сканы распознаются до пяти минут.`;
  };
  progress();
  const ticker = setInterval(() => { if (version === generation) progress(); }, 1000);
  $('status').classList.add('busy');
  const form = new FormData(); form.append('file', file); form.append('group_id', $('target-group').value);
  try {
    uploadController = new AbortController();
    await streamMaterial(form, event => {
      if (version !== generation) return;
      if (event.type === 'complete') {
        window.location.assign(`/materials/${event.material.id}`);
      }
    }, uploadController.signal);
  } catch (error) {
    if (version === generation && error.name !== 'AbortError') $('status').textContent = error.message;
  } finally {
    clearInterval(ticker); $('status').classList.remove('busy');
    if (version === generation) { $('submit').disabled = false; uploadController = null; }
  }
};
(async () => {
  try {
    setUser(await api('/api/auth/me'));
    if (materialId) await openCurrentMaterial();
    else if (user.role === 'admin') await loadAdmin();
    else await refreshLibrary();
  }
  catch (error) { if (user) notice(error.message); }
})();


function labeledField(parent, caption, element) {
  const label = node('label', caption);
  label.append(element); parent.append(label);
  return element;
}

function renderQuizEditor(data) {
  $('quiz').append(node('p', 'Редактируй вопросы, варианты и правильные ответы. Сохранение изменений снимает материал с публикации. Старые результаты сохранятся с номером версии теста.'));
  const form = node('form', null, 'quiz-editor');
  const container = node('div');
  const rows = new Map();
  function addQuestion(question) {
    if (rows.size >= 50) { notice('Максимум 50 вопросов.'); return; }
    const section = node('fieldset', null, 'editor-question');
    const text = node('textarea'); text.value = question.question; text.required = true; text.maxLength = 2000;
    labeledField(section, 'Вопрос', text);
    const options = question.options.map((value, index) => {
      const input = node('input'); input.value = value; input.required = true; input.maxLength = 2000;
      return labeledField(section, `Вариант ${index + 1}`, input);
    });
    const answer = node('select');
    options.forEach((_, index) => { const option = node('option', `Вариант ${index + 1}`); option.value = index; answer.append(option); });
    answer.value = question.answer;
    labeledField(section, 'Правильный ответ', answer);
    const explanation = node('textarea'); explanation.value = question.explanation; explanation.required = true; explanation.maxLength = 3000;
    labeledField(section, 'Объяснение ответа', explanation);
    const remove = node('button', 'Удалить вопрос'); remove.type = 'button';
    remove.onclick = () => { rows.delete(section); section.remove(); };
    section.append(remove);
    rows.set(section, {text, options, answer, explanation}); container.append(section);
  }
  data.quiz.forEach(addQuestion);
  const add = node('button', 'Добавить вопрос'); add.type = 'button';
  add.onclick = () => addQuestion({question: '', options: ['', '', '', ''], answer: 0, explanation: ''});
  const save = node('button', 'Сохранить тест');
  const status = node('p'); status.setAttribute('role', 'status');
  form.append(container, add, save, status);
  form.onsubmit = async event => {
    event.preventDefault(); save.disabled = true;
    const quiz = [...rows.values()].map(row => ({question: row.text.value.trim(), options: row.options.map(input => input.value.trim()), answer: Number(row.answer.value), explanation: row.explanation.value.trim()}));
    try {
      const updated = await api(`/api/materials/${data.id}/quiz`, json('PUT', {quiz, quiz_revision: data.quiz_revision}));
      render(updated); document.querySelector('[data-tab="quiz"]').click();
      notice('Тест сохранён. После проверки опубликуйте материал для студентов.');
    } catch (error) { status.textContent = error.message; save.disabled = false; }
  };
  $('quiz').append(form);
}

async function loadAdmin() {
  const version = generation;
  const [groups, teachers] = await Promise.all([api('/api/admin/groups'), api('/api/admin/teachers')]);
  if (version !== generation) return;
  $('admin-group').replaceChildren(); $('admin-teacher').replaceChildren(); $('admin-groups').replaceChildren();
  groups.forEach(group => { const option = node('option', `${group.name} (#${group.id})`); option.value = group.id; $('admin-group').append(option); });
  teachers.forEach(teacher => { const option = node('option', `${teacher.name} (${teacher.username})`); option.value = teacher.id; $('admin-teacher').append(option); });
  for (const group of groups) {
    const section = node('section', null, 'admin-group');
    section.append(node('h3', `${group.name} (#${group.id})`), node('p', `Код регистрации студентов: ${group.invite_code}`));
    if (!group.teacher_ids.length) section.append(node('p', 'Преподаватели не назначены.'));
    group.teacher_ids.forEach(id => {
      const teacher = teachers.find(item => item.id === id);
      const row = node('div', null, 'assignment-row');
      row.append(node('span', teacher ? `${teacher.name} (${teacher.username})` : `Преподаватель #${id}`));
      const remove = node('button', 'Убрать из группы');
      remove.onclick = async () => {
        remove.disabled = true;
        try { await api(`/api/admin/groups/${group.id}/teachers/${id}`, {method: 'DELETE'}); await loadAdmin(); notice('Назначение удалено.'); }
        catch (error) { notice(error.message); remove.disabled = false; }
      };
      row.append(remove); section.append(row);
    });
    $('admin-groups').append(section);
  }
}
for (const [formId, endpoint] of [['create-group', 'groups'], ['create-teacher', 'teachers']]) {
  $(formId).onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try {
      await api(`/api/admin/${endpoint}`, json('POST', Object.fromEntries(new FormData(event.target))));
      event.target.reset(); await loadAdmin(); notice('Создано. Теперь можно назначить преподавателя в группу.');
    } catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  };
}
$('assign-teacher').onsubmit = async event => {
  event.preventDefault();
  try {
    await api(`/api/admin/groups/${$('admin-group').value}/teachers/${$('admin-teacher').value}`, {method: 'PUT'});
    await loadAdmin(); notice('Преподаватель назначен в группу.');
  } catch (error) { notice(error.message); }
};


function renderSummary(container, text) {
  if (window.StudyPresentation) { window.StudyPresentation.renderSummary(container, text); return; }
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) container.append(node('p', paragraph.join('\n'), 'summary-text'));
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) { flush(); container.append(node('h3', heading[1])); }
    else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
}


function typesetMath(root) {
  window.StudyPresentation?.math(root);
}


function formatInline(container, text) {
  if (window.StudyPresentation) window.StudyPresentation.inline(container, text);
  else container.textContent = text;
}

function richNode(tag, text, className) {
  const result = node(tag, undefined, className);
  formatInline(result, text);
  return result;
}
