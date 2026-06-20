import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getState,
  getOscilloscopeChannel,
  getSignalGeneratorChannel,
  setOscilloscopeCoupling,
  setOscilloscopeVoltageRange,
  setOscilloscopeTimebase,
  setSignalGeneratorFrequency,
  setSignalGeneratorAmplitude,
  setSignalGeneratorWaveform,
  resetInstrumentState,
  VOLTAGE_LIMIT_V,
  AMPLITUDE_LIMIT_V,
  type Coupling,
  type SignalGeneratorChannel,
} from "@/lib/instrument-state";

// ─────────────────────────────────────────────
// Read tools — safe, no confirmation needed
// ─────────────────────────────────────────────

export const getInstrumentStateTool = tool(
  async () => {
    const s = getState();
    return JSON.stringify(s, null, 2);
  },
  {
    name: "get_instrument_state",
    description:
      "Reads the full state of both the oscilloscope and signal generator. " +
      "Returns a JSON snapshot of all channels, couplings, voltage ranges, timebase, " +
      "trigger settings, waveform types, frequencies, and amplitudes. " +
      "This is a read-only operation — no state is changed.",
    schema: z.object({}),
  },
);

export const getChannelConfigTool = tool(
  async ({ instrument, channel }: { instrument: "oscilloscope" | "generator"; channel: number }) => {
    if (instrument === "oscilloscope") {
      const ch = getOscilloscopeChannel(channel);
      if (!ch) return `Error: Oscilloscope channel ${channel} does not exist. Use CH1–CH4.`;
      return JSON.stringify(ch, null, 2);
    }
    const ch = getSignalGeneratorChannel(channel);
    if (!ch) return `Error: Generator channel ${channel} does not exist. Use CH1 or CH2.`;
    return JSON.stringify(ch, null, 2);
  },
  {
    name: "get_channel_config",
    description:
      "Reads the configuration of a specific instrument channel. " +
      "For oscilloscope: specify instrument='oscilloscope' and channel (1-4). " +
      "For signal generator: specify instrument='generator' and channel (1-2). " +
      "Returns coupling, voltage range, timebase, waveform, frequency, etc. " +
      "This is a read-only operation — no state is changed.",
    schema: z.object({
      instrument: z.enum(["oscilloscope", "generator"]).describe("Which instrument to query"),
      channel: z.number().int().min(1).max(4).describe("Channel number (1-4 for scope, 1-2 for generator)"),
    }),
  },
);

// ─────────────────────────────────────────────
// Write tools — require explicit confirmation
// ─────────────────────────────────────────────

/**
 * Shared helper: returns a proposed-action envelope when confirmed=false,
 * or executes the action when confirmed=true.
 */
function actionEnvelope<T extends Record<string, unknown>>(
  params: T & { confirmed?: boolean },
  description: string,
  safetyCheck: { violated: boolean; warning: string } | null,
  execute: () => string,
): string {
  if (!params.confirmed) {
    const proposal: Record<string, unknown> = {
      requiresConfirmation: true,
      proposedAction: description,
    };
    if (safetyCheck?.violated) {
      proposal.safetyWarning = safetyCheck.warning;
    }
    return JSON.stringify(proposal);
  }
  // Safety check still applies even after confirmation
  if (safetyCheck?.violated) {
    return JSON.stringify({
      status: "safety_blocked",
      message: safetyCheck.warning,
    });
  }
  const result = execute();
  return JSON.stringify({ status: "executed", message: result });
}

export const setOscilloscopeCouplingTool = tool(
  async ({ channel, coupling, confirmed }: { channel: number; coupling: Coupling; confirmed?: boolean }) => {
    return actionEnvelope(
      { channel, coupling, confirmed },
      `Set oscilloscope CH${channel} coupling to ${coupling}`,
      // No safety violation for coupling changes
      null,
      () => setOscilloscopeCoupling(channel, coupling),
    );
  },
  {
    name: "set_oscilloscope_coupling",
    description:
      "Sets the input coupling of an oscilloscope channel (CH1–CH4). " +
      "Options: DC, AC, GND. " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      channel: z.number().int().min(1).max(4).describe("Oscilloscope channel (1–4)"),
      coupling: z.enum(["DC", "AC", "GND"]).describe("Coupling mode: DC, AC, or GND"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const setOscilloscopeVoltageRangeTool = tool(
  async ({ channel, voltageV, confirmed }: { channel: number; voltageV: number; confirmed?: boolean }) => {
    const safetyCheck = voltageV > VOLTAGE_LIMIT_V
      ? { violated: true, warning: `⚠ SAFETY: ${voltageV}V exceeds the maximum safe limit of ${VOLTAGE_LIMIT_V}V. This setting is BLOCKED even after confirmation. Choose ≤ ${VOLTAGE_LIMIT_V}V.` }
      : null;

    return actionEnvelope(
      { channel, voltageV, confirmed },
      `Set oscilloscope CH${channel} voltage range to ${voltageV} V/div`,
      safetyCheck,
      () => setOscilloscopeVoltageRange(channel, voltageV),
    );
  },
  {
    name: "set_voltage_range",
    description:
      "Sets the voltage range (V/div) of an oscilloscope channel (CH1–CH4). " +
      "Typical values: 0.1, 0.5, 1, 2, 5, 10 V/div. " +
      "MAX SAFE LIMIT: " + VOLTAGE_LIMIT_V + "V — values above this are blocked entirely. " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      channel: z.number().int().min(1).max(4).describe("Oscilloscope channel (1–4)"),
      voltageV: z.number().positive().describe("Voltage range in V/div"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const setTimebaseTool = tool(
  async ({ timebaseS, confirmed }: { timebaseS: number; confirmed?: boolean }) => {
    return actionEnvelope(
      { timebaseS, confirmed },
      `Set oscilloscope timebase to ${timebaseS} s/div`,
      null,
      () => setOscilloscopeTimebase(timebaseS),
    );
  },
  {
    name: "set_timebase",
    description:
      "Sets the horizontal timebase (seconds per division) for all oscilloscope channels. " +
      "Typical values: 1e-6 (1 µs), 1e-3 (1 ms), 1e-2 (10 ms), 1e-1 (100 ms). " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      timebaseS: z.number().positive().describe("Timebase in seconds per division"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const setGeneratorFrequencyTool = tool(
  async ({ channel, frequencyHz, confirmed }: { channel: number; frequencyHz: number; confirmed?: boolean }) => {
    return actionEnvelope(
      { channel, frequencyHz, confirmed },
      `Set signal generator CH${channel} frequency to ${frequencyHz} Hz`,
      null,
      () => setSignalGeneratorFrequency(channel, frequencyHz),
    );
  },
  {
    name: "set_generator_frequency",
    description:
      "Sets the output frequency of a signal generator channel (CH1 or CH2). " +
      "Typical values: 50 (mains hum test), 1000 (1 kHz reference), 10000 (10 kHz). " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      channel: z.number().int().min(1).max(2).describe("Generator channel (1 or 2)"),
      frequencyHz: z.number().positive().describe("Frequency in Hz"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const setGeneratorAmplitudeTool = tool(
  async ({ channel, amplitudeVpp, confirmed }: { channel: number; amplitudeVpp: number; confirmed?: boolean }) => {
    const safetyCheck = amplitudeVpp > AMPLITUDE_LIMIT_V
      ? { violated: true, warning: `⚠ SAFETY: ${amplitudeVpp}Vpp exceeds the maximum safe amplitude of ${AMPLITUDE_LIMIT_V}Vpp. This setting is BLOCKED even after confirmation. Choose ≤ ${AMPLITUDE_LIMIT_V}Vpp.` }
      : null;

    return actionEnvelope(
      { channel, amplitudeVpp, confirmed },
      `Set signal generator CH${channel} amplitude to ${amplitudeVpp} Vpp`,
      safetyCheck,
      () => setSignalGeneratorAmplitude(channel, amplitudeVpp),
    );
  },
  {
    name: "set_generator_amplitude",
    description:
      "Sets the peak-to-peak output amplitude of a signal generator channel (CH1 or CH2). " +
      "Typical values: 0.1, 0.5, 1, 2, 5 Vpp. " +
      "MAX SAFE LIMIT: " + AMPLITUDE_LIMIT_V + "Vpp — values above this are blocked entirely. " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      channel: z.number().int().min(1).max(2).describe("Generator channel (1 or 2)"),
      amplitudeVpp: z.number().positive().describe("Amplitude in Volts peak-to-peak"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const setGeneratorWaveformTool = tool(
  async ({ channel, waveform, confirmed }: { channel: number; waveform: SignalGeneratorChannel["waveform"]; confirmed?: boolean }) => {
    return actionEnvelope(
      { channel, waveform, confirmed },
      `Set signal generator CH${channel} waveform to ${waveform}`,
      null,
      () => setSignalGeneratorWaveform(channel, waveform),
    );
  },
  {
    name: "set_generator_waveform",
    description:
      "Sets the output waveform type of a signal generator channel (CH1 or CH2). " +
      "Options: sine, square, triangle, ramp. " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      channel: z.number().int().min(1).max(2).describe("Generator channel (1 or 2)"),
      waveform: z.enum(["sine", "square", "triangle", "ramp"]).describe("Waveform type"),
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

export const resetInstrumentTool = tool(
  async ({ confirmed }: { confirmed?: boolean }) => {
    return actionEnvelope(
      { confirmed },
      "Reset both oscilloscope and signal generator to factory defaults",
      null,
      () => {
        resetInstrumentState();
        return "Instruments reset to default state.";
      },
    );
  },
  {
    name: "reset_instruments",
    description:
      "Resets both the oscilloscope and signal generator to their default factory settings. " +
      "REQUIRES CONFIRMATION: Call with confirmed=false (or omit) to propose. " +
      "The user must confirm before this executes.",
    schema: z.object({
      confirmed: z.boolean().optional().default(false).describe("Set to true to execute after user confirms"),
    }),
  },
);

// ─────────────────────────────────────────────
// Exported list for easy registration
// ─────────────────────────────────────────────

export const instrumentTools = [
  // Read tools (no confirmation needed)
  getInstrumentStateTool,
  getChannelConfigTool,
  // Write tools (require confirmation)
  setOscilloscopeCouplingTool,
  setOscilloscopeVoltageRangeTool,
  setTimebaseTool,
  setGeneratorFrequencyTool,
  setGeneratorAmplitudeTool,
  setGeneratorWaveformTool,
  resetInstrumentTool,
];
