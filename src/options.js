const DEFAULTS = { appendSpace: true };

const status = document.getElementById('status');
const appendSpace = document.getElementById('appendSpace');

let noteTimer = 0;
function note(text) {
  status.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { status.textContent = ''; }, 1500);
}

function render(settings) {
  appendSpace.checked = settings.appendSpace;
}

function save() {
  chrome.storage.sync.set({ appendSpace: appendSpace.checked }, () => note('Saved'));
}

chrome.storage.sync.get(DEFAULTS, render);
appendSpace.addEventListener('change', save);
