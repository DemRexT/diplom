const $ = id => document.getElementById(id);
const I18N = window.StudyI18n;
const t = (key, vars) => I18N.t(key, vars);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
let selected = null;
let generation = 0;
let activeTab = 'interactive';
let translation = null;
let chatField = null;
const materialMatch = window.location.pathname.match(/^\/materials\/(\d+)\/?$/);
const materialId = materialMatch ? materialMatch[1] : null;

// The creator's browser keeps a secret edit key per material; without it the page is read-only.
function editKeys() {
  try { return JSON.parse(localStorage.getItem('study-edit-keys') || '{}') || {}; } catch (_) { return {}; }
}
function saveEditKey(id, key) {
  try { localStorage.setItem('study-edit-keys', JSON.stringify({...editKeys(), [id]: key})); } catch (_) { /* Editing works in this tab only. */ }
  sessionKeys[id] = key;
}
const sessionKeys = {};
const editKey = id => sessionKeys[id] || editKeys()[id] || '';
const editHash = window.location.hash.match(/^#edit=([\w-]+)$/);
if (materialId && editHash) {
  saveEditKey(materialId, editHash[1]);
  history.replaceState(null, '', window.location.pathname);  // Keep the key out of the visible address.
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {'X-Study-Request': '1', 'X-Lang': I18N.lang, ...(materialId ? {'X-Edit-Key': editKey(materialId)} : {}), ...options.headers},
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(response, data, t('checkFields')));
  return data;
}
async function readJson(response) {
  // A proxy or server crash may answer with HTML or an empty body instead of JSON.
  try { return await response.json(); } catch (_) { return null; }
}
function errorMessage(response, data, fallback) {
  if (typeof data?.detail === 'string') return data.detail;
  if (response.status === 413) return t('serverTooBig');
  if (response.status >= 500) return t('serverDown');
  return fallback;
}
const date = value => value ? new Date(value).toLocaleString(I18N.lang === 'en' ? 'en-GB' : 'ru-RU') : '—';
const clock = started => {
  const seconds = Math.round((Date.now() - started) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function json(method, body) {
  return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
}
function notice(message) { $('notice').textContent = message; }

// ---- Long operations (upload, translation) answer with NDJSON: heartbeat… then complete or error.
async function readProgress(response, onComplete) {
  if (!response.ok) throw new Error(errorMessage(response, await readJson(response), t('uploadFailed')));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', complete = false;
  const accept = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.detail);
    if (event.type === 'complete') { complete = true; onComplete(event.material); }
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
    if (!complete) throw new Error(t('streamCut'));
  } finally { reader.releaseLock(); }
}

// ---- Page layout: the home page uploads a guide, /materials/<id> shows one material.
function setupPage() {
  $('material-upload').hidden = !!materialId;
  $('hero').hidden = !!materialId;
  $('steps').hidden = !!materialId;
  $('back-home').hidden = !materialId;
}
$('file').onchange = () => {
  const file = $('file').files[0];
  $('filename').textContent = file ? file.name : t('fileHint');
  $('submit').disabled = !file;
};
$('upload').onsubmit = async event => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { $('status').textContent = t('tooBig'); return; }
  $('submit').disabled = true;
  const started = Date.now();
  const progress = () => { $('status').textContent = t('progress', {time: clock(started)}); };
  progress();
  const ticker = setInterval(progress, 1000);
  $('status').classList.add('busy');
  const form = new FormData(); form.append('file', file); form.append('lang', I18N.lang);
  try {
    const response = await fetch('/api/material?stream=true', {method: 'POST', body: form, headers: {'X-Study-Request': '1', 'X-Lang': I18N.lang}});
    await readProgress(response, material => {
      saveEditKey(material.id, material.edit_key);
      window.location.assign(`/materials/${material.id}`);
    });
  } catch (error) {
    $('status').textContent = error.message;
    $('submit').disabled = false;
  } finally {
    clearInterval(ticker); $('status').classList.remove('busy');
  }
};

// ---- Material page
async function openMaterial() {
  const version = ++generation;
  const data = await api(`/api/materials/${materialId}?lang=${I18N.lang}`);
  if (version !== generation) return;
  render(data);
  if (data.lang !== I18N.lang) translate();
  else { translation?.abort(); $('translation').hidden = true; }
}

async function translate() {
  const lang = I18N.lang, version = generation;
  translation?.abort();
  const controller = translation = new AbortController();
  const started = Date.now();
  const show = () => { $('translation-text').textContent = t('translating', {language: t('langTo')[lang], time: clock(started)}); };
  $('translation').hidden = false; $('translation').classList.add('busy'); $('translation-retry').hidden = true;
  show();
  const ticker = setInterval(show, 1000);
  try {
    const response = await fetch(`/api/materials/${materialId}/translation?lang=${lang}`, {
      method: 'POST', signal: controller.signal, headers: {'X-Study-Request': '1', 'X-Lang': lang, 'X-Edit-Key': editKey(materialId)}});
    await readProgress(response, material => { if (version === generation && lang === I18N.lang) render(material); });
    $('translation').hidden = true;
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('translation-text').textContent = t('translateFailed', {error: error.message});
    $('translation-retry').hidden = false;
  } finally {
    clearInterval(ticker); $('translation').classList.remove('busy');
    if (translation === controller) translation = null;
  }
}
$('translation-retry').onclick = () => translate();

function render(data) {
  selected = data;
  document.title = `${data.title} · ${t('brand')}`;
  $('title').textContent = data.title;
  // Pictures of the guide are numbered in its text; the server keeps the files.
  const images = data.images || [];
  window.StudyMedia = number => (number >= 1 && number <= images.length
    ? {url: `/api/materials/${data.id}/images/${number}`, ...images[number - 1]} : null);
  renderActions(data);
  renderSource(data);
  renderInteractive(data);
  renderChat(data);
  $('result').hidden = false;
  selectTab(activeTab);
}

function selectTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  ['source', 'interactive'].forEach(id => $(id).hidden = id !== name);
  typesetMath($(name));
  window.StudyPresentation?.enhance($(name));
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.tab));
document.querySelector('[role=tablist]').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const next = tabs[(tabs.indexOf(document.activeElement) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.click(); next.focus();
});

function renderSource(data) {
  const root = $('source');
  root.replaceChildren(node('h3', t('sourceTitle')));
  if (!data.source) { root.append(node('p', t('sourceMissing'))); return; }
  const pages = Math.max(1, Math.round(data.source.length / 1800));
  const chars = data.source.length.toLocaleString(I18N.lang);
  const translated = data.lang !== data.original_lang;
  const raw = node('div', data.source, 'source-text');
  if (!data.formatted) {
    root.append(node('p', t(translated ? 'sourceTranslated' : 'sourceNote', {pages, chars}), 'source-note'), raw);
    return;
  }
  // The AI-formatted full text reads like the interactive material; the extracted text stays one click away.
  const reading = node('div', null, 'reading');
  renderSummary(reading, data.formatted);
  raw.hidden = true;
  const toggle = node('button', t('showRaw'), 'secondary source-toggle'); toggle.type = 'button';
  toggle.onclick = () => {
    raw.hidden = !raw.hidden; reading.hidden = !raw.hidden;
    toggle.textContent = raw.hidden ? t('showRaw') : t('showFormatted');
  };
  const tools = node('div', null, 'edit-tools');
  tools.append(toggle);
  if (data.editable) tools.append(editButton(t('editGuide'), () => openEditor(root, data, 'formatted', data.formatted)));
  root.append(node('p', t(translated ? 'sourceTranslated' : 'sourceFormatted', {pages, chars}), 'source-note'), tools);
  if (data.check) root.append(checkPanel(data));
  root.append(reading, raw);
}

// The report of the text check; the author can run the check again.
function checkPanel(data) {
  const check = data.check;
  const panel = node('section', null, 'check-panel' + (check.ai ? ' checked' : ''));
  panel.setAttribute('aria-live', 'polite');
  const status = node('p', check.ai
    ? t('checkDone', {words: check.words.toLocaleString(I18N.lang), fixes: check.fix_count, tables: check.tables, formulas: check.formulas})
    : t('checkNotDone'), 'check-status');
  panel.append(status);
  if (check.fixes?.length) {
    const details = node('details');
    const list = node('ul', null, 'fix-list');
    const show = text => text.replace(/\n/g, ' ↵ ');
    check.fixes.forEach(fix => {
      const item = node('li');
      item.append(node('code', show(fix.original)), node('span', ' → '), node('code', show(fix.fixed)));
      list.append(item);
    });
    details.append(node('summary', `${t('fixesTitle')} (${check.fix_count})`), list);
    panel.append(details);
  }
  if (check.suspicious?.length) {
    const words = node('p', t('suspiciousTitle') + ' ', 'suspicious');
    check.suspicious.forEach(word => words.append(node('code', word), ' '));
    panel.append(words);
  }
  if (data.editable) {
    const run = node('button', check.ai ? t('checkAgain') : t('checkRun'), check.ai ? 'secondary' : '');
    run.type = 'button';
    run.onclick = async () => {
      run.disabled = true;
      const started = Date.now();
      const progress = () => { status.textContent = t('checking', {time: clock(started)}); };
      progress(); panel.classList.add('busy');
      const ticker = setInterval(progress, 1000);
      try {
        const response = await fetch(`/api/materials/${data.id}/check?lang=${data.lang}`, {method: 'POST',
          headers: {'X-Study-Request': '1', 'X-Lang': I18N.lang, 'X-Edit-Key': editKey(data.id)}});
        await readProgress(response, material => { render(material); selectTab('source'); });
      } catch (error) {
        status.textContent = t('checkFailed', {error: error.message});
        run.disabled = false;
      } finally { clearInterval(ticker); panel.classList.remove('busy'); }
    };
    panel.append(run);
  }
  return panel;
}

// ---- Editing (author only) and sharing a read-only link
function editButton(label, action) {
  const button = node('button', label, 'secondary edit-button'); button.type = 'button';
  button.onclick = action;
  return button;
}

async function saveContent(data, changes) {
  const updated = await api(`/api/materials/${data.id}/content`, json('PUT', {lang: data.lang, ...changes}));
  render(updated);
  notice(t('saved'));
  return updated;
}

function openEditor(root, data, field, value) {
  const editor = node('form', null, 'text-editor');
  if (data.lang !== data.original_lang) editor.append(node('p', t('editTranslated', {language: t('langTo')[data.lang]}), 'quiz-note'));
  const area = node('textarea'); area.value = value || ''; area.rows = 18; area.spellcheck = true;
  area.setAttribute('aria-label', field === 'formatted' ? t('editGuide') : t('editText'));
  const preview = node('div', null, 'editor-preview');
  const status = node('p'); status.setAttribute('role', 'status');
  const save = node('button', t('save'));
  const cancel = node('button', t('cancel'), 'secondary'); cancel.type = 'button';
  cancel.onclick = () => render(data);
  let timer = null;
  const refresh = () => { renderSummary(preview, area.value); typesetMath(preview); window.StudyPresentation?.enhance(preview); };
  area.oninput = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
  const buttons = node('div', null, 'edit-tools'); buttons.append(save, cancel);
  editor.append(node('p', t('editorHint'), 'source-note'), area, buttons, status, node('h4', t('preview')), preview);
  editor.onsubmit = async event => {
    event.preventDefault(); save.disabled = true;
    try { await saveContent(data, {[field]: area.value}); }
    catch (error) { status.textContent = error.message; save.disabled = false; }
  };
  root.replaceChildren(editor);
  refresh();
  area.focus();
}

function renderActions(data) {
  const root = $('material-actions');
  root.replaceChildren();
  if (!data.editable) { root.append(node('span', t('viewOnly'), 'chip')); return; }
  const rename = editButton(t('editTitle'), () => {
    const form = node('form', null, 'title-editor');
    const input = node('input'); input.value = data.title; input.maxLength = 300; input.required = true;
    input.setAttribute('aria-label', t('titleLabel'));
    const save = node('button', t('save')); const cancel = editButton(t('cancel'), () => renderActions(data));
    const status = node('p'); status.setAttribute('role', 'status');
    form.append(input, save, cancel, status);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      try { await saveContent(data, {title: input.value}); } catch (error) { status.textContent = error.message; save.disabled = false; }
    };
    root.replaceChildren(form); input.focus();
  });
  const share = node('button', t('share')); share.type = 'button';
  const panel = node('div', null, 'share-panel'); panel.hidden = true;
  share.onclick = async () => {
    share.disabled = true;
    try {
      const result = await api(`/api/materials/${data.id}/share`, {method: 'POST'});
      saveEditKey(data.id, result.edit_key);
      panel.replaceChildren(
        copyField(new URL(result.view_url, window.location.origin).href, t('shareNote')),
        (() => {
          const more = node('details', null, 'edit-link');
          more.append(node('summary', t('editLinkTitle')),
            copyField(new URL(`${result.view_url}#edit=${result.edit_key}`, window.location.origin).href, t('editLinkNote')));
          return more;
        })());
      panel.hidden = false;
    } catch (error) { notice(error.message); }
    finally { share.disabled = false; }
  };
  const row = node('div', null, 'edit-tools'); row.append(share, rename);
  root.append(row, panel);
}

function copyField(value, note) {
  const wrap = node('div', null, 'copy-field');
  const input = node('input'); input.readOnly = true; input.value = value;
  input.setAttribute('aria-label', note);
  const copy = node('button', t('copy'), 'secondary'); copy.type = 'button';
  copy.onclick = async () => {
    input.select();
    try { await navigator.clipboard.writeText(value); } catch (_) { document.execCommand?.('copy'); }
    copy.textContent = t('copied');
    setTimeout(() => { copy.textContent = t('copy'); }, 1500);
  };
  const line = node('div', null, 'copy-line'); line.append(input, copy);
  wrap.append(line, node('p', note, 'source-note'));
  return wrap;
}

// Interactive material: contents, collapsible topics with infographics, then the quiz.
function renderInteractive(data) {
  const summary = $('summary');
  summary.replaceChildren();
  renderSummary(summary, data.summary);
  const toc = $('toc');
  toc.replaceChildren();
  const headings = [...summary.children].filter(child => /^H[12]$/.test(child.tagName));
  if (headings.length >= 2) {
    const topics = [];
    let current = null;
    for (const child of [...summary.children]) {
      if (headings.includes(child)) {
        current = node('details', null, 'topic'); current.open = true;
        const title = node('summary', null, 'topic-title');
        title.append(...child.childNodes);
        current.append(title);
        current.id = `topic-${topics.length + 1}`;
        topics.push(current);
        child.replaceWith(current);
      } else if (current) current.append(child);
    }
    const head = node('div', null, 'toc-head');
    const toggle = node('button', t('collapseAll'), 'secondary'); toggle.type = 'button';
    toggle.onclick = () => {
      const open = !topics.every(topic => topic.open);
      topics.forEach(topic => { topic.open = open; });
      toggle.textContent = open ? t('collapseAll') : t('expandAll');
    };
    head.append(node('h3', t('toc')), toggle);
    const list = node('ol');
    topics.forEach(topic => {
      const item = node('li');
      const link = node('button', topic.querySelector('summary').textContent, 'toc-link'); link.type = 'button';
      link.onclick = () => { topic.open = true; topic.scrollIntoView({behavior: 'smooth', block: 'start'}); };
      item.append(link); list.append(item);
    });
    toc.append(head, list);
  }
  toc.hidden = headings.length < 2;
  placeInfographics(summary, data.infographics || []);
  if (data.editable) {
    const tools = node('div', null, 'edit-tools summary-tools');
    tools.append(editButton(t('editText'), () => openEditor(summary, data, 'summary', data.summary)));
    summary.prepend(tools);
  }
  renderQuiz(data);
}

const simple = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Each infographic goes into the topic it belongs to; every topic can be discussed with the AI below.
function placeInfographics(summary, items) {
  const topics = [...summary.querySelectorAll(':scope > details.topic')];
  const unplaced = [];
  for (const item of items) {
    const figure = window.StudyPresentation?.infographic(item);
    if (!figure) continue;
    const wanted = simple(item.section);
    const topic = topics.find(topic => simple(topic.querySelector('summary').textContent) === wanted)
      || topics.find(topic => wanted && (simple(topic.querySelector('summary').textContent).includes(wanted) || wanted.includes(simple(topic.querySelector('summary').textContent))));
    if (topic) topic.append(figure); else unplaced.push(figure);
  }
  if (unplaced.length) {
    const extra = node('details', null, 'topic'); extra.open = true;
    extra.append(node('summary', t('visualTopic'), 'topic-title'), ...unplaced);
    summary.append(extra);
  }
  for (const topic of topics) {
    const name = topic.querySelector('summary').textContent.trim();
    const ask = node('button', t('askTopic'), 'secondary ask-topic'); ask.type = 'button';
    ask.onclick = () => askAbout(name);
    topic.append(ask);
  }
}

function askAbout(topic) {
  if (!chatField) return;
  chatField.value = t('askTopicText', {topic});
  chatField.oninput?.();
  $('chat').scrollIntoView({behavior: 'smooth', block: 'start'});
  chatField.focus({preventScroll: true});
}

function renderQuiz(data) {
  const root = $('quiz');
  const head = node('div', null, 'quiz-head');
  head.append(node('h3', t('quizTitle')));
  root.replaceChildren(head);
  const editable = data.editable && data.lang === data.original_lang;
  if (editable) {
    const edit = node('button', t('quizEdit'), 'secondary quiz-edit'); edit.type = 'button';
    edit.onclick = () => renderQuizEditor(data);
    head.append(edit);
  } else if (data.editable) {
    root.append(node('p', t('quizOriginalOnly', {language: t('langTo')[data.original_lang]}), 'quiz-note'));
  }
  if (!data.quiz.length) { root.append(node('p', t('quizEmpty'))); return; }
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
  const submit = node('button', t('quizCheck'));
  const feedback = node('p'); feedback.setAttribute('role', 'status');
  form.append(submit, feedback);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = await api(`/api/materials/${data.id}/attempts`, json('POST', {answers, quiz_revision: data.quiz_revision}));
      feedback.textContent = t('quizResult', {score: result.score, total: result.total});
      data.quiz.forEach((question, index) => {
        sections[index].disabled = true;
        sections[index].classList.add(answers[index] === question.answer ? 'right' : 'wrong');
        sections[index].append(richNode('p', `${t('quizCorrect', {answer: question.options[question.answer]})}\n${question.explanation}`, 'feedback'));
      });
      typesetMath(root);
    } catch (error) { feedback.textContent = error.message; submit.disabled = false; }
  };
  root.append(form);
}

function labeledField(parent, caption, element) {
  const label = node('label', caption);
  label.append(element); parent.append(label);
  return element;
}

function renderQuizEditor(data) {
  const root = $('quiz');
  root.replaceChildren(node('h3', t('quizTitle')), node('p', t('editorIntro')));
  const form = node('form', null, 'quiz-editor');
  const container = node('div');
  const rows = new Map();
  function addQuestion(question) {
    if (rows.size >= 50) { notice(t('max50')); return; }
    const section = node('fieldset', null, 'editor-question');
    const text = node('textarea'); text.value = question.question; text.required = true; text.maxLength = 2000;
    labeledField(section, t('question'), text);
    const options = question.options.map((value, index) => {
      const input = node('input'); input.value = value; input.required = true; input.maxLength = 2000;
      return labeledField(section, t('option', {n: index + 1}), input);
    });
    const answer = node('select');
    options.forEach((_, index) => { const option = node('option', t('option', {n: index + 1})); option.value = index; answer.append(option); });
    answer.value = question.answer;
    labeledField(section, t('correct'), answer);
    const explanation = node('textarea'); explanation.value = question.explanation; explanation.required = true; explanation.maxLength = 3000;
    labeledField(section, t('explanation'), explanation);
    const remove = node('button', t('removeQuestion'), 'secondary'); remove.type = 'button';
    remove.onclick = () => { rows.delete(section); section.remove(); };
    section.append(remove);
    rows.set(section, {text, options, answer, explanation}); container.append(section);
  }
  data.quiz.forEach(addQuestion);
  const add = node('button', t('addQuestion'), 'secondary'); add.type = 'button';
  add.onclick = () => addQuestion({question: '', options: ['', '', '', ''], answer: 0, explanation: ''});
  const save = node('button', t('saveQuiz'));
  const cancel = node('button', t('cancel'), 'secondary'); cancel.type = 'button';
  cancel.onclick = () => renderQuiz(data);
  const status = node('p'); status.setAttribute('role', 'status');
  form.append(container, add, save, cancel, status);
  form.onsubmit = async event => {
    event.preventDefault(); save.disabled = true;
    const quiz = [...rows.values()].map(row => ({question: row.text.value.trim(), options: row.options.map(input => input.value.trim()), answer: Number(row.answer.value), explanation: row.explanation.value.trim()}));
    try {
      const updated = await api(`/api/materials/${data.id}/quiz`, json('PUT', {quiz, quiz_revision: data.quiz_revision}));
      render(updated);
      $('quiz').scrollIntoView({behavior: 'smooth', block: 'start'});
      notice(t('quizSaved'));
    } catch (error) { status.textContent = error.message; save.disabled = false; }
  };
  root.append(form);
}

// ---- Chat with the AI about this guide
function questionItem(item) {
  const article = node('article', null, 'qa-item');
  const question = node('div', null, 'qa-bubble qa-question');
  question.append(node('p', date(item.created_at), 'qa-meta'), node('p', item.question, 'qa-text'));
  const answer = node('div', null, 'qa-bubble qa-answer');
  const body = node('div', null, 'qa-body');
  renderSummary(body, item.answer);
  answer.append(node('p', t('answerLabel'), 'qa-meta'), body);
  article.append(question, answer);
  return article;
}
function pendingItem(text) {
  const article = node('article', null, 'qa-item');
  const question = node('div', null, 'qa-bubble qa-question');
  question.append(node('p', t('justNow'), 'qa-meta'), node('p', text, 'qa-text'));
  const answer = node('div', null, 'qa-bubble qa-answer qa-pending');
  answer.setAttribute('aria-label', t('searching'));
  answer.append(node('span'), node('span'), node('span'));
  article.append(question, answer);
  return article;
}
function renderChat(data) {
  const root = $('chat');
  root.replaceChildren(node('h3', t('chatTitle')), node('p', t('chatIntro'), 'ask-intro'));
  const history = node('div', null, 'qa-history');
  history.setAttribute('aria-live', 'polite');
  const empty = node('p', t('chatEmpty'), 'qa-empty');
  const form = node('form', null, 'ask-form');
  const field = chatField = node('textarea');
  field.required = true; field.minLength = 3; field.maxLength = 1000; field.rows = 3;
  field.placeholder = t('chatPlaceholder');
  field.setAttribute('aria-label', t('chatLabel'));
  const footer = node('div', null, 'ask-footer');
  const counter = node('span', '0 / 1000', 'ask-counter');
  const submit = node('button', t('send'));
  footer.append(node('span', t('chatHint'), 'ask-hint'), counter, submit);
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
    if (version !== generation || selected !== data) return;
    items.forEach(item => show(item));
  }).catch(error => { status.textContent = error.message; });
  form.onsubmit = async event => {
    event.preventDefault();
    const text = field.value.trim();
    if (text.length < 3) { status.textContent = t('tooShort'); return; }
    submit.disabled = true; status.textContent = '';
    const pending = pendingItem(text);
    history.append(pending); empty.hidden = true;
    pending.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    try {
      const item = await api(`/api/materials/${data.id}/questions`, json('POST', {question: text, lang: I18N.lang}));
      if (!pending.isConnected) return;
      show(item, pending); field.value = ''; field.oninput();
    } catch (error) {
      pending.remove(); empty.hidden = history.children.length > 0;
      status.textContent = error.message;
    } finally { submit.disabled = false; field.focus(); }
  };
}

// ---- Language switch: interface texts change at once; a material is shown in the new language.
document.querySelectorAll('[data-lang]').forEach(button => button.onclick = async () => {
  if (button.dataset.lang === I18N.lang) return;
  I18N.set(button.dataset.lang);
  notice('');
  // apply() resets the file hint; keep the chosen file's name visible.
  if ($('file').files[0]) $('filename').textContent = $('file').files[0].name;
  if (materialId) {
    try { await openMaterial(); } catch (error) { notice(error.message); }
  }
});

function renderSummary(container, text) {
  if (window.StudyPresentation) { window.StudyPresentation.renderSummary(container, text); return; }
  container.textContent = text;
}
function typesetMath(root) { window.StudyPresentation?.math(root); }
function richNode(tag, text, className) {
  const result = node(tag, undefined, className);
  if (window.StudyPresentation) window.StudyPresentation.inline(result, text);
  else result.textContent = text;
  return result;
}

(async () => {
  I18N.apply();
  setupPage();
  if (!materialId) return;
  try { await openMaterial(); } catch (error) { notice(error.message); }
})();
