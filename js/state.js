export const defaultState = {
  mcu: 'M031FB',
  clock: {
    source: 'HIRC',
    pllEnabled: false,
    hclk: 72000000
  },
  peripherals: {
    uart0: {
      enabled: false,
      baudrate: 115200,
      pinIndex: 0
    },
    timer0: {
      enabled: false,
      mode: 'TIMER_PERIODIC_MODE',
      frequency: 1000,
      interruptEnabled: true
    },
    adc: {
      enabled: false,
      mode: 'single',
      channelIndex: 0
    }
  }
};

export function cloneDefaultState() {
  return structuredClone(defaultState);
}
