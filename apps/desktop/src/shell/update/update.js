// Seite „Nach Updates suchen“. Sie bekommt vom Hauptprozess ein fertiges Objekt (Texte stehen schon darin) und baut
// daraus die Anzeige, ausschließlich mit textContent und createElement: kein innerHTML, kein Inline-Style. Auch
// Betreffzeilen von Commits und Zeilen der Ausgabe kommen aus dem Netz und sind hier nur Text. Während etwas läuft
// fragt die Seite jede Sekunde nach dem Stand, sonst selten. Der Preload legt nur feste Funktionen in `window.pagewise`.
const api = window.pagewise;
const root = document.getElementById('app');
const FAST_MS = 1000;
const SLOW_MS = 20000;
let lastJson = '';
let timer;
// `null`: Die Person hat die Ausgabe nicht angefasst, dann ist sie bei einem Fehler offen, sonst zu.
let detailsOpen = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const handlers = {
  check: () => api.checkUpdate(),
  recheck: () => api.checkUpdate(),
  start: () => api.startUpdate(),
  cancel: () => api.cancelUpdate(),
  restart: () => api.restartForUpdate(),
  'retry-check': () => api.checkUpdate(),
  'retry-start': () => api.startUpdate(),
  'show-log': () => api.showUpdateLog(),
};

/** Wohin gehört der Fokus zurück? Das Kästchen über seiner Kennung, Knöpfe über ihrem Text. */
function focusKey(node) {
  if (!node || !root.contains(node)) return null;
  if (node.id === 'auto-check') return 'auto-check';
  if (node.tagName === 'BUTTON') return `button:${node.textContent}`;
  if (node.tagName === 'SUMMARY') return 'summary';
  return null;
}

function findByKey(key) {
  if (key === 'auto-check') return root.querySelector('#auto-check');
  if (key === 'summary') return root.querySelector('summary');
  if (key?.startsWith('button:')) {
    const label = key.slice('button:'.length);
    return (
      [...root.querySelectorAll('button')].find((button) => button.textContent === label) ?? null
    );
  }
  return null;
}

async function run(action) {
  try {
    const result = await action();
    if (result) render(result);
  } catch {
    // Der Hauptprozess hat abgelehnt oder ist weg: nichts anzeigen, nichts raten.
  }
  schedule(FAST_MS);
}

function render(view) {
  const json = JSON.stringify(view);
  if (json !== lastJson) {
    lastJson = json;
    build(view);
  }
  schedule(view.busy ? FAST_MS : SLOW_MS);
}

function build(view) {
  const key = focusKey(document.activeElement);
  const children = [];
  children.push(el('h1', '', view.texts.title));

  const state = el('section');
  state.append(el('h2', '', view.title));
  if (view.body) state.append(el('p', 'body', view.body));
  children.push(state);

  if (view.busy) {
    const bar = el('progress');
    bar.setAttribute('aria-label', view.title);
    children.push(bar);
  }

  if (view.facts.length > 0) {
    const list = el('dl', 'facts');
    for (const fact of view.facts) {
      list.append(el('dt', '', fact.label), el('dd', '', fact.value));
    }
    children.push(list);
  }

  if (view.steps) {
    const steps = el('ol', 'steps');
    steps.setAttribute('aria-label', view.stepNote ?? '');
    for (const step of view.steps) {
      const item = el('li', step.state, step.label);
      if (step.state === 'active') item.setAttribute('aria-current', 'step');
      steps.append(item);
    }
    children.push(steps);
    if (view.stepNote) children.push(el('p', 'note', view.stepNote));
  }

  if (view.changes) {
    children.push(el('h3', '', view.changes.label));
    if (view.changes.items.length > 0) {
      const list = el('ul', 'changes');
      for (const item of view.changes.items) list.append(el('li', '', item));
      if (view.changes.more) list.append(el('li', '', view.changes.more));
      children.push(list);
    } else if (view.changes.unknown) {
      children.push(el('p', 'note', view.changes.unknown));
    }
  }

  if (view.untouched) children.push(el('p', 'note', view.untouched));

  if (view.log) {
    const details = el('details');
    details.open = detailsOpen ?? view.stage === 'failed';
    const summary = el('summary', '', view.log.label);
    // Nur ein Klick der Person zählt (auch per Tastatur), nicht das Setzen von `open` beim Neuaufbau.
    summary.addEventListener('click', () => {
      detailsOpen = !details.open;
    });
    details.append(summary, el('pre', '', view.log.lines.join('\n')));
    children.push(details);
  }

  const actions = el('div', 'actions');
  for (const action of view.actions) {
    const handler = handlers[action.id];
    if (!handler) continue;
    const primary = action.id === 'start' || action.id === 'restart' || action.id === 'check';
    const button = el('button', primary ? 'primary' : '', action.label);
    button.type = 'button';
    button.addEventListener('click', () => void run(handler));
    actions.append(button);
  }
  children.push(actions);

  const status = el('p', 'status', view.message ?? '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  children.push(status);

  const option = el('label', 'option');
  const box = el('input');
  box.type = 'checkbox';
  box.id = 'auto-check';
  box.checked = view.autoCheck.checked;
  box.addEventListener('change', () => void run(() => api.setUpdateAutoCheck(box.checked)));
  option.append(box, el('span', '', view.autoCheck.label));
  children.push(option, el('p', 'note', view.autoCheck.note));

  root.replaceChildren(...children);
  const pre = root.querySelector('pre');
  if (pre) pre.scrollTop = pre.scrollHeight;
  findByKey(key)?.focus();
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), delay);
}

async function refresh() {
  try {
    render(await api.getUpdateView());
  } catch {
    schedule(SLOW_MS);
  }
}

void refresh();
window.addEventListener('focus', () => void refresh());
