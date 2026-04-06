import { cloneDefaultState } from './state.js?v=17';
import { validateConfig } from './rules.js?v=17';
import { generateCode } from './generator.js?v=17';
import { setOptions, showMessages, downloadFile } from './ui.js?v=17';

const state = cloneDefaultState();
let mcuDb;
let pinDb;
let generatedCode = '';

const els = {
  mcuSelect: document.getElementById('mcuSelect'),
  mcuMeta: document.getElementById('mcuMeta'),
  baseClockList: document.getElementById('baseClockList'),
  enabledClockSummary: document.getElementById('enabledClockSummary'),
  pllEnableSelect: document.getElementById('pllEnableSelect'),
  pllSourceSelect: document.getElementById('pllSourceSelect'),
  pllFreqSelect: document.getElementById('pllFreqSelect'),
  hclkSourceSelect: document.getElementById('hclkSourceSelect'),
  hclkSelect: document.getElementById('hclkSelect'),
  hclkInfo: document.getElementById('hclkInfo'),
  pclk0DivSelect: document.getElementById('pclk0DivSelect'),
  pclk1DivSelect: document.getElementById('pclk1DivSelect'),
  uartEnable: document.getElementById('uartEnable'),
  timerEnable: document.getElementById('timerEnable'),
  adcEnable: document.getElementById('adcEnable'),
  uartSection: document.getElementById('uartSection'),
  timerSection: document.getElementById('timerSection'),
  adcSection: document.getElementById('adcSection'),
  uartClockSourceSelect: document.getElementById('uartClockSourceSelect'),
  timerClockSourceSelect: document.getElementById('timerClockSourceSelect'),
  adcClockSourceSelect: document.getElementById('adcClockSourceSelect'),
  uartBaudSelect: document.getElementById('uartBaudSelect'),
  uartPinSelect: document.getElementById('uartPinSelect'),
  timerModeSelect: document.getElementById('timerModeSelect'),
  timerFreqInput: document.getElementById('timerFreqInput'),
  timerInterruptEnable: document.getElementById('timerInterruptEnable'),
  adcDividerSelect: document.getElementById('adcDividerSelect'),
  adcModeSelect: document.getElementById('adcModeSelect'),
  adcTriggerSelect: document.getElementById('adcTriggerSelect'),
  adcStSection: document.getElementById('adcStSection'),
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

const CLOCK_LABELS = { HIRC:'HIRC', HXT:'HXT', LIRC:'LIRC', LXT:'LXT', MIRC:'MIRC' };
const PLL_FREQ_PRESETS = [48000000, 72000000, 96000000];

function getCurrentMcu() { return mcuDb.mcus.find((item) => item.name === state.mcu) || mcuDb.mcus[0]; }
function getOscCaps(mcu) { return mcu?.clockCapabilities?.oscillators || {}; }
function supportedBaseSources(mcu) { return ['HIRC','HXT','LIRC','LXT','MIRC'].filter((key) => getOscCaps(mcu)[key]); }
function supportedHclkSources(mcu) { const list = [...supportedBaseSources(mcu)]; if (getOscCaps(mcu).PLL) list.push('PLL'); return list; }
function pllSourceOptions(mcu) {
  const opts = mcu?.clockCapabilities?.pllSourceOptions || [];
  return opts.map((value) => ({ value: value === 'HIRC' ? 'HIRC' : value, label: value === 'HIRC' ? 'HIRC' : value }));
}
function clockNominal(mcu, source) {
  const caps = mcu?.clockCapabilities || {};
  const map = {
    HIRC: caps.hircNominal || 48000000,
    HXT: state.clock.enabled.HXT && state.clock.hxtFreq ? state.clock.hxtFreq : (caps.hxtNominal || 32000000),
    LIRC: caps.lircNominal || 38400,
    LXT: caps.lxtNominal || 32768,
    MIRC: caps.mircNominal || 4000000,
    PLL: state.clock.pllFreq || caps.pllNominal || mcu?.maxHclk || 48000000
  };
  return map[source] || (mcu?.maxHclk || 48000000);
}
function hclkOptionsForSource(mcu, source) {
  const nominal = clockNominal(mcu, source);
  const vals = [];
  for (let div=1; div<=16; div++) {
    const value = Math.floor(nominal/div);
    if (value > 0 && value <= mcu.maxHclk && !vals.includes(value)) vals.push(value);
  }
  vals.sort((a,b)=>b-a);
  return vals.map((value)=>({ value:String(value), label:value.toLocaleString('tr-TR') }));
}
function moduleClockOptions(type, mcu) {
  const caps = getOscCaps(mcu);
  const sourceEnabled = state.clock.enabled;
  if (type === 'uart0') {
    const opts = [];
    if (caps.HIRC) opts.push({value:'HIRC', label:'HIRC'});
    if (caps.HXT) opts.push({value:'HXT', label:'HXT'});
    if (caps.LXT) opts.push({value:'LXT', label:'LXT'});
    if (caps.LIRC) opts.push({value:'LIRC', label:'LIRC'});
    opts.push({value:'PCLK0', label:'PCLK0'});
    if (caps.PLL || getOscCaps(mcu).PLL) opts.push({value:'PLL', label:'PLL'});
    return opts;
  }
  if (type === 'timer0') {
    const opts=[];
    if (caps.HXT) opts.push({value:'HXT', label:'HXT'});
    if (caps.LXT) opts.push({value:'LXT', label:'LXT'});
    opts.push({value:'PCLK0', label:'PCLK0'});
    if (caps.LIRC) opts.push({value:'LIRC', label:'LIRC'});
    if (caps.HIRC) opts.push({value:'HIRC', label:'HIRC'});
    return opts;
  }
  if (type === 'adc') {
    const opts=[];
    if (caps.HXT) opts.push({value:'HXT', label:'HXT'});
    if (getOscCaps(mcu).PLL) opts.push({value:'PLL', label:'PLL'});
    opts.push({value:'PCLK1', label:'PCLK1'});
    if (caps.HIRC) opts.push({value:'HIRC', label:'HIRC'});
    return opts;
  }
  return [];
}
function renderBaseClocks() {
  const mcu = getCurrentMcu();
  const caps = mcu.clockCapabilities || {};
  els.baseClockList.innerHTML = '';
  supportedBaseSources(mcu).forEach((source) => {
    const wrap = document.createElement('div');
    wrap.className = 'clock-item';
    const nominal = clockNominal(mcu, source);
    wrap.innerHTML = `<div class="clock-name">${CLOCK_LABELS[source]}</div><div class="clock-meta">${nominal.toLocaleString('tr-TR')} Hz</div>`;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(state.clock.enabled[source]);
    input.addEventListener('change', () => {
      state.clock.enabled[source] = input.checked;
      if (!input.checked && state.clock.hclkSource === source) state.clock.hclkSource = supportedHclkSources(mcu)[0];
      render();
    });
    label.appendChild(input);
    label.append(` Enable ${CLOCK_LABELS[source]}`);
    wrap.appendChild(document.createElement('div')).appendChild(label);
    if (source === 'HXT') {
      const sub = document.createElement('div');
      sub.className = 'clock-meta top-gap';
      sub.textContent = `Aralık: ${caps.hxtRange || '4~32MHz'}`;
      wrap.appendChild(sub);
    }
    els.baseClockList.appendChild(wrap);
  });
}

function renderEnabledClockSummary() {
  const enabled = Object.entries(state.clock.enabled)
    .filter(([, on]) => on)
    .map(([name]) => name);
  if (state.clock.pllEnabled) enabled.push(`PLL(${state.clock.pllSource})`);
  els.enabledClockSummary.innerHTML = enabled.length
    ? `<strong>Enable edilen kaynaklar:</strong> ${enabled.join(', ')}`
    : '<strong>Enable edilen kaynaklar:</strong> yok';
}

function normalizeStateForMcu() {
  const mcu = getCurrentMcu();
  const caps = getOscCaps(mcu);
  Object.keys(state.clock.enabled).forEach((key)=>{ if (!caps[key]) state.clock.enabled[key] = false; });
  if (!caps.HIRC && supportedBaseSources(mcu)[0]) state.clock.enabled[supportedBaseSources(mcu)[0]] = true;
  if (!supportedHclkSources(mcu).includes(state.clock.hclkSource)) state.clock.hclkSource = supportedHclkSources(mcu)[0];
  if (!caps.PLL) state.clock.pllEnabled = false;
  const pllOpts = pllSourceOptions(mcu).map(o=>o.value);
  if (pllOpts.length && !pllOpts.includes(state.clock.pllSource)) state.clock.pllSource = pllOpts[0];
  if (!PLL_FREQ_PRESETS.includes(state.clock.pllFreq)) state.clock.pllFreq = PLL_FREQ_PRESETS[0];
}
function applyDependencies() {
  const mcu = getCurrentMcu();
  const caps = getOscCaps(mcu);
  if (state.clock.hclkSource !== 'PLL') state.clock.enabled[state.clock.hclkSource] = true;
  if (state.clock.pllEnabled || state.clock.hclkSource === 'PLL' || state.peripherals.uart0.clockSource === 'PLL' || state.peripherals.adc.clockSource === 'PLL') {
    if (caps.PLL) state.clock.pllEnabled = true;
    if (state.clock.pllSource === 'HXT') state.clock.enabled.HXT = true;
    if (state.clock.pllSource === 'HIRC') state.clock.enabled.HIRC = true;
  }
  if (state.peripherals.uart0.enabled && ['HIRC','HXT','LXT','LIRC'].includes(state.peripherals.uart0.clockSource)) state.clock.enabled[state.peripherals.uart0.clockSource] = true;
  if (state.peripherals.timer0.enabled && ['HIRC','HXT','LXT','LIRC'].includes(state.peripherals.timer0.clockSource)) state.clock.enabled[state.peripherals.timer0.clockSource] = true;
  if (state.peripherals.adc.enabled && ['HIRC','HXT'].includes(state.peripherals.adc.clockSource)) state.clock.enabled[state.peripherals.adc.clockSource] = true;
}
function renderMcuMeta() {
  const mcu = getCurrentMcu();
  const caps = mcu.clockCapabilities || {};
  const available = supportedHclkSources(mcu).join(', ');
  els.mcuMeta.innerHTML = [`<div><strong>${mcu.displayName}</strong></div>`,`<div><strong>Paket:</strong> ${mcu.package}</div>`,`<div><strong>Maks. HCLK:</strong> ${mcu.maxHclk.toLocaleString('tr-TR')} Hz</div>`,`<div><strong>Kaynaklar:</strong> ${available}</div>`,`<div><strong>HXT:</strong> ${caps.hxtRange || '—'}</div>`].join('');
}
function renderAdcChannelList() {
  els.adcChannelList.innerHTML = '';
  pinDb.adcChannels.forEach((channel, index) => {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.peripherals.adc.channelIndexes.includes(index);
    input.addEventListener('change', () => {
      const set = new Set(state.peripherals.adc.channelIndexes);
      if (input.checked) set.add(index); else set.delete(index);
      state.peripherals.adc.channelIndexes = [...set].sort((a,b)=>a-b);
      render();
    });
    label.appendChild(input); label.append(` ${channel.label}`); els.adcChannelList.appendChild(label);
  });
}
function fillStaticOptions() {
  setOptions(els.mcuSelect, mcuDb.mcus.map((item) => ({ value: item.name, label: item.displayName })));
  setOptions(els.uartPinSelect, pinDb.uart0Options, 'index', 'label');
  setOptions(els.adcStPinSelect, pinDb.adcStOptions, 'index', 'label');
  setOptions(els.pllFreqSelect, PLL_FREQ_PRESETS.map(v=>({value:String(v), label:`${v/1000000} MHz`}))); 
}
function renderDynamicOptions() {
  const mcu = getCurrentMcu();
  normalizeStateForMcu();
  renderBaseClocks();
  renderEnabledClockSummary();
  setOptions(els.pllSourceSelect, pllSourceOptions(mcu));
  els.pllEnableSelect.disabled = !getOscCaps(mcu).PLL;
  const hclkSourceOpts = supportedHclkSources(mcu).filter((src)=> src !== 'PLL' || getOscCaps(mcu).PLL).map((src)=>({value:src,label:src}));
  setOptions(els.hclkSourceSelect, hclkSourceOpts);
  if (!hclkSourceOpts.map(x=>x.value).includes(state.clock.hclkSource)) state.clock.hclkSource = hclkSourceOpts[0]?.value || 'HIRC';
  setOptions(els.hclkSelect, hclkOptionsForSource(mcu, state.clock.hclkSource));
  if (!hclkOptionsForSource(mcu, state.clock.hclkSource).map(x=>Number(x.value)).includes(state.clock.hclk)) state.clock.hclk = Number(hclkOptionsForSource(mcu, state.clock.hclkSource)[0]?.value || mcu.maxHclk);
  setOptions(els.uartClockSourceSelect, moduleClockOptions('uart0', mcu));
  setOptions(els.timerClockSourceSelect, moduleClockOptions('timer0', mcu));
  setOptions(els.adcClockSourceSelect, moduleClockOptions('adc', mcu));
  for (const [type, select] of [['uart0',els.uartClockSourceSelect],['timer0',els.timerClockSourceSelect],['adc',els.adcClockSourceSelect]]) {
    const opts=[...select.options].map(o=>o.value);
    const current=state.peripherals[type].clockSource;
    if (!opts.includes(current)) state.peripherals[type].clockSource = opts[0];
  }
  applyDependencies();
  renderMcuMeta();
  const pclk0 = Math.floor(state.clock.hclk / state.clock.pclk0Div);
  const pclk1 = Math.floor(state.clock.hclk / state.clock.pclk1Div);
  els.hclkInfo.innerHTML = `<strong>HCLK:</strong> ${state.clock.hclk.toLocaleString('tr-TR')} Hz<br><strong>PCLK0:</strong> ${pclk0.toLocaleString('tr-TR')} Hz<br><strong>PCLK1:</strong> ${pclk1.toLocaleString('tr-TR')} Hz`;
}
function syncFormFromState() {
  renderDynamicOptions();
  els.mcuSelect.value = state.mcu;
  els.pllEnableSelect.value = String(state.clock.pllEnabled);
  if ([...els.pllSourceSelect.options].some(o=>o.value===state.clock.pllSource)) els.pllSourceSelect.value = state.clock.pllSource;
  els.pllFreqSelect.value = String(state.clock.pllFreq);
  els.hclkSourceSelect.value = state.clock.hclkSource;
  els.hclkSelect.value = String(state.clock.hclk);
  els.pclk0DivSelect.value = String(state.clock.pclk0Div);
  els.pclk1DivSelect.value = String(state.clock.pclk1Div);
  els.uartEnable.checked = state.peripherals.uart0.enabled;
  els.timerEnable.checked = state.peripherals.timer0.enabled;
  els.adcEnable.checked = state.peripherals.adc.enabled;
  els.uartBaudSelect.value = String(state.peripherals.uart0.baudrate);
  els.uartPinSelect.value = String(state.peripherals.uart0.pinIndex);
  els.uartClockSourceSelect.value = state.peripherals.uart0.clockSource;
  els.timerClockSourceSelect.value = state.peripherals.timer0.clockSource;
  els.adcClockSourceSelect.value = state.peripherals.adc.clockSource;
  els.timerModeSelect.value = state.peripherals.timer0.mode;
  els.timerFreqInput.value = state.peripherals.timer0.frequency;
  els.timerInterruptEnable.checked = state.peripherals.timer0.interruptEnabled;
  els.adcDividerSelect.value = String(state.peripherals.adc.divider);
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
  state.mcu = els.mcuSelect.value;
  normalizeStateForMcu();
  state.clock.pllEnabled = els.pllEnableSelect.value === 'true';
  state.clock.pllSource = els.pllSourceSelect.value;
  state.clock.pllFreq = Number(els.pllFreqSelect.value);
  state.clock.hclkSource = els.hclkSourceSelect.value;
  state.clock.hclk = Number(els.hclkSelect.value);
  state.clock.pclk0Div = Number(els.pclk0DivSelect.value);
  state.clock.pclk1Div = Number(els.pclk1DivSelect.value);
  state.peripherals.uart0.enabled = els.uartEnable.checked;
  state.peripherals.timer0.enabled = els.timerEnable.checked;
  state.peripherals.adc.enabled = els.adcEnable.checked;
  state.peripherals.uart0.clockSource = els.uartClockSourceSelect.value;
  state.peripherals.timer0.clockSource = els.timerClockSourceSelect.value;
  state.peripherals.adc.clockSource = els.adcClockSourceSelect.value;
  state.peripherals.uart0.baudrate = Number(els.uartBaudSelect.value);
  state.peripherals.uart0.pinIndex = Number(els.uartPinSelect.value);
  state.peripherals.timer0.mode = els.timerModeSelect.value;
  state.peripherals.timer0.frequency = Number(els.timerFreqInput.value);
  state.peripherals.timer0.interruptEnabled = els.timerInterruptEnable.checked;
  state.peripherals.adc.divider = Number(els.adcDividerSelect.value);
  state.peripherals.adc.mode = els.adcModeSelect.value;
  state.peripherals.adc.trigger = els.adcTriggerSelect.value;
  state.peripherals.adc.stPinIndex = Number(els.adcStPinSelect.value);
  state.peripherals.adc.stCondition = els.adcStConditionSelect.value;
  applyDependencies();
}
function attachEvents() {
  [els.mcuSelect, els.pllEnableSelect, els.pllSourceSelect, els.pllFreqSelect, els.hclkSourceSelect, els.hclkSelect, els.pclk0DivSelect, els.pclk1DivSelect, els.uartEnable, els.timerEnable, els.adcEnable, els.uartClockSourceSelect, els.timerClockSourceSelect, els.adcClockSourceSelect, els.uartBaudSelect, els.uartPinSelect, els.timerModeSelect, els.timerFreqInput, els.timerInterruptEnable, els.adcDividerSelect, els.adcModeSelect, els.adcTriggerSelect, els.adcStPinSelect, els.adcStConditionSelect].forEach((el)=>{
    el.addEventListener('change', () => { syncStateFromForm(); render(); });
  });
  els.generateBtn.addEventListener('click', render);
  els.downloadCodeBtn.addEventListener('click', ()=>downloadFile('main.c', generatedCode));
  els.copyCodeBtn.addEventListener('click', async ()=>{ await navigator.clipboard.writeText(generatedCode); els.statusBadge.textContent='Kopyalandı'; setTimeout(()=>els.statusBadge.textContent='Hazır', 1400); });
  els.exportConfigBtn.addEventListener('click', ()=>downloadFile('config.json', JSON.stringify(state,null,2), 'application/json'));
  els.importConfigInput.addEventListener('change', async (event)=>{
    const file = event.target.files?.[0]; if (!file) return; const imported = JSON.parse(await file.text()); Object.assign(state, imported); render();
  });
  els.resetBtn.addEventListener('click', ()=>{ Object.assign(state, cloneDefaultState()); render(); });
}
function render() {
  syncFormFromState();
  const result = validateConfig(state, pinDb, mcuDb);
  generatedCode = generateCode(state, pinDb, mcuDb);
  els.codePreview.textContent = generatedCode;
  showMessages(els.messages, result);
  els.statusBadge.textContent = result.valid ? 'Geçerli' : 'Hata var';
}
async function loadData() {
  const [mcuRes, pinRes] = await Promise.all([fetch('./data/mcus.json'), fetch('./data/pins_m031fb.json')]);
  mcuDb = await mcuRes.json();
  pinDb = await pinRes.json();
}
async function init() { await loadData(); fillStaticOptions(); attachEvents(); render(); }
init();
