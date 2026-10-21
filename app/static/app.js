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
  $('teacher-upload').hidden = user?.role !== 'teacher';
  $('result').hidden = true;
  $('library').replaceChildren();
  $('statistics').replaceChildren();
  $('account-label').textContent = user ? `${user.name} · ${user.role === 'teacher' ? 'Преподаватель' : 'Студент'}` : 'Личный кабинет';
  $('group-label').textContent = user ? `Группа: ${user.group}${user.invite_code ? ' · Код регистрации студентов: ' + user.invite_code : ''}` : '';
}
async function refreshLibrary() {
  const version = generation;
  const materials = await api('/api/materials');
  if (version !== generation) return;
  $('library').replaceChildren();
  $('library-empty').hidden = materials.length !== 0;
  for (const material of materials) {
    const button = node('button', material.title + (user.role === 'teacher' ? (material.published ? ' · Опубликован' : ' · Черновик') : ''), 'library-item');
    button.onclick = async () => {
      try {
        const data = await api(`/api/materials/${material.id}`);
        if (version !== generation) return;
        render(data);
        if (user.role === 'student') {
          await api(`/api/materials/${material.id}/view`, {method: 'POST'});
        }
        notice('');
      } catch (error) { notice(error.message); }
    };
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
      await refreshLibrary();
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
  $('filename').textContent = file ? file.name : 'PDF, DOCX или TXT · до 10 МБ';
  $('submit').disabled = !file;
};
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(other => other.classList.toggle('active', other === button));
  ['summary', 'cards', 'quiz'].forEach(id => $(id).hidden = id !== button.dataset.tab);
});
function render(data) {
  selected = data;
  $('title').textContent = data.title;
  $('statistics').hidden = true;
  $('teacher-actions').hidden = user.role !== 'teacher';
  $('publish').textContent = data.published ? 'Снять с публикации' : 'Опубликовать для группы';
  $('summary').replaceChildren(node('p', data.summary), node('h3', 'Главные мысли'));
  const list = node('ul');
  data.key_points.forEach(point => list.append(node('li', point)));
  $('summary').append(list);
  $('cards').replaceChildren(node('p', 'Нажми на карточку, чтобы увидеть объяснение.'));
  data.cards.forEach(card => {
    const button = node('button', card.term, 'card');
    let open = false;
    button.onclick = () => {
      open = !open;
      button.textContent = open ? card.explanation : card.term;
      button.setAttribute('aria-pressed', String(open));
    };
    $('cards').append(button);
  });
  renderQuiz(data);
  $('result').hidden = false;
  document.querySelector('[data-tab="summary"]').click();
  $('result').scrollIntoView({behavior: 'smooth'});
}
function renderQuiz(data) {
  $('quiz').replaceChildren();
  if (user.role === 'teacher') {
    data.quiz.forEach(q => {
      $('quiz').append(node('h3', q.question), node('p', `Ответ: ${q.options[q.answer]}\n${q.explanation}`));
    });
    return;
  }
  const form = node('form');
  const answers = Array(data.quiz.length).fill(null);
  const sections = [];
  data.quiz.forEach((question, index) => {
    const section = node('fieldset', null, 'question');
    section.append(node('legend', `${index + 1}. ${question.question}`));
    question.options.forEach((option, choice) => {
      const label = node('label', null, 'quiz-choice');
      const input = node('input');
      input.type = 'radio'; input.name = `question-${index}`; input.value = choice; input.required = true;
      input.onchange = () => answers[index] = choice;
      label.append(input, document.createTextNode(option));
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
      const result = await api(`/api/materials/${data.id}/attempts`, json('POST', {answers}));
      feedback.textContent = `Результат: ${result.score} из ${result.total}. Сохранён для преподавателя.`;
      result.feedback.forEach((item, index) => {
        sections[index].disabled = true;
        sections[index].append(node('p', `Правильный ответ: ${data.quiz[index].options[item.answer]}\n${item.explanation}`, 'feedback'));
      });
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
    await refreshLibrary();
    notice(result.published ? 'Материал опубликован для вашей группы.' : 'Материал скрыт от студентов.');
  } catch (error) { notice(error.message); }
};
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
$('show-stats').onclick = async () => {
  if (!selected) return;
  try {
    const rows = await api(`/api/materials/${selected.id}/stats`);
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
        [row.name + ' (' + row.username + ')', date(row.first_view), date(row.last_view), row.views, row.attempts, row.last_score === null ? '—' : `${row.last_score}/${row.total}`].forEach(value => tr.append(node('td', String(value))));
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
  const version = generation;
  $('submit').disabled = true;
  $('status').textContent = 'Читаем материал и готовим задания…';
  const form = new FormData(); form.append('file', file);
  try {
    const data = await api('/api/material', {method: 'POST', body: form});
    if (version !== generation) return;
    render(data); await refreshLibrary();
    $('status').textContent = 'Черновик сохранён. Проверь содержание и опубликуй для группы.';
  } catch (error) { $('status').textContent = error.message; }
  finally { $('submit').disabled = false; }
};
(async () => {
  try { setUser(await api('/api/auth/me')); await refreshLibrary(); }
  catch (error) { if (user) notice(error.message); }
})();
