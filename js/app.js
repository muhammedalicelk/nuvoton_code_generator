import { cloneDefaultState } from './state.js?v=12';
import { validateConfig } from './rules.js?v=12';
import { generateCode } from './generator.js?v=12';
import { setOptions, showMessages, downloadFile } from './ui.js?v=12';

const state = cloneDefaultState();
let mcuDb;
let pinDb;
let generatedCode = '';

const els = {
  mcuSelect: document.getElementById('mcuSelect'),
  mcuMeta: document.getElementById('mcuMeta'),
  clockSourceSelect: document.getElementById('clockSourceSelect'),
  pllSelect: document.getElementById('pllSelect'),
  hclkSelect: document.getElementById('hclkSelect'),
  uartEnable: document.getElementById('uartEnable'),
  timerEnable: document.getElementById('timerEnable'),
  adcEnable: document.getElementById('adcEnable'),
  uartSection: document.getElementById('uartSection'),
  timerSection: document.getElementById('timerSection'),
  adcSection: document.getElementById('adcSection'),
  adcStSection: document.getElementById('adcStSection'),
  uartBaudSelect: document.getElementById('uartBaudSelect'),
  uartPinSelect: document.getElementById('uartPinSelect'),
  timerModeSelect: document.getElementById('timerModeSelect'),
  timerFreqInput: document.getElementById('timerFreqInput'),
  timerInterruptEnable: document.getElementById('timerInterruptEnable'),
  adcModeSelect: document.getElementById('adcModeSelect'),
  adcTriggerSelect: document.getElementById('adcTriggerSelect'),
  adcStPinSelect: document.getElementById('adcStPinSelect'),
  adcStConditionSelect: document.getElementById('adcStConditionSelect'),
  adcChannelList: document.getElementById('adcChannelList'),
  generateBtn: document.getElementById('generateBtn'),
  downloadCodeBtn: document.getElementById('downloadCodeBtn'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  exportConfigBtn: document.getElementById('exportConfigBtn'),
  importConfigInput: document.getElementById('importConfigInput'),
  resetBtn: document.getElementById('resetBtn'),
  codePreview: document.getElementById('codePreview'),
  messages: document.getElementById('messages'),
  statusBadge: document.getElementById('statusBadge')
};

async function loadData() {
  const [mcuRes, pinRes] = await Promise.all([
    fetch('./data/mcus.json'),
    fetch('./data/pins_m031fb.json')
  ]);
  mcuDb = await mcuRes.json();
  pinDb = await pinRes.json();
}

function getCurrentMcu() {
  return mcuDb.mcus.find((item) => item.name === state.mcu) || mcuDb.mcus[0];
}

function getAllowedClockSources(mcu) {
  return (mcu.clockSources || []).map((src) => ({ value: src, label: src }));
}

function getHclkOptionsForSource(mcu, source) {
  const values = (mcu.hclkOptionsBySource && mcu.hclkOptionsBySource[source]) || [mcu.maxHclk];
  return values.map((value) => ({ value: String(value), label: value.toLocaleString('tr-TR') }));
}

function refreshMcuDependentOptions() {
  const mcu = getCurrentMcu();
  const allowedSources = getAllowedClockSources(mcu).map((item) => item.value);
  if (!allowedSources.includes(state.clock.source)) {
    state.clock.source = allowedSources[0];
  }

  setOptions(els.clockSourceSelect, getAllowedClockSources(mcu));
  const hclkOptions = getHclkOptionsForSource(mcu, state.clock.source);
  const allowedHclk = hclkOptions.map((item) => Number(item.value));
  if (!allowedHclk.includes(state.clock.hclk)) {
    state.clock.hclk = allowedHclk[0];
  }
  setOptions(els.hclkSelect, hclkOptions);
  state.clock.pllEnabled = state.clock.source === 'PLL';
  renderMcuMeta();
}

function renderMcuMeta() {
  const mcu = getCurrentMcu();
  const caps = mcu.clockCapabilities || {};
  const available = Object.entries(caps.oscillators || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  els.mcuMeta.innerHTML = [
    `<div><strong>Paket:</strong> ${mcu.package}</div>`,
    `<div><strong>Aile:</strong> ${mcu.family}</div>`,
    `<div><strong>Maks. HCLK:</strong> ${mcu.maxHclk.toLocaleString('tr-TR')} Hz</div>`,
    `<div><strong>Clock Kaynakları:</strong> ${available || 'Belirtilmemiş'}</div>`,
    `<div><strong>HXT:</strong> ${caps.hxtRange || '—'}</div>`,
    `<div><strong>Kaynak:</strong> ${mcu.clockProfile}</div>`
  ].join('');
}

function renderAdcChannelList() {
  els.adcChannelList.innerHTML = '';
  pinDb.adcChannels.forEach((channel, index) => {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(index);
    input.checked = state.peripherals.adc.channelIndexes.includes(index);
    input.addEventListener('change', () => {
      syncStateFromForm();
      render();
    });
    label.appendChild(input);
    label.append(` ${channel.label}`);
    els.adcChannelList.appendChild(label);
  });
}

function fillStaticOptions() {
  setOptions(els.mcuSelect, mcuDb.mcus.map((item) => ({ value: item.name, label: item.displayName })));
  setOptions(els.uartPinSelect, pinDb.uart0Options, 'index', 'label');
  setOptions(els.adcStPinSelect, pinDb.adcStOptions, 'index', 'label');
  refreshMcuDependentOptions();
  renderAdcChannelList();
}

function syncFormFromState() {
  refreshMcuDependentOptions();
  els.mcuSelect.value = state.mcu;
  els.clockSourceSelect.value = state.clock.source;
  els.pllSelect.value = String(state.clock.pllEnabled);
  els.pllSelect.disabled = true;
  els.hclkSelect.value = String(state.clock.hclk);
  els.uartEnable.checked = state.peripherals.uart0.enabled;
  els.timerEnable.checked = state.peripherals.timer0.enabled;
  els.adcEnable.checked = state.peripherals.adc.enabled;
  els.uartBaudSelect.value = String(state.peripherals.uart0.baudrate);
  els.uartPinSelect.value = String(state.peripherals.uart0.pinIndex);
  els.timerModeSelect.value = state.peripherals.timer0.mode;
  els.timerFreqInput.value = state.peripherals.timer0.frequency;
  els.timerInterruptEnable.checked = state.peripherals.timer0.interruptEnabled;
  els.adcModeSelect.value = state.peripherals.adc.mode;
  els.adcTriggerSelect.value = state.peripherals.adc.trigger;
  els.adcStPinSelect.value = String(state.peripherals.adc.stPinIndex);
  els.adcStConditionSelect.value = state.peripherals.adc.stCondition;

  renderAdcChannelList();

  els.uartSection.classList.toggle('hidden', !state.peripherals.uart0.enabled);
  els.timerSection.classList.toggle('hidden', !state.peripherals.timer0.enabled);
  els.adcSection.classList.toggle('hidden', !state.peripherals.adc.enabled);
  els.adcStSection.classList.toggle('hidden', !(state.peripherals.adc.enabled && state.peripherals.adc.trigger === 'stadc'));
}

function syncStateFromForm() {
  const prevMcu = state.mcu;
  state.mcu = els.mcuSelect.value;

  if (state.mcu !== prevMcu) {
    refreshMcuDependentOptions();
  }

  state.clock.source = els.clockSourceSelect.value;
  const mcu = getCurrentMcu();
  const allowedSources = (mcu.clockSources || []);
  if (!allowedSources.includes(state.clock.source)) {
    state.clock.source = allowedSources[0];
  }
  state.clock.pllEnabled = state.clock.source === 'PLL';

  const allowedHclk = ((mcu.hclkOptionsBySource || {})[state.clock.source] || [mcu.maxHclk]);
  const requestedHclk = Number(els.hclkSelect.value);
  state.clock.hclk = allowedHclk.includes(requestedHclk) ? requestedHclk : allowedHclk[0];

  state.peripherals.uart0.enabled = els.uartEnable.checked;
  state.peripherals.timer0.enabled = els.timerEnable.checked;
  state.peripherals.adc.enabled = els.adcEnable.checked;
  state.peripherals.uart0.baudrate = Number(els.uartBaudSelect.value);
  state.peripherals.uart0.pinIndex = Number(els.uartPinSelect.value);
  state.peripherals.timer0.mode = els.timerModeSelect.value;
  state.peripherals.timer0.frequency = Number(els.timerFreqInput.value);
  state.peripherals.timer0.interruptEnabled = els.timerInterruptEnable.checked;
  state.peripherals.adc.mode = els.adcModeSelect.value;
  state.peripherals.adc.trigger = els.adcTriggerSelect.value;
  state.peripherals.adc.stPinIndex = Number(els.adcStPinSelect.value);
  state.peripherals.adc.stCondition = els.adcStConditionSelect.value;
  state.peripherals.adc.channelIndexes = Array.from(els.adcChannelList.querySelectorAll('input:checked')).map((input) => Number(input.value));
}

function render() {
  syncFormFromState();
  const result = validateConfig(state, pinDb, mcuDb);
  showMessages(els.messages, result);

  if (result.valid) {
    generatedCode = generateCode(state, pinDb, mcuDb);
    els.codePreview.textContent = generatedCode;
    els.statusBadge.textContent = 'Geçerli';
    els.statusBadge.className = 'badge ok';
  } else {
    generatedCode = '';
    els.codePreview.textContent = 'Hatalar düzeltilmeden kod üretilemez.';
    els.statusBadge.textContent = 'Hata var';
    els.statusBadge.className = 'badge bad';
  }
}

function bindEvents() {
  [
    els.mcuSelect,
    els.clockSourceSelect,
    els.pllSelect,
    els.hclkSelect,
    els.uartEnable,
    els.timerEnable,
    els.adcEnable,
    els.uartBaudSelect,
    els.uartPinSelect,
    els.timerModeSelect,
    els.timerFreqInput,
    els.timerInterruptEnable,
    els.adcModeSelect,
    els.adcTriggerSelect,
    els.adcStPinSelect,
    els.adcStConditionSelect
  ].forEach((element) => {
    element.addEventListener('change', () => {
      syncStateFromForm();
      render();
    });
    element.addEventListener('input', () => {
      syncStateFromForm();
      render();
    });
  });

  els.generateBtn.addEventListener('click', () => {
    syncStateFromForm();
    render();
  });

  els.downloadCodeBtn.addEventListener('click', () => {
    if (!generatedCode) return;
    downloadFile('main.c', generatedCode, 'text/plain');
  });

  els.copyCodeBtn.addEventListener('click', async () => {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    els.statusBadge.textContent = 'Kopyalandı';
  });

  els.exportConfigBtn.addEventListener('click', () => {
    syncStateFromForm();
    downloadFile('config.json', JSON.stringify(state, null, 2), 'application/json');
  });

  els.importConfigInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, cloneDefaultState(), imported);
    if (!mcuDb.mcus.some((item) => item.name === state.mcu)) {
      state.mcu = cloneDefaultState().mcu;
    }
    render();
  });

  els.resetBtn.addEventListener('click', () => {
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, cloneDefaultState());
    render();
  });
}

async function init() {
  await loadData();
  fillStaticOptions();
  bindEvents();
  render();
}

init();
