const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
let user = null;
let selected = null;
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
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && user) setUser(null);
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Проверьте заполненные поля.');
  }
  return data;
}
function json(method, body) {
  return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
}
function notice(message) { $('notice').textContent = message; }
function setUser(value) {
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
  ['summary', 'cards', 'quiz', 'admin-groups', 'admin-group', 'admin-teacher'].forEach(id => $(id).replaceChildren());
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
    const button = node('a', material.title + ` · Преподаватель: ${material.teacher_name} · ${material.group_name}` + (user.role === 'teacher' ? (material.published ? ' · Опубликован' : ' · Черновик') : ''), 'library-item');
    button.href = `/materials/${material.id}`;
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
  document.querySelectorAll('[data-tab]').forEach(other => other.classList.toggle('active', other === button));
  ['summary', 'cards', 'quiz'].forEach(id => $(id).hidden = id !== button.dataset.tab);
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
  $('summary').replaceChildren();
  renderSummary($('summary'), data.summary);
  window.StudyLabs?.render($('summary'), data.labs, data.challenges);
  $('summary').append(node('h3', 'Главные мысли для повторения'));
  const list = node('ul');
  data.key_points.forEach(point => list.append(richNode('li', point)));
  $('summary').append(list);
  renderCardActivities(data.cards);
  renderQuiz(data);
  $('result').hidden = false;
  typesetMath($('result'));
  document.querySelector('[data-tab="summary"]').click();
  $('result').scrollIntoView({behavior: 'smooth'});
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
    notice(result.published ? 'Материал опубликован для вашей группы.' : 'Материал скрыт от студентов.');
  } catch (error) { notice(error.message); }
};
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
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
$('upload').onsubmit = async event => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { $('status').textContent = 'Файл больше 10 МБ. Выбери отдельную главу.'; return; }
  if (!$('target-group').value) { $('status').textContent = 'Администратор должен назначить вам группу.'; return; }
  const version = generation;
  $('submit').disabled = true;
  $('status').textContent = 'Читаем материал и готовим задания… Готовим подробный конспект с объяснениями. Большие тексты обрабатываются по разделам. Для сканов OCR может занять до пяти минут, затем потребуется время на нейросеть.';
  const form = new FormData(); form.append('file', file); form.append('group_id', $('target-group').value);
  try {
    const data = await api('/api/material', {method: 'POST', body: form});
    if (version !== generation) return;
    window.location.assign(`/materials/${data.id}`);
  } catch (error) { $('status').textContent = error.message; }
  finally { $('submit').disabled = false; }
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


function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function matchingCards(cards) {
  // Merge ambiguous duplicate terms, then identical explanations, without losing their text.
  const normalize = value => value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const terms = new Map();
  cards.forEach(card => {
    const key = normalize(card.term);
    if (!terms.has(key)) terms.set(key, {term: card.term, explanations: new Map()});
    terms.get(key).explanations.set(normalize(card.explanation), card.explanation);
  });
  const explanations = new Map();
  terms.forEach(card => {
    const explanation = [...card.explanations.values()].join('\n\n');
    const key = normalize(explanation);
    if (!explanations.has(key)) explanations.set(key, {terms: [], explanation});
    explanations.get(key).terms.push(card.term);
  });
  return [...explanations.values()].map((card, id) => ({id, term: card.terms.join(' / '), explanation: card.explanation}));
}

function renderCardActivities(cards) {
  const root = $('cards');
  root.replaceChildren(node('h3', 'Закрепи понятия на практике'));
  if (!cards.length) { root.append(node('p', 'Для этого материала пока нет карточек.')); return; }
  const modes = node('div', null, 'card-modes');
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Режим карточек');
  const play = node('button', 'Соедини пары'); play.type = 'button';
  const study = node('button', 'Повторить карточки'); study.type = 'button';
  const game = node('section', null, 'matching-game');
  const review = node('section', null, 'card-review'); review.hidden = true;
  function selectMode(isGame) {
    game.hidden = !isGame; review.hidden = isGame;
    play.setAttribute('aria-pressed', String(isGame)); study.setAttribute('aria-pressed', String(!isGame));
    play.classList.toggle('active', isGame); study.classList.toggle('active', !isGame);
  }
  play.onclick = () => selectMode(true); study.onclick = () => selectMode(false);
  modes.append(play, study); root.append(modes, game, review);
  selectMode(true);
  renderMatchingGame(game, matchingCards(cards));
  renderCardReview(review, cards);
}

function renderMatchingGame(root, cards) {
  root.replaceChildren(node('p', 'Выбери термин и подходящее объяснение. Можно начинать с любой колонки. Найди все пары!'));
  const score = node('p', null, 'match-score');
  const progress = node('progress'); progress.max = cards.length; progress.value = 0;
  progress.setAttribute('aria-label', 'Количество найденных пар');
  const board = node('div', null, 'match-board');
  const termColumn = node('div', null, 'match-column');
  const explanationColumn = node('div', null, 'match-column');
  termColumn.append(node('h4', 'Термины')); explanationColumn.append(node('h4', 'Объяснения'));
  const feedback = node('p', 'Выбери первую пару.', 'match-feedback');
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const restart = node('button', 'Перемешать и начать заново'); restart.type = 'button';
  restart.onclick = () => { renderMatchingGame(root, cards); root.querySelector('.match-term').focus(); };
  let term = null, explanation = null, mistakes = 0, mismatch = false;
  const matched = new Set();
  const termButtons = new Map(), explanationButtons = new Map();
  function paint() {
    score.textContent = `Найдено: ${matched.size} из ${cards.length} · Ошибок: ${mistakes}`;
    progress.value = matched.size;
    for (const [buttons, chosen] of [[termButtons, term], [explanationButtons, explanation]]) {
      buttons.forEach((button, id) => {
        const solved = matched.has(id), selected = chosen === id && !solved;
        button.disabled = solved;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('selected', selected);
        button.classList.toggle('mismatch', mismatch && selected);
        button.classList.toggle('matched', solved);
        const value = button.classList.contains('match-term') ? cards[id].term : cards[id].explanation;
        formatInline(button, solved ? `✓ ${value}` : value);
      });
    }
  }
  function choose(side, id, event) {
    if (matched.has(id)) return;
    if (mismatch) { term = null; explanation = null; mismatch = false; }
    if (side === 'term') term = term === id ? null : id;
    else explanation = explanation === id ? null : id;
    if (term !== null && explanation !== null) {
      if (term === explanation) {
        matched.add(term); term = null; explanation = null;
        feedback.textContent = matched.size === cards.length
          ? `Все пары найдены! ${mistakes === 0 ? 'Без ошибок — отличный результат.' : `Ошибок: ${mistakes}. Повтори сложные понятия и попробуй ещё раз.`}`
          : `Верно! Найдено ${matched.size} из ${cards.length}. Продолжай.`;
      } else {
        mistakes++; mismatch = true;
        feedback.textContent = 'Пока не совпало. Пара отмечена словами «Не совпало» и цветом. Выбери новую пару — можно попробовать ещё раз.';
      }
    } else feedback.textContent = term !== null ? 'Теперь выбери объяснение.' : explanation !== null ? 'Теперь выбери термин.' : 'Выбери первую пару.';
    paint();
    if (mismatch) {
      formatInline(termButtons.get(term), 'Не совпало: ' + cards[term].term);
      formatInline(explanationButtons.get(explanation), 'Не совпало: ' + cards[explanation].explanation);
    }
    typesetMath(root);
    if (event.detail === 0 && term === null && explanation === null && !mismatch) {
      const next = [...termButtons.values()].find(button => !button.disabled);
      (next || restart).focus();
    }
  }
  for (const [side, column, buttons] of [['term', termColumn, termButtons], ['explanation', explanationColumn, explanationButtons]]) {
    shuffled(cards).forEach(card => {
      const button = node('button', side === 'term' ? card.term : card.explanation, `match-item match-${side}`);
      button.type = 'button'; button.onclick = event => choose(side, card.id, event);
      buttons.set(card.id, button); column.append(button);
    });
  }
  board.append(termColumn, explanationColumn);
  root.append(score, progress, board, feedback, restart);
  paint();
  typesetMath(root);
}

function renderCardReview(root, cards) {
  let deck = [...cards], index = 0, flipped = false;
  const counter = node('p', null, 'review-count');
  const flip = node('button', null, 'study-flip'); flip.type = 'button';
  const hint = node('p', 'Вспомни объяснение, затем нажми на карточку, чтобы проверить себя.');
  const controls = node('div', null, 'review-controls');
  const previous = node('button', '← Назад'), next = node('button', 'Далее →'), mix = node('button', 'Перемешать');
  [previous, next, mix].forEach(button => button.type = 'button');
  function update() {
    const card = deck[index];
    counter.textContent = `Карточка ${index + 1} из ${deck.length}`;
    const caption = node('span', flipped ? 'ОБЪЯСНЕНИЕ' : 'ТЕРМИН', 'flip-caption');
    const body = richNode('span', flipped ? card.explanation : card.term, 'flip-text');
    flip.replaceChildren(caption, body);
    flip.setAttribute('aria-pressed', String(flipped));
    flip.classList.toggle('is-flipped', flipped);
    typesetMath(flip);
    previous.disabled = index === 0; next.disabled = index === deck.length - 1;
  }
  flip.onclick = () => { flipped = !flipped; update(); };
  previous.onclick = () => { if (index > 0) index--; flipped = false; update(); };
  next.onclick = () => { if (index < deck.length - 1) index++; flipped = false; update(); };
  mix.onclick = () => { deck = shuffled(deck); index = 0; flipped = false; update(); };
  controls.append(previous, next, mix); root.append(counter, hint, flip, controls);
  update();
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
