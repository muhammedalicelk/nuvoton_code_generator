
function getAllowedPllSources(mcu) {
  if (!mcu) return ['HIRC_DIV4'];
  if (mcu.name && /^M031(?!BT)/.test(mcu.name)) return ['HIRC_DIV4'];
  const opts = mcu.clockCapabilities?.pllSourceOptions || ['HIRC_DIV4'];
  return opts.length ? opts : ['HIRC_DIV4'];
}

function getSelectedAdcChannels(state, pinDb) {
  return state.peripherals.adc.channelIndexes
    .map((index) => pinDb.adcChannels[index])
    .filter(Boolean)
    .sort((a, b) => a.channel - b.channel);
}

export function validateConfig(state, pinDb, mcuDb) {
  const messages = [];
  const errors = [];
  const warnings = [];

  const mcu = mcuDb.mcus.find((item) => item.name === state.mcu);
  if (!mcu) {
    errors.push('Geçerli bir MCU seçilmedi.');
    return { valid: false, errors, warnings, messages };
  }

  const allowedSources = mcu.clockSources || [];
  if (!allowedSources.includes(state.clock.source)) {
    errors.push(`Seçilen MCU için ${state.clock.source} clock kaynağı desteklenmiyor.`);
  }

  const allowedHclk = ((mcu.hclkOptionsBySource || {})[state.clock.source] || [mcu.maxHclk]);
  if (!allowedHclk.includes(state.clock.hclk)) {
    errors.push(`Seçilen MCU için ${state.clock.source} kaynağında HCLK ${state.clock.hclk} Hz desteklenmiyor.`);
  }

  if (state.clock.hclk > mcu.maxHclk) {
    errors.push(`HCLK değeri MCU sınırını aşıyor. Maksimum: ${mcu.maxHclk} Hz`);
  }

  if (state.clock.source === 'PLL') {
    const pllSources = getAllowedPllSources(mcu);
    if (!pllSources.includes(state.clock.pllSource)) {
      errors.push(`Seçilen MCU için PLL kaynağı ${state.clock.pllSource} desteklenmiyor.`);
    }
  }

  warnings.push('Pin listesi henüz package bazlı filtrelenmiyor. Fiziksel pinleri ayrıca kontrol et.');

  if (state.peripherals.timer0.enabled && Number(state.peripherals.timer0.frequency) <= 0) {
    errors.push('Timer frekansı 0 veya negatif olamaz.');
  }

  const usedPins = new Map();

  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    if (!uartSel) {
      errors.push('UART0 pin kombinasyonu geçersiz.');
    } else {
      uartSel.pins.forEach((pin) => usedPins.set(pin.pin, pin.signal));
    }
  }

  if (state.peripherals.adc.enabled) {
    const adcSelected = getSelectedAdcChannels(state, pinDb);
    if (adcSelected.length === 0) {
      errors.push('ADC için en az bir kanal seçmelisin.');
    }

    adcSelected.forEach((adcSel) => {
      if (usedPins.has(adcSel.pin)) {
        errors.push(`Pin çakışması var: ${adcSel.pin} hem ${usedPins.get(adcSel.pin)} hem ADC için seçilmiş.`);
      } else {
        usedPins.set(adcSel.pin, `ADC_CH${adcSel.channel}`);
      }
    });

    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = pinDb.adcStOptions[state.peripherals.adc.stPinIndex];
      if (!stSel) {
        errors.push('ADC ST pin seçimi geçersiz.');
      } else if (usedPins.has(stSel.pin)) {
        errors.push(`Pin çakışması var: ${stSel.pin} hem ${usedPins.get(stSel.pin)} hem ADC_ST için seçilmiş.`);
      } else {
        usedPins.set(stSel.pin, 'ADC_ST');
      }
      warnings.push('External STADC seçildiğinde dönüşüm dış ST pininden tetiklenecek; ana döngüde software start çağrılmayacak.');
    }

    if (adcSelected.length > 1 && state.peripherals.adc.mode === 'single') {
      warnings.push('Birden fazla ADC kanalı seçildiği için kod üretiminde Single Cycle Scan kullanılacak.');
    }
  }

  if (!state.peripherals.uart0.enabled && !state.peripherals.timer0.enabled && !state.peripherals.adc.enabled) {
    warnings.push('Hiç çevresel seçilmedi. Sadece temel clock iskeleti üretilecek.');
  }

  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    messages.push(`UART0 pin seti: ${uartSel.label}`);
  }

  if (state.peripherals.adc.enabled) {
    const adcSelected = getSelectedAdcChannels(state, pinDb);
    messages.push(`ADC kanalları: ${adcSelected.map((item) => `CH${item.channel} (${item.pin})`).join(', ')}`);
    messages.push('ADC sonuçları global değişkenlere yazılacak.');
    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = pinDb.adcStOptions[state.peripherals.adc.stPinIndex];
      messages.push(`ADC ST pini: ${stSel.label} / koşul: ${state.peripherals.adc.stCondition}`);
    }
  }

  const available = Object.entries(mcu.clockCapabilities?.oscillators || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  messages.push(`MCU: ${mcu.name} / Paket: ${mcu.package}`);
  messages.push(`Clock profili: ${mcu.clockProfile}`);
  messages.push(`Mevcut kaynaklar: ${available}`);
  const pllMsg = state.clock.source === 'PLL' ? ` / PLL kaynağı ${state.clock.pllSource}` : '';
  messages.push(`Clock: ${state.clock.source}${pllMsg} / HCLK ${state.clock.hclk} Hz`);

  return { valid: errors.length === 0, errors, warnings, messages };
}
