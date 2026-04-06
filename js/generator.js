function getSelectedAdcChannels(state, pinDb) {
  return state.peripherals.adc.channelIndexes
    .map((index) => pinDb.adcChannels[index])
    .filter(Boolean)
    .sort((a, b) => a.channel - b.channel);
}

function getSelectedStPin(state, pinDb) {
  return pinDb.adcStOptions[state.peripherals.adc.stPinIndex] || null;
}

function getCurrentMcu(state, mcuDb) {
  return mcuDb?.mcus?.find((item) => item.name === state.mcu) || null;
}

function oscStatusMacro(source) {
  return {
    HIRC: 'CLK_STATUS_HIRCSTB_Msk',
    HXT: 'CLK_STATUS_HXTSTB_Msk',
    LIRC: 'CLK_STATUS_LIRCSTB_Msk',
    LXT: 'CLK_STATUS_LXTSTB_Msk'
  }[source];
}

function oscEnableMacro(source) {
  return {
    HIRC: 'CLK_PWRCTL_HIRCEN_Msk',
    HXT: 'CLK_PWRCTL_HXTEN_Msk',
    LIRC: 'CLK_PWRCTL_LIRCEN_Msk',
    LXT: 'CLK_PWRCTL_LXTEN_Msk'
  }[source];
}

function sourceToHclkMacro(source) {
  return {
    HIRC: 'CLK_CLKSEL0_HCLKSEL_HIRC',
    HXT: 'CLK_CLKSEL0_HCLKSEL_HXT',
    LIRC: 'CLK_CLKSEL0_HCLKSEL_LIRC',
    LXT: 'CLK_CLKSEL0_HCLKSEL_LXT'
  }[source];
}

function getClockNominal(state, mcu, source) {
  const caps = mcu?.clockCapabilities || {};
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

function getDivider(nominal, target) {
  const div = Math.max(1, Math.min(16, Math.round(nominal / target)));
  return div;
}

function computeExactPllctl(state, mcu) {
  const source = state.clock.pllSource;
  const target = Number(state.clock.pllFreq || 0);
  const caps = mcu?.clockCapabilities || {};
  const fin = source === 'HXT' ? Number(caps.hxtNominal || 32000000) : Number(caps.hircNominal || 48000000) / 4;
  const srcBit = source === 'HXT' ? 0 : 1;
  const preferredOutDividers = target >= 100000000 ? [2, 4, 1] : [4, 2, 1];
  const candidates = [];

  for (const no of preferredOutDividers) {
    for (let nr = 2; nr <= 31; nr++) {
      const numerator = target * nr * no;
      if (numerator % fin !== 0) continue;
      const nf = numerator / fin;
      if (nf < 2 || nf > 511) continue;

      const finDivNr = fin / nr;
      const vco = (fin * nf) / nr;
      if (!(finDivNr > 1600000 && finDivNr < 16000000)) continue;
      if (!(vco >= 200000000 && vco <= 500000000)) continue;

      const outdivBits = no === 1 ? 0 : (no === 2 ? 1 : 3);
      const value = (srcBit << 19) | (outdivBits << 14) | ((nr - 2) << 9) | (nf - 2);
      candidates.push({
        no, nr, nf, value, real: (fin * nf) / nr / no
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.no !== b.no) return a.no - b.no;
    if (a.nr !== b.nr) return a.nr - b.nr;
    return a.nf - b.nf;
  });

  return candidates[0];
}

function formatHexPllctl(value) {
  return `0x${value.toString(16).toUpperCase().padStart(8, '0')}UL`;
}

function requiredEnabledSources(state) {
  const set = new Set();
  for (const [key, value] of Object.entries(state.clock.enabled)) {
    if (value) set.add(key);
  }

  if (state.clock.hclkSource !== 'PLL') {
    set.add(state.clock.hclkSource);
  }

  if (
    state.clock.pllEnabled ||
    state.clock.hclkSource === 'PLL' ||
    state.peripherals.uart0.clockSource === 'PLL' ||
    state.peripherals.adc.clockSource === 'PLL'
  ) {
    if (state.clock.pllSource === 'HXT') set.add('HXT');
    if (state.clock.pllSource === 'HIRC_DIV4') set.add('HIRC');
  }

  if (state.peripherals.uart0.enabled && ['HIRC', 'HXT', 'LXT', 'LIRC'].includes(state.peripherals.uart0.clockSource)) {
    set.add(state.peripherals.uart0.clockSource);
  }

  if (state.peripherals.timer0.enabled && ['HIRC', 'HXT', 'LXT', 'LIRC'].includes(state.peripherals.timer0.clockSource)) {
    set.add(state.peripherals.timer0.clockSource);
  }

  if (state.peripherals.adc.enabled && ['HIRC', 'HXT'].includes(state.peripherals.adc.clockSource)) {
    set.add(state.peripherals.adc.clockSource);
  }

  return [...set];
}

function buildClockCode(state, mcuDb) {
  const mcu = getCurrentMcu(state, mcuDb);
  const lines = [];
  const enabled = requiredEnabledSources(state);

  lines.push(`    /* User-enabled clocks: ${enabled.join(', ') || 'none'} */`);

  enabled.forEach((source) => {
    if (!oscEnableMacro(source)) return;
    lines.push(`    /* Enable ${source} */`);
    lines.push(`    CLK_EnableXtalRC(${oscEnableMacro(source)});`);
    lines.push(`    CLK_WaitClockReady(${oscStatusMacro(source)});`);
  });

  if (
    state.clock.pllEnabled ||
    state.clock.hclkSource === 'PLL' ||
    state.peripherals.uart0.clockSource === 'PLL' ||
    state.peripherals.adc.clockSource === 'PLL'
  ) {
    const pll = computeExactPllctl(state, mcu);
    lines.push('    /* Enable PLL using exact PLLCTL candidate */');
    if (pll) {
      lines.push(`    /* PLL source: ${state.clock.pllSource}, target: ${state.clock.pllFreq} Hz, NR=${pll.nr}, NF=${pll.nf}, NO=${pll.no} */`);
      lines.push(`    CLK->PLLCTL = (CLK->PLLCTL & ~(0x000FFFFFUL)) | ${formatHexPllctl(pll.value)};`);
    } else {
      const pllSrc = state.clock.pllSource === 'HXT' ? 'CLK_PLLCTL_PLLSRC_HXT' : 'CLK_PLLCTL_PLLSRC_HIRC_DIV4';
      lines.push(`    CLK_EnablePLL(${pllSrc}, ${state.clock.pllFreq});`);
    }
    lines.push('    CLK_WaitClockReady(CLK_STATUS_PLLSTB_Msk);');
  }

  const hNom = getClockNominal(state, mcu, state.clock.hclkSource);
  const hDiv = getDivider(hNom, state.clock.hclk);

  if (state.clock.hclkSource === 'PLL') {
    lines.push(`    CLK_SetHCLK(CLK_CLKSEL0_HCLKSEL_PLL, CLK_CLKDIV0_HCLK(${hDiv}));`);
  } else {
    lines.push(`    CLK_SetHCLK(${sourceToHclkMacro(state.clock.hclkSource)}, CLK_CLKDIV0_HCLK(${hDiv}));`);
  }

  lines.push(`    CLK->PCLKDIV = (CLK_PCLKDIV_APB0DIV_DIV${state.clock.pclk0Div} | CLK_PCLKDIV_APB1DIV_DIV${state.clock.pclk1Div});`);
  lines.push('    SystemCoreClockUpdate();');
  return lines.join('\n');
}

function moduleClockLine(module, source, divider = 1) {
  const map = {
    UART0: {
      HXT: 'CLK_CLKSEL1_UART0SEL_HXT',
      PLL: 'CLK_CLKSEL1_UART0SEL_PLL',
      LXT: 'CLK_CLKSEL1_UART0SEL_LXT',
      HIRC: 'CLK_CLKSEL1_UART0SEL_HIRC',
      PCLK0: 'CLK_CLKSEL1_UART0SEL_PCLK0',
      LIRC: 'CLK_CLKSEL1_UART0SEL_LIRC',
      div: `CLK_CLKDIV0_UART0(${divider})`
    },
    TMR0: {
      HXT: 'CLK_CLKSEL1_TMR0SEL_HXT',
      LXT: 'CLK_CLKSEL1_TMR0SEL_LXT',
      PCLK0: 'CLK_CLKSEL1_TMR0SEL_PCLK0',
      LIRC: 'CLK_CLKSEL1_TMR0SEL_LIRC',
      HIRC: 'CLK_CLKSEL1_TMR0SEL_HIRC',
      div: '0'
    },
    ADC: {
      HXT: 'CLK_CLKSEL2_ADCSEL_HXT',
      PLL: 'CLK_CLKSEL2_ADCSEL_PLL',
      PCLK1: 'CLK_CLKSEL2_ADCSEL_PCLK1',
      HIRC: 'CLK_CLKSEL2_ADCSEL_HIRC',
      div: `CLK_CLKDIV0_ADC(${divider})`
    }
  };
  const cfg = map[module];
  return `    CLK_SetModuleClock(${module}_MODULE, ${cfg[source]}, ${cfg.div});`;
}

function buildModuleClockCode(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) {
    lines.push('    CLK_EnableModuleClock(UART0_MODULE);');
    lines.push(moduleClockLine('UART0', state.peripherals.uart0.clockSource, 1));
  }
  if (state.peripherals.timer0.enabled) {
    lines.push('    CLK_EnableModuleClock(TMR0_MODULE);');
    lines.push(moduleClockLine('TMR0', state.peripherals.timer0.clockSource, 1));
  }
  if (state.peripherals.adc.enabled) {
    lines.push('    CLK_EnableModuleClock(ADC_MODULE);');
    lines.push(moduleClockLine('ADC', state.peripherals.adc.clockSource, state.peripherals.adc.divider));
  }
  return lines.join('\n') || '    /* No module clock selected */';
}

function addPinAssignment(groups, registerName, mask, value) {
  if (!groups.has(registerName)) {
    groups.set(registerName, { masks: [], values: [] });
  }
  groups.get(registerName).masks.push(mask);
  groups.get(registerName).values.push(value);
}

function buildMfpGroups(state, pinDb) {
  const groups = new Map();

  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    if (uartSel) {
      uartSel.pins.forEach((pin) => addPinAssignment(groups, uartSel.register, pin.mask, pin.value));
    }
  }

  if (state.peripherals.adc.enabled) {
    getSelectedAdcChannels(state, pinDb).forEach((adcSel) => addPinAssignment(groups, adcSel.register, adcSel.mask, adcSel.value));
    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = getSelectedStPin(state, pinDb);
      if (stSel) addPinAssignment(groups, stSel.register, stSel.mask, stSel.value);
    }
  }

  return groups;
}

function buildAdcPortMasks(state, pinDb) {
  const portMasks = new Map();
  getSelectedAdcChannels(state, pinDb).forEach((adcSel) => {
    const [port, bit] = adcSel.pin.split('.');
    if (!portMasks.has(port)) portMasks.set(port, []);
    portMasks.get(port).push(`BIT${bit}`);
  });
  return portMasks;
}

function buildMfpCode(state, pinDb) {
  const groups = buildMfpGroups(state, pinDb);
  const lines = [];

  if (groups.size === 0) {
    return '    /* No peripheral pin configuration selected */';
  }

  for (const [registerName, group] of groups.entries()) {
    lines.push(`    SYS->${registerName} = (SYS->${registerName} & ~(${group.masks.join(' | ')})) |`);
    lines.push(`                      (${group.values.join(' | ')});`);
  }

  if (state.peripherals.adc.enabled) {
    const portMasks = buildAdcPortMasks(state, pinDb);
    lines.push('');
    lines.push('    /* ADC pins */');
    for (const [port, masks] of portMasks.entries()) {
      lines.push(`    GPIO_SetMode(${port}, ${masks.join(' | ')}, GPIO_MODE_INPUT);`);
    }
    for (const [port, masks] of portMasks.entries()) {
      lines.push(`    GPIO_DISABLE_DIGITAL_PATH(${port}, ${masks.join(' | ')});`);
    }
  }

  return lines.join('\n');
}

function buildFunctionPrototypes(state) {
  const lines = ['void SYS_Init(void);'];
  if (state.peripherals.uart0.enabled) lines.push('void UART0_Init(void);');
  if (state.peripherals.timer0.enabled) lines.push('void TIMER0_Init(void);');
  if (state.peripherals.adc.enabled) {
    lines.push('void ADC0_Init(void);');
    if (state.peripherals.adc.trigger === 'software') lines.push('void ADC0_Read(void);');
    lines.push('void ADC_IRQHandler(void);');
  }
  return lines.join('\n');
}

function buildInitCalls(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) lines.push('    UART0_Init();');
  if (state.peripherals.timer0.enabled) lines.push('    TIMER0_Init();');
  if (state.peripherals.adc.enabled) lines.push('    ADC0_Init();');
  return lines.join('\n') || '    /* No peripheral init call */';
}

function buildAdcGlobals(state, pinDb) {
  if (!state.peripherals.adc.enabled) return '';
  const lines = ['volatile uint32_t g_u32AdcIntFlag = 0;'];
  getSelectedAdcChannels(state, pinDb).forEach((adcSel) => lines.push(`uint16_t g_u16AdcCH${adcSel.channel} = 0;`));
  return lines.join('\n');
}

function buildAdcModeMacro(state, pinDb) {
  const selected = getSelectedAdcChannels(state, pinDb);
  if (selected.length > 1) return 'ADC_ADCR_ADMD_SINGLE_CYCLE';
  return state.peripherals.adc.mode === 'single' ? 'ADC_ADCR_ADMD_SINGLE' : 'ADC_ADCR_ADMD_SINGLE_CYCLE';
}

function buildAdcChannelMask(state, pinDb) {
  return getSelectedAdcChannels(state, pinDb).map((adcSel) => `BIT${adcSel.channel}`).join(' | ');
}

function buildAdcReadAssignments(state, pinDb, indent = '    ') {
  return getSelectedAdcChannels(state, pinDb)
    .map((adcSel) => `${indent}g_u16AdcCH${adcSel.channel} = ADC_GET_CONVERSION_DATA(ADC, ${adcSel.channel});`)
    .join('\n');
}

function buildMainLoop(state) {
  if (state.peripherals.adc.enabled && state.peripherals.adc.trigger === 'software') {
    return '    while (1)\n    {\n        ADC0_Read();\n    }';
  }
  return '    while (1)\n    {\n    }';
}

function buildFunctionBodies(state, pinDb, mcuDb) {
  const sections = [];

  sections.push(`void SYS_Init(void)\n{\n    SYS_UnlockReg();\n\n${buildClockCode(state, mcuDb)}\n\n    /* Enable peripheral module clocks */\n${buildModuleClockCode(state)}\n\n    /* Multi-function I/O */\n${buildMfpCode(state, pinDb)}\n\n    SYS_LockReg();\n}`);

  if (state.peripherals.uart0.enabled) {
    sections.push(`void UART0_Init(void)\n{\n    SYS_ResetModule(UART0_RST);\n    UART_Open(UART0, ${state.peripherals.uart0.baudrate});\n}`);
  }

  if (state.peripherals.timer0.enabled) {
    const intr = state.peripherals.timer0.interruptEnabled
      ? '    TIMER_EnableInt(TIMER0);\n    NVIC_EnableIRQ(TMR0_IRQn);'
      : '    /* Interrupt disabled by user */';
    sections.push(`void TIMER0_Init(void)\n{\n    TIMER_Open(TIMER0, ${state.peripherals.timer0.mode}, ${Number(state.peripherals.timer0.frequency)});\n${intr}\n    TIMER_Start(TIMER0);\n}`);
  }

  if (state.peripherals.adc.enabled) {
    const adcMask = buildAdcChannelMask(state, pinDb);
    const adcMode = buildAdcModeMacro(state, pinDb);
    const hw = state.peripherals.adc.trigger === 'stadc'
      ? `\n    ADC_EnableHWTrigger(ADC, ADC_ADCR_TRGS_STADC, ${state.peripherals.adc.stCondition});`
      : '';
    sections.push(`void ADC0_Init(void)\n{\n    SYS_ResetModule(ADC_RST);\n    ADC_POWER_ON(ADC);\n    ADC_Open(ADC, ADC_ADCR_DIFFEN_SINGLE_END, ${adcMode}, ${adcMask});\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n    ADC_ENABLE_INT(ADC, ADC_ADF_INT);\n    NVIC_EnableIRQ(ADC_IRQn);${hw}\n}`);

    if (state.peripherals.adc.trigger === 'software') {
      sections.push(`void ADC0_Read(void)\n{\n    g_u32AdcIntFlag = 0;\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n    ADC_START_CONV(ADC);\n    while (g_u32AdcIntFlag == 0)\n    {\n    }\n${buildAdcReadAssignments(state, pinDb)}\n}`);
    }

    sections.push(`void ADC_IRQHandler(void)\n{\n    g_u32AdcIntFlag = 1;\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n}`);
  }

  return sections.join('\n\n');
}

export function generateCode(state, pinDb, mcuDb) {
  const mcu = getCurrentMcu(state, mcuDb);
  const adcGlobals = buildAdcGlobals(state, pinDb);
  return `#include <stdio.h>\n#include "NuMicro.h"\n\n/* Generated for ${mcu?.displayName || state.mcu} */\n${adcGlobals ? `\n${adcGlobals}\n` : '\n'}${buildFunctionPrototypes(state)}\n\n${buildFunctionBodies(state, pinDb, mcuDb)}\n\nint main(void)\n{\n    SYS_Init();\n${buildInitCalls(state)}\n\n${buildMainLoop(state)}\n\n    return 0;\n}\n`;
}
