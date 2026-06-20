// ─────────────────────────────────────────────
// Mock Instrument State
// ─────────────────────────────────────────────
// In-memory representation of an R&S oscilloscope and signal generator.
// No Prisma dependency — kept minimal for a same-day demo.

export type Coupling = "DC" | "AC" | "GND";

export const VOLTAGE_LIMIT_V = 50;   // hard safety limit
export const AMPLITUDE_LIMIT_V = 20; // hard safety limit

export interface OscilloscopeChannel {
  channel: 1 | 2 | 3 | 4;
  coupling: Coupling;
  voltageRangeV: number;   // e.g. 0.1, 0.5, 1, 2, 5, 10
  timebaseS: number;       // seconds per division, e.g. 1e-3
  probeAttenuation: number; // e.g. 1, 10, 100
}

export interface SignalGeneratorChannel {
  channel: 1 | 2;
  waveform: "sine" | "square" | "triangle" | "ramp";
  frequencyHz: number;
  amplitudeVpp: number;    // Volts peak-to-peak
  offsetV: number;
}

export interface InstrumentState {
  oscilloscope: {
    channels: [OscilloscopeChannel, OscilloscopeChannel, OscilloscopeChannel, OscilloscopeChannel];
    triggerSource: 1 | 2 | 3 | 4;
    triggerLevelV: number;
  };
  signalGenerator: {
    channels: [SignalGeneratorChannel, SignalGeneratorChannel];
  };
}

function defaultOscilloscope(): InstrumentState["oscilloscope"] {
  return {
    channels: [
      { channel: 1, coupling: "DC", voltageRangeV: 1, timebaseS: 1e-3, probeAttenuation: 1 },
      { channel: 2, coupling: "DC", voltageRangeV: 1, timebaseS: 1e-3, probeAttenuation: 1 },
      { channel: 3, coupling: "DC", voltageRangeV: 1, timebaseS: 1e-3, probeAttenuation: 1 },
      { channel: 4, coupling: "DC", voltageRangeV: 1, timebaseS: 1e-3, probeAttenuation: 1 },
    ],
    triggerSource: 1,
    triggerLevelV: 0,
  };
}

function defaultSignalGenerator(): InstrumentState["signalGenerator"] {
  return {
    channels: [
      { channel: 1, waveform: "sine", frequencyHz: 1000, amplitudeVpp: 1, offsetV: 0 },
      { channel: 2, waveform: "sine", frequencyHz: 1000, amplitudeVpp: 1, offsetV: 0 },
    ],
  };
}

let state: InstrumentState = {
  oscilloscope: defaultOscilloscope(),
  signalGenerator: defaultSignalGenerator(),
};

// ── Read accessors (safe — no confirmation needed) ──

export function getState(): InstrumentState {
  return structuredClone(state);
}

export function getOscilloscopeChannel(ch: number): OscilloscopeChannel | null {
  const idx = ch - 1;
  if (idx < 0 || idx > 3) return null;
  return structuredClone(state.oscilloscope.channels[idx]);
}

export function getSignalGeneratorChannel(ch: number): SignalGeneratorChannel | null {
  const idx = ch - 1;
  if (idx < 0 || idx > 1) return null;
  return structuredClone(state.signalGenerator.channels[idx]);
}

// ── Write accessors (require confirmation) ──

export function setOscilloscopeCoupling(ch: number, coupling: Coupling): string {
  const idx = ch - 1;
  if (idx < 0 || idx > 3) return `Error: Channel ${ch} does not exist. Use CH1–CH4.`;
  state.oscilloscope.channels[idx].coupling = coupling;
  return `CH${ch} coupling set to ${coupling}.`;
}

export function setOscilloscopeVoltageRange(ch: number, voltageV: number): string {
  const idx = ch - 1;
  if (idx < 0 || idx > 3) return `Error: Channel ${ch} does not exist. Use CH1–CH4.`;
  if (voltageV > VOLTAGE_LIMIT_V) {
    return `Safety block: ${voltageV}V exceeds the maximum safe limit of ${VOLTAGE_LIMIT_V}V. Choose a voltage ≤ ${VOLTAGE_LIMIT_V}V.`;
  }
  state.oscilloscope.channels[idx].voltageRangeV = voltageV;
  return `CH${ch} voltage range set to ${voltageV}V/div.`;
}

export function setOscilloscopeTimebase(timebaseS: number): string {
  if (timebaseS <= 0) return "Error: Timebase must be positive.";
  for (const ch of state.oscilloscope.channels) {
    ch.timebaseS = timebaseS;
  }
  return `Timebase set to ${timebaseS}s/div for all channels.`;
}

export function setSignalGeneratorFrequency(ch: number, freqHz: number): string {
  const idx = ch - 1;
  if (idx < 0 || idx > 1) return `Error: Generator channel ${ch} does not exist. Use CH1 or CH2.`;
  if (freqHz <= 0) return "Error: Frequency must be positive.";
  state.signalGenerator.channels[idx].frequencyHz = freqHz;
  return `Generator CH${ch} frequency set to ${freqHz} Hz.`;
}

export function setSignalGeneratorAmplitude(ch: number, amplitudeVpp: number): string {
  const idx = ch - 1;
  if (idx < 0 || idx > 1) return `Error: Generator channel ${ch} does not exist. Use CH1 or CH2.`;
  if (amplitudeVpp > AMPLITUDE_LIMIT_V) {
    return `Safety block: ${amplitudeVpp}Vpp exceeds the maximum safe amplitude of ${AMPLITUDE_LIMIT_V}Vpp. Choose an amplitude ≤ ${AMPLITUDE_LIMIT_V}Vpp.`;
  }
  if (amplitudeVpp <= 0) return "Error: Amplitude must be positive.";
  state.signalGenerator.channels[idx].amplitudeVpp = amplitudeVpp;
  return `Generator CH${ch} amplitude set to ${amplitudeVpp} Vpp.`;
}

export function setSignalGeneratorWaveform(ch: number, waveform: SignalGeneratorChannel["waveform"]): string {
  const idx = ch - 1;
  if (idx < 0 || idx > 1) return `Error: Generator channel ${ch} does not exist. Use CH1 or CH2.`;
  state.signalGenerator.channels[idx].waveform = waveform;
  return `Generator CH${ch} waveform set to ${waveform}.`;
}

// ── Reset ──

export function resetInstrumentState(): void {
  state = {
    oscilloscope: defaultOscilloscope(),
    signalGenerator: defaultSignalGenerator(),
  };
}
