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
  lines.push('    /* Switch HCLK source to HIRC */');
  lines.push('    CLK_SetHCLK(CLK_CLKSEL0_HCLKSEL_HIRC, CLK_CLKDIV0_HCLK(1));');
  return lines.join('
');
}

function buildModuleClockCode(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) {
    lines.push('    CLK_EnableModuleClock(UART0_MODULE);');
    lines.push('    CLK_SetModuleClock(UART0_MODULE, CLK_CLKSEL1_UART0SEL_HIRC, CLK_CLKDIV0_UART0(1));');
  }
  if (state.peripherals.timer0.enabled) {
    lines.push('    CLK_EnableModuleClock(TMR0_MODULE);');
    lines.push('    CLK_SetModuleClock(TMR0_MODULE, CLK_CLKSEL1_TMR0SEL_HIRC, 0);');
  }
  if (state.peripherals.adc.enabled) {
    lines.push('    CLK->PCLKDIV = (CLK_PCLKDIV_APB0DIV_DIV1 | CLK_PCLKDIV_APB1DIV_DIV1);');
    lines.push('    CLK_EnableModuleClock(ADC_MODULE);');
    lines.push('    CLK_SetModuleClock(ADC_MODULE, CLK_CLKSEL2_ADCSEL_PCLK1, CLK_CLKDIV0_ADC(128));');
  }
  if (lines.length === 0) {
    lines.push('    /* No module clock selected */');
  }
  return lines.join('
');
}

function addPinEntry(map, register, mask, value, extraLine = null) {
  if (!map.has(register)) map.set(register, { masks: [], values: [], extraLines: [] });
  map.get(register).masks.push(mask);
  map.get(register).values.push(value);
  if (extraLine) map.get(register).extraLines.push(extraLine);
}

function buildMfpCode(state, pinDb) {
  const regMap = new Map();

  if (state.peripherals.uart0.enabled) {
    const uartSel = pinDb.uart0Options[state.peripherals.uart0.pinIndex];
    uartSel?.pins.forEach((pin) => addPinEntry(regMap, uartSel.register, pin.mask, pin.value));
  }

  if (state.peripherals.adc.enabled) {
    const adcSelections = getSelectedAdcChannels(state, pinDb);
    const groupedInputPins = new Map();
    adcSelections.forEach((adcSel) => {
      addPinEntry(regMap, adcSel.register, adcSel.mask, adcSel.value);
      const port = adcSel.pin.split('.')[0].slice(-1);
      if (!groupedInputPins.has(port)) groupedInputPins.set(port, []);
      groupedInputPins.get(port).push(`BIT${adcSel.channel}`);
    });

    if (state.peripherals.adc.trigger === 'stadc') {
      const stSel = getSelectedStPin(state, pinDb);
      if (stSel) {
        addPinEntry(regMap, stSel.register, stSel.mask, stSel.value);
      }
    }

    const prologLines = [];
    groupedInputPins.forEach((bits, port) => {
      prologLines.push(`    GPIO_SetMode(P${port}, ${bits.join(' | ')}, GPIO_MODE_INPUT);`);
      prologLines.push(`    GPIO_DISABLE_DIGITAL_PATH(P${port}, ${bits.join(' | ')});`);
    });

    const assignmentLines = Array.from(regMap.entries()).map(([register, value]) => {
      return `    SYS->${register} = (SYS->${register} & ~(${value.masks.join(' | ')})) |
` +
             `                    (${value.values.join(' | ')});`;
    });

    return [...prologLines, ...assignmentLines].join('
');
  }

  if (regMap.size === 0) {
    return '    /* No peripheral pin configuration selected */';
  }

  return Array.from(regMap.entries()).map(([register, value]) => {
    return `    SYS->${register} = (SYS->${register} & ~(${value.masks.join(' | ')})) |
` +
           `                    (${value.values.join(' | ')});`;
  }).join('
');
}

function buildInitCalls(state) {
  const lines = [];
  if (state.peripherals.uart0.enabled) lines.push('    UART0_Init();');
  if (state.peripherals.timer0.enabled) lines.push('    TIMER0_Init();');
  if (state.peripherals.adc.enabled) lines.push('    ADC0_Init();');
  if (lines.length === 0) lines.push('    /* No peripheral init call */');
  return lines.join('
');
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
  return lines.join('
');
}

function buildAdcGlobals(state, pinDb) {
  if (!state.peripherals.adc.enabled) return '';
  const lines = ['volatile uint32_t g_u32AdcIntFlag = 0;'];
  getSelectedAdcChannels(state, pinDb).forEach((adcSel) => {
    lines.push(`uint16_t g_u16AdcCH${adcSel.channel} = 0;`);
  });
  return lines.join('
');
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
    .join('
');
}

function buildMainLoop(state) {
  if (state.peripherals.adc.enabled && state.peripherals.adc.trigger === 'software') {
    return '    while (1)
    {
        ADC0_Read();
    }';
  }
  return '    while (1)
    {
    }';
}

function buildFunctionBodies(state, pinDb) {
  const sections = [];

  sections.push(`void SYS_Init(void)
{
    SYS_UnlockReg();

${buildClockCode(state)}

    /* Enable peripheral module clocks */
${buildModuleClockCode(state)}

    /* Multi-function I/O */
${buildMfpCode(state, pinDb)}

    SYS_LockReg();
}`);

  if (state.peripherals.uart0.enabled) {
    sections.push(`void UART0_Init(void)
{
    SYS_ResetModule(UART0_RST);
    UART_Open(UART0, ${state.peripherals.uart0.baudrate});
}`);
  }

  if (state.peripherals.timer0.enabled) {
    const intrLines = state.peripherals.timer0.interruptEnabled
      ? '    TIMER_EnableInt(TIMER0);
    NVIC_EnableIRQ(TMR0_IRQn);'
      : '    /* Interrupt disabled by user */';
    sections.push(`void TIMER0_Init(void)
{
    TIMER_Open(TIMER0, ${state.peripherals.timer0.mode}, ${Number(state.peripherals.timer0.frequency)});
${intrLines}
    TIMER_Start(TIMER0);
}`);
  }

  if (state.peripherals.adc.enabled) {
    const adcMask = buildAdcChannelMask(state, pinDb);
    const adcMode = buildAdcModeMacro(state, pinDb);
    const hwTrigger = state.peripherals.adc.trigger === 'stadc'
      ? `
    ADC_EnableHWTrigger(ADC, ADC_ADCR_TRGS_STADC, ${state.peripherals.adc.stCondition});`
      : '';
    sections.push(`void ADC0_Init(void)
{
    SYS_ResetModule(ADC_RST);
    ADC_POWER_ON(ADC);
    ADC_Open(ADC, ADC_ADCR_DIFFEN_SINGLE_END, ${adcMode}, ${adcMask});
    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);
    ADC_ENABLE_INT(ADC, ADC_ADF_INT);
    NVIC_EnableIRQ(ADC_IRQn);${hwTrigger}
}`);

    if (state.peripherals.adc.trigger === 'software') {
      sections.push(`void ADC0_Read(void)
{
    g_u32AdcIntFlag = 0;
    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);
    ADC_START_CONV(ADC);

    while (g_u32AdcIntFlag == 0);

${buildAdcReadAssignments(state, pinDb)}
}`);
      sections.push(`void ADC_IRQHandler(void)
{
    g_u32AdcIntFlag = 1;
    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);
}`);
    } else {
      sections.push(`void ADC_IRQHandler(void)
{
${buildAdcReadAssignments(state, pinDb, '    ')}
    g_u32AdcIntFlag = 1;
    ADC_CLR_INT_FLAG(ADC, ADC_ADF_INT);
}`);
    }
  }

  return sections.join('

');
}

export function generateCode(state, pinDb) {
  const globals = buildAdcGlobals(state, pinDb);
  const globalsBlock = globals ? `${globals}

` : '';
  return `#include <stdio.h>
#include "NuMicro.h"

${globalsBlock}${buildFunctionPrototypes(state)}

${buildFunctionBodies(state, pinDb)}

int main(void)
{
    SYS_Init();
${buildInitCalls(state)}

${buildMainLoop(state)}
}
`;
}
