
function getSelectedAdcChannels(state, pinDb) {
  return state.peripherals.adc.channelIndexes.map((index)=>pinDb.adcChannels[index]).filter(Boolean).sort((a,b)=>a.channel-b.channel);
}
function supportedOscillators(mcu) {
  return mcu.clockCapabilities?.oscillators || {};
}
function baseClockNominal(state, mcu, source) {
  const caps = mcu.clockCapabilities || {};
  const map = {
    HIRC: caps.hircNominal || 48000000,
    HXT: caps.hxtNominal || 32000000,
    LIRC: caps.lircNominal || 38400,
    LXT: caps.lxtNominal || 32768,
    MIRC: caps.mircNominal || 4000000,
    PLL: state.clock.pllFreq || caps.pllNominal || mcu.maxHclk
  };
  return map[source] || mcu.maxHclk;
}
export function validateConfig(state, pinDb, mcuDb) {
  const messages=[]; const errors=[]; const warnings=[];
  const mcu = mcuDb.mcus.find((item)=>item.name===state.mcu);
  if (!mcu) return { valid:false, errors:['Geçerli bir MCU seçilmedi.'], warnings, messages };
  const osc = supportedOscillators(mcu);
  for (const [name, enabled] of Object.entries(state.clock.enabled)) {
    if (enabled && !osc[name]) errors.push(`${name} bu MCU tarafından desteklenmiyor.`);
  }
  if (state.clock.pllEnabled && !osc.PLL) errors.push('Bu MCU PLL desteklemiyor.');
  if (state.clock.hclkSource === 'PLL' && !osc.PLL) errors.push('HCLK kaynağı PLL seçildi ama MCU PLL desteklemiyor.');
  if (state.clock.hclk > mcu.maxHclk) errors.push(`HCLK MCU sınırını aşıyor. Maksimum ${mcu.maxHclk} Hz`);
  const needed = [];
  if (state.clock.hclkSource !== 'PLL') needed.push(state.clock.hclkSource);
  if (state.clock.pllEnabled || state.clock.hclkSource === 'PLL' || state.peripherals.uart0.clockSource==='PLL' || state.peripherals.adc.clockSource==='PLL') {
    if (state.clock.pllSource === 'HXT') needed.push('HXT');
    if (state.clock.pllSource === 'HIRC') needed.push('HIRC');
  }
  if (state.peripherals.uart0.enabled && ['HIRC','HXT','LXT','LIRC'].includes(state.peripherals.uart0.clockSource)) needed.push(state.peripherals.uart0.clockSource);
  if (state.peripherals.timer0.enabled && ['HIRC','HXT','LXT','LIRC'].includes(state.peripherals.timer0.clockSource)) needed.push(state.peripherals.timer0.clockSource);
  if (state.peripherals.adc.enabled && ['HIRC','HXT'].includes(state.peripherals.adc.clockSource)) needed.push(state.peripherals.adc.clockSource);
  for (const src of needed) {
    if (!state.clock.enabled[src]) warnings.push(`${src} routing için gerekli. Kod üretiminde otomatik enable edilecek.`);
  }
  const usedPins = new Map();
  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    if (!uartSel) errors.push('UART0 pin kombinasyonu geçersiz.');
    else uartSel.pins.forEach((pin)=>usedPins.set(pin.pin, pin.signal));
  }
  if (state.peripherals.adc.enabled) {
    const adcSelected = getSelectedAdcChannels(state, pinDb);
    if (!adcSelected.length) errors.push('ADC için en az bir kanal seçmelisin.');
    adcSelected.forEach((adcSel)=>{ if (usedPins.has(adcSel.pin)) errors.push(`Pin çakışması var: ${adcSel.pin}`); else usedPins.set(adcSel.pin, `ADC_CH${adcSel.channel}`); });
    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = pinDb.adcStOptions[state.peripherals.adc.stPinIndex];
      if (!stSel) errors.push('ADC ST pin seçimi geçersiz.');
      else if (usedPins.has(stSel.pin)) errors.push(`Pin çakışması var: ${stSel.pin}`); else usedPins.set(stSel.pin, 'ADC_ST');
    }
  }
  if (state.peripherals.timer0.enabled && Number(state.peripherals.timer0.frequency) <= 0) errors.push('Timer frekansı 0 veya negatif olamaz.');
  warnings.push('Pin listesi henüz package bazlı filtrelenmiyor. Fiziksel pinleri ayrıca kontrol et.');
  messages.push(`MCU: ${mcu.displayName}`);
  messages.push(`Enable clocklar: ${Object.entries(state.clock.enabled).filter(([,v])=>v).map(([k])=>k).join(', ') || 'Yok'}`);
  messages.push(`HCLK: ${state.clock.hclkSource} / ${state.clock.hclk.toLocaleString('tr-TR')} Hz`);
  messages.push(`PCLK0: HCLK/${state.clock.pclk0Div} / PCLK1: HCLK/${state.clock.pclk1Div}`);
  if (state.clock.pllEnabled || state.clock.hclkSource === 'PLL') messages.push(`PLL: ${state.clock.pllSource} / ${(state.clock.pllFreq/1000000)} MHz`);
  if (state.peripherals.uart0.enabled) messages.push(`UART0: ${state.peripherals.uart0.clockSource} / ${state.peripherals.uart0.baudrate}`);
  if (state.peripherals.timer0.enabled) messages.push(`TIMER0: ${state.peripherals.timer0.clockSource} / ${state.peripherals.timer0.frequency} Hz`);
  if (state.peripherals.adc.enabled) {
    const adcSelected = getSelectedAdcChannels(state, pinDb);
    messages.push(`ADC: ${state.peripherals.adc.clockSource} / div ${state.peripherals.adc.divider}`);
    messages.push(`ADC kanalları: ${adcSelected.map((item)=>`CH${item.channel} (${item.pin})`).join(', ')}`);
  }
  return { valid: errors.length===0, errors, warnings, messages };
}
