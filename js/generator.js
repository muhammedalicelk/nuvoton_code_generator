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
    lines.push('    CLK_SetModuleClock(ADC_MODULE, CLK_CLKSEL1_ADCSEL_HIRC, CLK_CLKDIV0_ADC(1));');
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
    uartSel.pins.forEach((pin) => addPinAssignment(groups, uartSel.register, pin.mask, pin.value));
  }

  if (state.peripherals.adc.enabled) {
    const adcSel = pinDb.adcChannels[state.peripherals.adc.channelIndex];
    addPinAssignment(groups, adcSel.register, adcSel.mask, adcSel.value);
  }

  return groups;
}

function buildMfpCode(state, pinDb) {
  const groups = buildMfpGroups(state, pinDb);
  if (groups.size === 0) {
    return '    /* No peripheral pin configuration selected */';
  }

  const lines = [];
  for (const [registerName, group] of groups.entries()) {
    lines.push(`    SYS->${registerName} = (SYS->${registerName} & ~(${group.masks.join(' | ')})) |`);
    lines.push(`                      (${group.values.join(' | ')});`);
  }

  if (state.peripherals.adc.enabled) {
    const adcSel = pinDb.adcChannels[state.peripherals.adc.channelIndex];
    const [port, bit] = adcSel.pin.split('.');
    lines.push('');
    lines.push('    /* Disable digital path for ADC pin */');
    lines.push(`    GPIO_DISABLE_DIGITAL_PATH(${port}, BIT${bit});`);
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
  if (state.peripherals.adc.enabled) lines.push('void ADC0_Init(void);');
  return lines.join('\n');
}

function buildFunctionBodies(state, pinDb) {
  const sections = [];

  sections.push(`void SYS_Init(void)\n{\n    SYS_UnlockReg();\n\n${buildClockCode(state)}\n\n    /* Enable peripheral module clocks */\n${buildModuleClockCode(state)}\n\n    /* Multi-function I/O */\n${buildMfpCode(state, pinDb)}\n\n    SYS_LockReg();\n}`);

  if (state.peripherals.uart0.enabled) {
    sections.push(`void UART0_Init(void)\n{\n    UART_Open(UART0, ${state.peripherals.uart0.baudrate});\n}`);
  }

  if (state.peripherals.timer0.enabled) {
    const intrLines = state.peripherals.timer0.interruptEnabled
      ? '    TIMER_EnableInt(TIMER0);\n    NVIC_EnableIRQ(TMR0_IRQn);'
      : '    /* Interrupt disabled by user */';
    sections.push(`void TIMER0_Init(void)\n{\n    TIMER_Open(TIMER0, ${state.peripherals.timer0.mode}, ${Number(state.peripherals.timer0.frequency)});\n${intrLines}\n    TIMER_Start(TIMER0);\n}`);
  }

  if (state.peripherals.adc.enabled) {
    const adcSel = pinDb.adcChannels[state.peripherals.adc.channelIndex];
    const inputMode = state.peripherals.adc.mode === 'single_cycle_scan' ? 'ADC_ADCR_ADMD_SINGLE_CYCLE' : 'ADC_ADCR_ADMD_SINGLE';
    sections.push(`void ADC0_Init(void)\n{\n    ADC_Open(ADC, ${inputMode}, ADC_OPERATION_MODE_SINGLE, BIT${adcSel.channel});\n}`);
  }

  return sections.join('\n\n');
}

export function generateCode(state, pinDb) {
  return `#include <stdio.h>\n#include "NuMicro.h"\n\n${buildFunctionPrototypes(state)}\n\n${buildFunctionBodies(state, pinDb)}\n\nint main(void)\n{\n    SYS_Init();\n${buildInitCalls(state)}\n\n    printf("System ready.\\n");\n\n    while (1)\n    {\n    }\n}\n`;
}
