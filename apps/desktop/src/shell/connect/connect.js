// Seite „Mit iPhone und iPad verbinden“. Sie bekommt vom Hauptprozess ein fertiges Objekt (Texte stehen schon darin)
// und baut daraus die Anzeige, ausschließlich mit textContent und createElement(NS): kein innerHTML, kein Inline-Style.
// Gleiche Ansichten zeichnen neu ohne Austausch; bei echten Änderungen wird der Baum neu gebaut, dabei bleiben
// Fokus und der getippte Rechnername erhalten (siehe render). Der Preload legt nur feste Funktionen in
// `window.pagewise` (siehe preload.ts).
const api = window.pagewise;
const root = document.getElementById('app');
const QR_PATH = /^[MhvzHVZ0-9 .-]*$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
let lastJson = '';
let working = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function renderQr(qr, label) {
  if (!qr || !Number.isInteger(qr.size) || qr.size < 1 || qr.size > 200 || !QR_PATH.test(qr.path))
    return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${qr.size} ${qr.size}`);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(qr.size));
  background.setAttribute('height', String(qr.size));
  background.setAttribute('fill', '#ffffff');
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('d', qr.path);
  modules.setAttribute('fill', '#000000');
  svg.append(background, modules);
  return svg;
}

const handlers = {
  'setup-serve': () => api.setupServe(),
  'use-alt-port': () => api.useAltPort(),
  'reset-serve': () => api.resetServe(),
  'copy-address': () => api.copyAddress(),
  'open-tailscale': () => api.openTailscale(),
  'open-admin-dns': () => api.openAdmin('dns'),
  'open-admin-machines': () => api.openAdmin('machines'),
  'open-download': () => api.openDownload(),
  refresh: () => api.getView(),
};

async function run(action) {
  if (working) return;
  working = true;
  try {
    const result = await action();
    // Aktionen ohne neue Ansicht (Browser öffnen) liefern nichts: dann bleibt alles stehen. render()
    // zeigt ohnehin nur echte Änderungen an und erhält dabei Fokus und Eingaben.
    if (result) render(result);
  } catch {
    // Der Hauptprozess hat abgelehnt oder ist weg: nichts anzeigen, nichts raten.
  } finally {
    working = false;
  }
}

/** Wohin gehört der Fokus zurück? Eingabefeld über seiner Kennung, Knöpfe über ihrem Text. */
function focusKey(node) {
  if (!node || !root.contains(node)) return null;
  if (node.id === 'hostname') return 'hostname';
  if (node.tagName === 'BUTTON') return `button:${node.textContent}`;
  return null;
}

function findByKey(key) {
  if (key === 'hostname') return root.querySelector('#hostname');
  if (key?.startsWith('button:')) {
    const label = key.slice('button:'.length);
    const match = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
    return match ?? null;
  }
  return null;
}

function render(view) {
  const json = JSON.stringify(view);
  if (json === lastJson) return;
  lastJson = json;

  // Vor dem Neubau sichern, was der Nutzer gerade hat: den Fokus und den Stand des Rechnernamen-Felds
  // (getippter Text schlägt den Vorschlag). Danach wiederherstellen, siehe unten.
  const key = focusKey(document.activeElement);
  const previousInput = root.querySelector('#hostname');
  const typed = previousInput
    ? {
        value: previousInput.value,
        start: previousInput.selectionStart,
        end: previousInput.selectionEnd,
      }
    : null;

  const children = [];
  children.push(el('h1', '', view.texts.title));
  children.push(el('p', 'body', view.texts.intro));

  const state = el('section');
  state.append(el('h2', '', view.title), el('p', 'body', view.body));
  children.push(state);

  for (const warning of view.warnings) {
    const box = el('p', warning.severity === 'danger' ? 'notice danger' : 'notice', warning.text);
    box.setAttribute('role', warning.severity === 'danger' ? 'alert' : 'note');
    children.push(box);
  }

  if (view.address) {
    const block = el('section');
    block.append(el('h2', '', view.texts.addressLabel), el('code', 'address', view.address));
    const qr = renderQr(view.qr, view.texts.qrLabel);
    if (qr) block.append(qr);
    block.append(el('p', 'body', view.texts.howTo));
    children.push(block);
  }

  if (view.hostname) {
    const form = el('form');
    const id = 'hostname';
    const label = el('label', '', view.texts.hostnameLabel);
    label.setAttribute('for', id);
    const input = el('input');
    input.id = id;
    input.name = id;
    input.type = 'text';
    input.value = view.hostname.suggestion;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.spellcheck = false;
    input.maxLength = 63;
    const hint = el(
      'p',
      'note',
      `${view.texts.hostLabel}: ${view.hostname.label ?? ''}. ${view.hostname.explain}`,
    );
    const submit = el('button', '', view.hostname.buttonLabel);
    submit.type = 'submit';
    form.append(label, input, hint, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void run(() => api.renameHost(input.value.trim()));
    });
    children.push(form);
  }

  const actions = el('div', 'actions');
  for (const action of view.actions) {
    const handler = handlers[action.id];
    if (!handler) continue;
    const primary =
      action.id === 'setup-serve' || action.id === 'use-alt-port' || action.id === 'copy-address';
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
  children.push(el('p', 'note', view.awakeNote));

  // Getippten Stand des Felds bewahren (Vorschlag darf nicht über getippten Text siegen): Wert und
  // Markierung vor dem Einhängen setzen, sie bleiben am Knoten. Der Fokus gehört erst auf den
  // eingehängten Baum (vorher ist der Knoten nicht fokussierbar); beides passiert in derselben
  // Aufgabe, der Zwischenstand „BODY“ wird nie sichtbar.
  const form = children.find((node) => node.tagName === 'FORM' && node.querySelector('#hostname'));
  if (form) {
    const field = form.querySelector('#hostname');
    if (typed && typed.value !== '') {
      field.value = typed.value;
      field.setSelectionRange(typed.start, typed.end);
    }
  }
  root.replaceChildren(...children);
  findByKey(key)?.focus();
}

async function refresh() {
  if (working) return;
  try {
    render(await api.getView());
  } catch {
    // siehe oben
  }
}

void refresh();
window.addEventListener('focus', () => void refresh());
setInterval(() => void refresh(), 10000);
