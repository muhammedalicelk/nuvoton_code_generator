export const defaultState = {
  mcu: 'M031FB0AE',
  clock: {
    enabled: {
      HIRC: true,
      HXT: false,
      LIRC: false,
      LXT: false,
      MIRC: false
    },
    pllEnabled: false,
    pllSource: 'HIRC',
    pllFreq: 48000000,
    hclkSource: 'HIRC',
    hclk: 48000000,
    pclk0Div: 1,
    pclk1Div: 1
  },
  peripherals: {
    uart0: {
      enabled: false,
      baudrate: 115200,
      pinIndex: 0,
      clockSource: 'HIRC'
    },
    timer0: {
      enabled: false,
      mode: 'TIMER_PERIODIC_MODE',
      frequency: 1000,
      interruptEnabled: true,
      clockSource: 'PCLK0'
    },
    adc: {
      enabled: false,
      mode: 'single_cycle_scan',
      channelIndexes: [2, 3],
      trigger: 'software',
      stPinIndex: 0,
      stCondition: 'ADC_RISING_EDGE',
      clockSource: 'PCLK1',
      divider: 128
    }
  }
};
export function cloneDefaultState() { return structuredClone(defaultState); }
