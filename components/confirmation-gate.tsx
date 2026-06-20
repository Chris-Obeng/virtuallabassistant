"use client";

import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { makeAssistantToolUI, useAui } from "@assistant-ui/react";
import { useCallback } from "react";

// ── Types ──

export type ProposedAction = {
  requiresConfirmation: true;
  proposedAction: string;
  safetyWarning?: string;
};

export type SafetyBlocked = {
  status: "safety_blocked";
  message: string;
};

export type Executed = {
  status: "executed";
  message: string;
};

export type ToolResult = ProposedAction | SafetyBlocked | Executed;

// ── Shared renderer factory ──

function createInstrumentToolUI(toolName: string) {
  return makeAssistantToolUI<unknown, ToolResult>({
    toolName,
    render: function InstrumentAction({ args, result, status }) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const aui = useAui();

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handleConfirm = useCallback(
        (proposal: string) => {
          aui
            .thread()
            .append({
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
        aui
          .thread()
          .append({
            role: "user",
            content: [
              {
                type: "text",
                text: `Cancel that instrument action.`,
              },
            ],
          });
      }, [aui]);

      return (
        <InstrumentActionCard
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

// ── Individual tool UI components ──

export const SetOscilloscopeCouplingGate = createInstrumentToolUI("set_oscilloscope_coupling");
export const SetVoltageRangeGate = createInstrumentToolUI("set_voltage_range");
export const SetTimebaseGate = createInstrumentToolUI("set_timebase");
export const SetGeneratorFrequencyGate = createInstrumentToolUI("set_generator_frequency");
export const SetGeneratorAmplitudeGate = createInstrumentToolUI("set_generator_amplitude");
export const SetGeneratorWaveformGate = createInstrumentToolUI("set_generator_waveform");
export const ResetInstrumentsGate = createInstrumentToolUI("reset_instruments");

/**
 * Group component that renders all instrument gate UIs in one place.
 */
export function InstrumentConfirmationGates() {
  return (
    <>
      <SetOscilloscopeCouplingGate />
      <SetVoltageRangeGate />
      <SetTimebaseGate />
      <SetGeneratorFrequencyGate />
      <SetGeneratorAmplitudeGate />
      <SetGeneratorWaveformGate />
      <ResetInstrumentsGate />
    </>
  );
}

// ── Card Component ──

function InstrumentActionCard({
  toolName,
  args,
  result: rawResult,
  status: rawStatus,
  onConfirm,
  onCancel,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult | undefined;
  status: { readonly type: string };
  onConfirm: (proposal: string) => void;
  onCancel: () => void;
}) {
  // assistant-ui v0.14 status is an object with a `.type` property
  const status = rawStatus.type;

  // LangChain tools return JSON strings — parse into an object
  let result: ToolResult | undefined;
  if (typeof rawResult === "string") {
    try {
      result = JSON.parse(rawResult);
    } catch {
      result = rawResult as unknown as ToolResult;
    }
  } else {
    result = rawResult as ToolResult | undefined;
  }

  // Still running / waiting
  if (status === "running") {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground animate-pulse">
        <FlaskConical className="size-4" />
        Preparing instrument action...
      </div>
    );
  }

  // Not yet completed
  if (status !== "complete" || !result) return null;

  // ── Safety blocked ──
  if ("status" in result && result.status === "safety_blocked") {
    return (
      <Alert variant="destructive" className="my-2 border-destructive/50">
        <ShieldAlert className="size-5" />
        <AlertTitle className="font-semibold">⛔ Safety Blocked</AlertTitle>
        <AlertDescription className="mt-1 text-sm">
          {result.message}
        </AlertDescription>
      </Alert>
    );
  }

  // ── Executed successfully ──
  if ("status" in result && result.status === "executed") {
    return (
      <Alert className="my-2 border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/20">
        <CheckCircle2 className="size-5 text-emerald-600" />
        <AlertTitle className="font-semibold text-emerald-700 dark:text-emerald-400">
          ✓ Action Executed
        </AlertTitle>
        <AlertDescription className="mt-1 text-sm text-emerald-600 dark:text-emerald-300">
          {result.message}
        </AlertDescription>
      </Alert>
    );
  }

  // ── Safety warning (from proposed action) ──
  const safetyWarning =
    "safetyWarning" in result ? (result as ProposedAction).safetyWarning : undefined;

  // ── Requires confirmation ──
  if ("requiresConfirmation" in result && result.requiresConfirmation) {
    return (
      <Alert className="my-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 text-amber-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <AlertTitle className="font-semibold text-amber-800 dark:text-amber-300">
              🔧 Proposed Instrument Action
            </AlertTitle>
            <AlertDescription className="mt-2 text-sm text-amber-700 dark:text-amber-200">
              <p>{result.proposedAction}</p>
              {safetyWarning && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-400/40 bg-amber-100/50 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{safetyWarning}</span>
                </p>
              )}
            </AlertDescription>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                disabled={!!safetyWarning}
                className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => onConfirm(result.proposedAction)}
              >
                <CheckCircle2 className="mr-1.5 size-4" />
                {safetyWarning ? "Blocked by Safety" : "Confirm & Execute"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300"
                onClick={onCancel}
              >
                <XCircle className="mr-1.5 size-4" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </Alert>
    );
  }

  return null;
}
