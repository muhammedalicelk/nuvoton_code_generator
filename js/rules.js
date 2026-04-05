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

  if (state.clock.hclk > mcu.maxHclk) {
    errors.push(`HCLK değeri MCU sınırını aşıyor. Maksimum: ${mcu.maxHclk} Hz`);
  }

  if (!state.clock.pllEnabled && state.clock.hclk > 12000000) {
    warnings.push('PLL kapalıyken 12 MHz üzeri HCLK seçimi doğrudan karşılanmayabilir.');
  }

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

  messages.push(`MCU: ${state.mcu}`);
  messages.push(`Clock: ${state.clock.source} / PLL ${state.clock.pllEnabled ? 'Açık' : 'Kapalı'} / HCLK ${state.clock.hclk} Hz`);

  return { valid: errors.length === 0, errors, warnings, messages };
}
