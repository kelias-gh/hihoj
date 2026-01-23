import { getAllScenarios, deleteScenario, saveScenario, generateId, StoredScenario } from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const grid = $<HTMLDivElement>('scenario-grid');
const emptyState = $<HTMLDivElement>('empty-state');
const newBtn = $<HTMLButtonElement>('new-scenario-btn');
const importBtn = $<HTMLButtonElement>('import-btn');
const importInput = $<HTMLInputElement>('import-input');
const deleteDialog = $<HTMLDivElement>('delete-dialog');
const deleteMessage = $<HTMLParagraphElement>('delete-message');
const deleteCancel = $<HTMLButtonElement>('delete-cancel');
const deleteConfirm = $<HTMLButtonElement>('delete-confirm');

let pendingDeleteId: string | null = null;

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function createScenarioCard(scenario: StoredScenario): HTMLElement {
  const card = document.createElement('div');
  card.className = 'scenario-card';
  card.innerHTML = `
    <div class="scenario-thumbnail">
      <img src="${scenario.thumbnail}" alt="${scenario.name}" />
    </div>
    <div class="scenario-info">
      <h3 class="scenario-name">${scenario.name}</h3>
      <p class="scenario-date">${formatDate(scenario.updatedAt)}</p>
    </div>
    <div class="scenario-actions">
      <button class="btn-play" data-action="play">Play</button>
      <button data-action="edit">Edit</button>
      <button data-action="export">Export</button>
      <button class="btn-danger" data-action="delete">Delete</button>
    </div>
  `;

  card.querySelector('[data-action="play"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    sessionStorage.setItem('loadScenarioId', scenario.id);
    window.location.href = '/game.html';
  });

  card.querySelector('[data-action="edit"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    sessionStorage.setItem('loadScenarioId', scenario.id);
    window.location.href = '/index.html';
  });

  card.querySelector('[data-action="export"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const blob = new Blob([scenario.mapData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scenario.name}.map`;
    a.click();
    URL.revokeObjectURL(url);
  });

  card.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingDeleteId = scenario.id;
    deleteMessage.textContent = `Are you sure you want to delete "${scenario.name}"?`;
    deleteDialog.classList.remove('hidden');
  });

  return card;
}

async function renderScenarios() {
  const scenarios = await getAllScenarios();
  grid.innerHTML = '';

  if (scenarios.length === 0) {
    emptyState.classList.remove('hidden');
    grid.classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    grid.classList.remove('hidden');
    scenarios.forEach(s => grid.appendChild(createScenarioCard(s)));
  }
}

async function importMapFile(file: File) {
  const text = await file.text();
  const name = file.name.replace(/\.map$/, '');

  const thumbnail = await generateThumbnail(text);

  const scenario: StoredScenario = {
    id: generateId(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thumbnail,
    mapData: text
  };

  await saveScenario(scenario);
  await renderScenarios();
}

async function generateThumbnail(mapData: string): Promise<string> {
  const lines = mapData.split('\n');
  let width = 0, height = 0;
  let pixelDataBase64 = '';

  for (const line of lines) {
    if (line.startsWith('SIZE:')) {
      const [w, h] = line.slice(5).split('x').map(Number);
      width = w;
      height = h;
    } else if (line.startsWith('PIXELS:')) {
      pixelDataBase64 = line.slice(7);
    }
  }

  if (!width || !height || !pixelDataBase64) {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  const binary = atob(pixelDataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const thumbWidth = 256;
  const thumbHeight = 128;
  const canvas = document.createElement('canvas');
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(thumbWidth, thumbHeight);

  const scaleX = width / thumbWidth;
  const scaleY = height / thumbHeight;

  for (let ty = 0; ty < thumbHeight; ty++) {
    for (let tx = 0; tx < thumbWidth; tx++) {
      const sx = Math.floor(tx * scaleX);
      const sy = Math.floor(ty * scaleY);
      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (ty * thumbWidth + tx) * 4;

      imageData.data[dstIdx] = bytes[srcIdx] || 0;
      imageData.data[dstIdx + 1] = bytes[srcIdx + 1] || 0;
      imageData.data[dstIdx + 2] = bytes[srcIdx + 2] || 0;
      imageData.data[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

newBtn.addEventListener('click', () => {
  sessionStorage.removeItem('loadScenarioId');
  window.location.href = '/index.html';
});

importBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (file) {
    await importMapFile(file);
    importInput.value = '';
  }
});

deleteCancel.addEventListener('click', () => {
  pendingDeleteId = null;
  deleteDialog.classList.add('hidden');
});

deleteConfirm.addEventListener('click', async () => {
  if (pendingDeleteId) {
    await deleteScenario(pendingDeleteId);
    pendingDeleteId = null;
    deleteDialog.classList.add('hidden');
    await renderScenarios();
  }
});

renderScenarios();
