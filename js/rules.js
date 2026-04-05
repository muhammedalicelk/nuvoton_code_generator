export function validateConfig(state, pinDb, mcuDb) {
  const messages = [];
  const errors = [];
  const warnings = [];

  const mcu = mcuDb.mcus.find((item) => item.name === state.mcu);
  if (!mcu) {
    errors.push('Geçerli bir MCU seçilmedi.');
    return { valid: false, errors, warnings, messages };
  }

  if (state.clock.hclk > mcu.maxHclk) {
    errors.push(`HCLK değeri MCU sınırını aşıyor. Maksimum: ${mcu.maxHclk} Hz`);
  }

  if (state.clock.source === 'HXT' && state.clock.pllEnabled === false && state.clock.hclk > 12000000) {
    warnings.push('HXT seçili ve PLL kapalı. Bu durumda yüksek HCLK değeri gerçek donanım akışında ek clock ayarı gerektirebilir.');
  }

  if (state.peripherals.timer0.enabled && Number(state.peripherals.timer0.frequency) <= 0) {
    errors.push('Timer frekansı 0 veya negatif olamaz.');
  }

  if (state.peripherals.uart0.enabled && Number(state.peripherals.uart0.baudrate) < 1200) {
    warnings.push('UART baudrate oldukça düşük görünüyor.');
  }

  const usedPins = new Map();

  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    if (!uartSel) {
      errors.push('UART0 pin seçimi geçersiz.');
    } else {
      usedPins.set(uartSel.rxPin, 'UART0_RXD');
      usedPins.set(uartSel.txPin, 'UART0_TXD');
    }
  }

  if (state.peripherals.adc.enabled) {
    const adcSel = pinDb.adcChannels[state.peripherals.adc.channelIndex];
    if (!adcSel) {
      errors.push('ADC kanal seçimi geçersiz.');
    } else if (usedPins.has(adcSel.pin)) {
      errors.push(`Pin çakışması var: ${adcSel.pin} hem ${usedPins.get(adcSel.pin)} hem ADC için seçilmiş.`);
    } else {
      usedPins.set(adcSel.pin, `ADC_CH${adcSel.channel}`);
    }
  }

  if (!state.peripherals.uart0.enabled && !state.peripherals.timer0.enabled && !state.peripherals.adc.enabled) {
    warnings.push('Hiç çevresel seçilmedi. Sadece temel clock iskeleti üretilecek.');
  }

  messages.push(`MCU: ${state.mcu}`);
  messages.push(`Clock: ${state.clock.source} / PLL ${state.clock.pllEnabled ? 'Açık' : 'Kapalı'} / HCLK ${state.clock.hclk} Hz`);

  return { valid: errors.length === 0, errors, warnings, messages };
}
