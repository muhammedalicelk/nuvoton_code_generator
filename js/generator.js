function getSelectedAdcChannels(state, pinDb) {
  return state.peripherals.adc.channelIndexes
    .map((index) => pinDb.adcChannels[index])
    .filter(Boolean)
    .sort((a, b) => a.channel - b.channel);
}

function getSelectedStPin(state, pinDb) {
  return pinDb.adcStOptions[state.peripherals.adc.stPinIndex] || null;
}

function buildClockCode(state) {
  const lines = [];
  lines.push('    /* Enable internal RC 12 MHz clock */');
  lines.push('    CLK_EnableXtalRC(CLK_PWRCTL_HIRCEN_Msk);');
  lines.push('    CLK_WaitClockReady(CLK_STATUS_HIRCSTB_Msk);');

  if (state.clock.source === 'HXT') {
    lines.push('    /* Enable external crystal clock */');
    lines.push('    CLK_EnableXtalRC(CLK_PWRCTL_HXTEN_Msk);');
    lines.push('    CLK_WaitClockReady(CLK_STATUS_HXTSTB_Msk);');
  }

  if (state.clock.pllEnabled) {
    lines.push('    /* Configure PLL and switch HCLK to PLL */');
    lines.push(`    CLK_SetCoreClock(${state.clock.hclk});`);
  } else if (state.clock.source === 'HIRC') {
    lines.push('    /* Switch HCLK source to HIRC */');
    lines.push('    CLK_SetHCLK(CLK_CLKSEL0_HCLKSEL_HIRC, CLK_CLKDIV0_HCLK(1));');
  } else {
    lines.push('    /* Switch HCLK source to HXT */');
    lines.push('    CLK_SetHCLK(CLK_CLKSEL0_HCLKSEL_HXT, CLK_CLKDIV0_HCLK(1));');
  }

  if (state.peripherals.adc.enabled) {
    lines.push('    /* ADC için APB divider = 1 */');
    lines.push('    CLK->PCLKDIV = (CLK_PCLKDIV_APB0DIV_DIV1 | CLK_PCLKDIV_APB1DIV_DIV1);');
  }

  lines.push('    SystemCoreClockUpdate();');
  return lines.join('\n');
}

function buildModuleClockCode(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) {
    lines.push('    CLK_EnableModuleClock(UART0_MODULE);');
    lines.push('    CLK_SetModuleClock(UART0_MODULE, CLK_CLKSEL1_UART0SEL_HIRC, CLK_CLKDIV0_UART0(1));');
  }
  if (state.peripherals.timer0.enabled) {
    lines.push('    CLK_EnableModuleClock(TMR0_MODULE);');
    lines.push('    CLK_SetModuleClock(TMR0_MODULE, CLK_CLKSEL1_TMR0SEL_HCLK, 0);');
  }
  if (state.peripherals.adc.enabled) {
    lines.push('    CLK_EnableModuleClock(ADC_MODULE);');
    lines.push('    CLK_SetModuleClock(ADC_MODULE, CLK_CLKSEL2_ADCSEL_PCLK1, CLK_CLKDIV0_ADC(128));');
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
    getSelectedAdcChannels(state, pinDb).forEach((adcSel) => {
      addPinAssignment(groups, adcSel.register, adcSel.mask, adcSel.value);
    });

    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = getSelectedStPin(state, pinDb);
      if (stSel) {
        addPinAssignment(groups, stSel.register, stSel.mask, stSel.value);
      }
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
    lines.push('    /* No peripheral pin configuration selected */');
    return lines.join('\n');
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

function buildInitCalls(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) lines.push('    UART0_Init();');
  if (state.peripherals.timer0.enabled) lines.push('    TIMER0_Init();');
  if (state.peripherals.adc.enabled) lines.push('    ADC0_Init();');
  return lines.join('\n') || '    /* No peripheral init call */';
}

function buildFunctionPrototypes(state) {
  const lines = ['void SYS_Init(void);'];
  if (state.peripherals.uart0.enabled) lines.push('void UART0_Init(void);');
  if (state.peripherals.timer0.enabled) lines.push('void TIMER0_Init(void);');
  if (state.peripherals.adc.enabled) {
    lines.push('void ADC0_Init(void);');
    if (state.peripherals.adc.trigger === 'software') {
      lines.push('void ADC0_Read(void);');
    }
    lines.push('void ADC_IRQHandler(void);');
  }
  return lines.join('\n');
}

function buildAdcGlobals(state, pinDb) {
  if (!state.peripherals.adc.enabled) return '';
  const lines = ['volatile uint32_t g_u32AdcIntFlag = 0;'];
  getSelectedAdcChannels(state, pinDb).forEach((adcSel) => {
    lines.push(`uint16_t g_u16AdcCH${adcSel.channel} = 0;`);
  });
  return lines.join('\n');
}

function buildAdcModeMacro(state, pinDb) {
  const selected = getSelectedAdcChannels(state, pinDb);
  if (selected.length > 1) return 'ADC_ADCR_ADMD_SINGLE_CYCLE';
  if (state.peripherals.adc.mode === 'single') return 'ADC_ADCR_ADMD_SINGLE';
  return 'ADC_ADCR_ADMD_SINGLE_CYCLE';
}

function buildAdcChannelMask(state, pinDb) {
  const selected = getSelectedAdcChannels(state, pinDb);
  return selected.map((adcSel) => `BIT${adcSel.channel}`).join(' | ');
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

function buildFunctionBodies(state, pinDb) {
  const sections = [];

  sections.push(`void SYS_Init(void)\n{\n    SYS_UnlockReg();\n\n${buildClockCode(state)}\n\n    /* Enable peripheral module clocks */\n${buildModuleClockCode(state)}\n\n    /* Multi-function I/O */\n${buildMfpCode(state, pinDb)}\n\n    SYS_LockReg();\n}`);

  if (state.peripherals.uart0.enabled) {
    sections.push(`void UART0_Init(void)\n{\n    SYS_ResetModule(UART0_RST);\n    UART_Open(UART0, ${state.peripherals.uart0.baudrate});\n}`);
  }

  if (state.peripherals.timer0.enabled) {
    const intrLines = state.peripherals.timer0.interruptEnabled
      ? '    TIMER_EnableInt(TIMER0);\n    NVIC_EnableIRQ(TMR0_IRQn);'
      : '    /* Interrupt disabled by user */';
    sections.push(`void TIMER0_Init(void)\n{\n    TIMER_Open(TIMER0, ${state.peripherals.timer0.mode}, ${Number(state.peripherals.timer0.frequency)});\n${intrLines}\n    TIMER_Start(TIMER0);\n}`);
  }

  if (state.peripherals.adc.enabled) {
    const adcMask = buildAdcChannelMask(state, pinDb);
    const adcMode = buildAdcModeMacro(state, pinDb);
    const hwTrigger = state.peripherals.adc.trigger === 'stadc'
      ? `\n    ADC_EnableHWTrigger(ADC, ADC_ADCR_TRGS_STADC, ${state.peripherals.adc.stCondition});`
      : '';
    sections.push(`void ADC0_Init(void)\n{\n    SYS_ResetModule(ADC_RST);\n    ADC_POWER_ON(ADC);\n    ADC_Open(ADC, ADC_ADCR_DIFFEN_SINGLE_END, ${adcMode}, ${adcMask});\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n    ADC_ENABLE_INT(ADC, ADC_ADF_INT);\n    NVIC_EnableIRQ(ADC_IRQn);${hwTrigger}\n}`);

    if (state.peripherals.adc.trigger === 'software') {
      sections.push(`void ADC0_Read(void)\n{\n    g_u32AdcIntFlag = 0;\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n    ADC_START_CONV(ADC);\n\n    while (g_u32AdcIntFlag == 0);\n\n${buildAdcReadAssignments(state, pinDb)}\n}`);
      sections.push(`void ADC_IRQHandler(void)\n{\n    g_u32AdcIntFlag = 1;\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n}`);
    } else {
      sections.push(`void ADC_IRQHandler(void)\n{\n${buildAdcReadAssignments(state, pinDb)}\n    g_u32AdcIntFlag = 1;\n    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);\n}`);
    }
  }

  return sections.join('\n\n');
}

export function generateCode(state, pinDb) {
  const globals = buildAdcGlobals(state, pinDb);
  const globalsBlock = globals ? `${globals}\n\n` : '';
  return `#include <stdio.h>\n#include "NuMicro.h"\n\n${globalsBlock}${buildFunctionPrototypes(state)}\n\n${buildFunctionBodies(state, pinDb)}\n\nint main(void)\n{\n    SYS_Init();\n${buildInitCalls(state)}\n\n${buildMainLoop(state)}\n}\n`;
}
