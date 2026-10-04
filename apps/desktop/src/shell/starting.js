// Zeigt „Server startet …“ oder den Grund, warum er nicht läuft. Der Text kommt als Abfrageparameter vom
// Hauptprozess (eigener deutscher Text, nie Secrets) und wird nur als Text eingesetzt.
const params = new URLSearchParams(window.location.search);
const state = params.get('state');
const message = params.get('message');
const title = document.getElementById('title');
const text = document.getElementById('message');
if (state === 'failed') {
  title.textContent = 'Pagewise läuft nicht';
  text.textContent = message || 'Der Server konnte nicht gestartet werden.';
} else if (state === 'restarting') {
  title.textContent = 'Pagewise startet neu';
  text.textContent = 'Der Server startet gerade neu. Einen Moment bitte …';
} else {
  title.textContent = 'Pagewise startet';
  text.textContent = 'Der Server startet. Einen Moment bitte …';
}
