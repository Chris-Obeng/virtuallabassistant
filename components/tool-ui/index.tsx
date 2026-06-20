"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  ConfirmationCard,
  type ToolResult,
} from "@/components/tool-ui/confirmation-card";
import { InstrumentCard } from "@/components/tool-ui/instrument-card";
import { useAui } from "@assistant-ui/react";
import { useCallback } from "react";

// ── Helper: creates a confirmation card for write tools ──

function createConfirmationToolUI(toolName: string) {
  return makeAssistantToolUI<Record<string, unknown>, ToolResult>({
    toolName,
    render: function InstrumentConfirmation({ args, result, status }) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const aui = useAui();

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handleConfirm = useCallback(
        (proposal: string) => {
          aui.thread().append({
            role: "user",
            content: [
              {
                type: "text",
                text: `I confirm: ${proposal}. Please proceed.`,
              },
            ],
          });
        },
        [aui],
      );

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handleCancel = useCallback(() => {
        aui.thread().append({
          role: "user",
          content: [
            {
              type: "text",
              text: "Cancel that instrument action.",
            },
          ],
        });
      }, [aui]);

      return (
        <ConfirmationCard
          toolName={toolName}
          args={args}
          result={result}
          status={status}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );
    },
  });
}

// ── Helper: creates an instrument card for read tools ──

function createInstrumentDisplayUI(toolName: string) {
  return makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: function InstrumentDisplay({ result, status }) {
      return (
        <InstrumentCard
          result={result}
          status={status}
        />
      );
    },
  });
}

// ── Individual tool UI components ──

/** Confirmation gates for all write tools */
export const SetOscilloscopeCouplingGate = createConfirmationToolUI(
  "set_oscilloscope_coupling",
);
export const SetVoltageRangeGate = createConfirmationToolUI("set_voltage_range");
export const SetTimebaseGate = createConfirmationToolUI("set_timebase");
export const SetGeneratorFrequencyGate = createConfirmationToolUI(
  "set_generator_frequency",
);
export const SetGeneratorAmplitudeGate = createConfirmationToolUI(
  "set_generator_amplitude",
);
export const SetGeneratorWaveformGate = createConfirmationToolUI(
  "set_generator_waveform",
);
export const ResetInstrumentsGate = createConfirmationToolUI("reset_instruments");

/** Instrument state display for read tools */
export const GetInstrumentStateDisplay = createInstrumentDisplayUI(
  "get_instrument_state",
);
export const GetChannelConfigDisplay = createInstrumentDisplayUI(
  "get_channel_config",
);

// ── Combined component for easy registration ──

/**
 * Register all instrument tool UI components in one place.
 * Render this inside <AssistantRuntimeProvider> alongside <Thread />.
 */
export function InstrumentToolkit() {
  return (
    <>
      {/* Write-tool confirmation cards */}
      <SetOscilloscopeCouplingGate />
      <SetVoltageRangeGate />
      <SetTimebaseGate />
      <SetGeneratorFrequencyGate />
      <SetGeneratorAmplitudeGate />
      <SetGeneratorWaveformGate />
      <ResetInstrumentsGate />

      {/* Read-tool instrument display cards */}
      <GetInstrumentStateDisplay />
      <GetChannelConfigDisplay />
    </>
  );
}
