// Seite „Mit iPhone und iPad verbinden“. Sie bekommt vom Hauptprozess ein fertiges Objekt (Texte stehen schon darin)
// und baut daraus die Anzeige, ausschließlich mit textContent und createElement(NS): kein innerHTML, kein Inline-Style.
// Der Preload legt nur feste Funktionen in `window.pagewise` (siehe preload.ts).
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
    // Aktionen ohne neue Ansicht (Browser öffnen) liefern nichts: dann bleibt alles stehen.
    if (result) render(result, true);
  } catch {
    // Der Hauptprozess hat abgelehnt oder ist weg: nichts anzeigen, nichts raten.
  } finally {
    working = false;
  }
}

function render(view, force) {
  const json = JSON.stringify(view);
  if (!force && json === lastJson) return;
  lastJson = json;

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
  children.push(status);
  children.push(el('p', 'note', view.awakeNote));

  root.replaceChildren(...children);
}

async function refresh() {
  if (
    working ||
    (root.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT')
  )
    return;
  try {
    render(await api.getView(), false);
  } catch {
    // siehe oben
  }
}

void refresh();
window.addEventListener('focus', () => void refresh());
setInterval(() => void refresh(), 10000);
