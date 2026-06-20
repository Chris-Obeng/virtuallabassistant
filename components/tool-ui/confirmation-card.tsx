"use client";

import { useCallback, useMemo, type FC } from "react";
import { useAui } from "@assistant-ui/react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

/** Parse a LangChain tool result (string or object) into a structured result */
function parseResult(result: unknown): ToolResult | null {
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as ToolResult;
    } catch {
      return null;
    }
  }
  if (typeof result === "object" && result !== null) {
    return result as ToolResult;
  }
  return null;
}

// ── Human-readable tool action descriptions ──

interface ActionDetail {
  label: string;
  value: string;
  current?: string;
}

function getActionDetails(toolName: string, args: Record<string, unknown>): {
  title: string;
  details: ActionDetail[];
} {
  switch (toolName) {
    case "set_oscilloscope_coupling": {
      const ch = args.channel as number;
      const coupling = args.coupling as string;
      return {
        title: `Oscilloscope CH${ch} Coupling`,
        details: [
          { label: "Channel", value: `CH${ch}` },
          { label: "New Coupling", value: coupling ?? "—" },
        ],
      };
    }
    case "set_voltage_range": {
      const ch = args.channel as number;
      const voltage = args.voltageV as number;
      return {
        title: `Oscilloscope CH${ch} Voltage Range`,
        details: [
          { label: "Channel", value: `CH${ch}` },
          { label: "New Range", value: voltage ? `${voltage} V/div` : "—" },
        ],
      };
    }
    case "set_timebase": {
      const tb = args.timebaseS as number;
      const label = tb < 0.001 ? `${(tb * 1_000_000).toFixed(0)} µs/div` : `${(tb * 1_000).toFixed(0)} ms/div`;
      return {
        title: "Oscilloscope Timebase",
        details: [{ label: "New Timebase", value: label }],
      };
    }
    case "set_generator_frequency": {
      const ch = args.channel as number;
      const freq = args.frequencyHz as number;
      const label = freq >= 1000 ? `${(freq / 1000).toFixed(1)} kHz` : `${freq} Hz`;
      return {
        title: `Generator CH${ch} Frequency`,
        details: [
          { label: "Channel", value: `CH${ch}` },
          { label: "New Frequency", value: label },
        ],
      };
    }
    case "set_generator_amplitude": {
      const ch = args.channel as number;
      const amp = args.amplitudeVpp as number;
      return {
        title: `Generator CH${ch} Amplitude`,
        details: [
          { label: "Channel", value: `CH${ch}` },
          { label: "New Amplitude", value: amp ? `${amp} Vpp` : "—" },
        ],
      };
    }
    case "set_generator_waveform": {
      const ch = args.channel as number;
      const wf = args.waveform as string;
      return {
        title: `Generator CH${ch} Waveform`,
        details: [
          { label: "Channel", value: `CH${ch}` },
          { label: "New Waveform", value: wf ?? "—" },
        ],
      };
    }
    case "reset_instruments":
      return {
        title: "Reset Instruments",
        details: [{ label: "Action", value: "Factory reset both instruments" }],
      };
    default:
      return {
        title: toolName,
        details: Object.entries(args).map(([k, v]) => ({
          label: k,
          value: String(v ?? "—"),
        })),
      };
  }
}

// ── Confirmation Card Component ──

export type ConfirmationCardProps = {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult | undefined;
  status: { readonly type: string };
  onConfirm: (proposal: string) => void;
  onCancel: () => void;
};

export const ConfirmationCard: FC<ConfirmationCardProps> = ({
  toolName,
  args,
  result: rawResult,
  status: rawStatus,
  onConfirm,
  onCancel,
}) => {
  const status = rawStatus.type;
  const result = useMemo(() => parseResult(rawResult), [rawResult]);

  // Parse the action details from the tool name + args
  const actionDetails = useMemo(
    () => getActionDetails(toolName, args),
    [toolName, args],
  );

  // ── Running ──
  if (status === "running") {
    return (
      <Card className="my-2 border-muted-foreground/30">
        <CardContent className="flex items-center gap-3 pt-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            Preparing instrument action...
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Incomplete / cancelled ──
  if (status === "incomplete") {
    return (
      <Card className="my-2 border-muted-foreground/30 bg-muted/30">
        <CardContent className="flex items-center gap-3 pt-4">
          <XCircle className="size-4 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            Instrument action cancelled
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not yet complete and no result
  if (status !== "complete" || !result) return null;

  // ── Final state: Safety Blocked ──
  if ("status" in result && result.status === "safety_blocked") {
    return (
      <Card className="my-2 border-destructive/50 bg-destructive/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            <CardTitle className="text-destructive text-sm">⛔ Safety Blocked</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive/90">{result.message}</p>
        </CardContent>
      </Card>
    );
  }

  // ── Final state: Executed successfully ──
  if ("status" in result && result.status === "executed") {
    return (
      <Card className="my-2 border-emerald-500/50 bg-emerald-50/80 dark:bg-emerald-950/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            <CardTitle className="text-emerald-700 dark:text-emerald-400 text-sm">
              ✓ Action Executed
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {/* Show the action that was executed */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium text-foreground">{actionDetails.title}:</span>
            {actionDetails.details.map((d) => (
              <Badge key={d.label} variant="secondary" className="text-xs">
                {d.label}: {d.value}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-emerald-600 dark:text-emerald-300 mt-1">
            {result.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Requires confirmation (proposed action) ──

  if (!("requiresConfirmation" in result) || !result.requiresConfirmation) {
    return null;
  }

  const proposedAction = (result as ProposedAction).proposedAction;
  const safetyWarning = (result as ProposedAction).safetyWarning;
  const hasSafetyWarning = !!safetyWarning;

  return (
    <Card
      className={cn(
        "my-2",
        hasSafetyWarning
          ? "border-red-400/60 bg-red-50/80 dark:bg-red-950/20"
          : "border-amber-400/60 bg-amber-50/80 dark:bg-amber-950/20",
      )}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertCircle
            className={cn(
              "mt-0.5 size-5 shrink-0",
              hasSafetyWarning ? "text-red-600" : "text-amber-600",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                🔧 Proposed Action
              </CardTitle>
              {hasSafetyWarning && (
                <Badge
                  variant="destructive"
                  className="text-[10px] px-1.5 py-0"
                >
                  ⚠ Safety Warning
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-sm text-amber-700 dark:text-amber-300">
              {proposedAction}
            </p>
          </div>
        </div>
      </CardHeader>

      {/* Details grid */}
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {actionDetails.details.map((d) => (
            <Badge
              key={d.label}
              variant="outline"
              className={cn(
                "text-xs border-amber-300 dark:border-amber-700",
                hasSafetyWarning &&
                  "border-red-300 dark:border-red-700",
              )}
            >
              <span className="text-muted-foreground mr-1">{d.label}:</span>
              <span className="font-medium">{d.value}</span>
            </Badge>
          ))}
        </div>

        {/* Safety warning */}
        {hasSafetyWarning && (
          <div className="flex items-start gap-2 rounded-md border border-red-400/40 bg-red-100/60 p-2.5 text-sm dark:bg-red-900/30">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
            <span className="text-red-800 dark:text-red-200">
              {safetyWarning}
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={hasSafetyWarning}
          className={cn(
            "bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          onClick={() => onConfirm(proposedAction)}
        >
          <CheckCircle2 className="mr-1.5 size-4" />
          {hasSafetyWarning ? "Blocked by Safety" : "Confirm & Execute"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn(
            "border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30",
            hasSafetyWarning &&
              "border-red-300 text-red-800 hover:bg-red-100 dark:border-red-700 dark:text-red-300",
          )}
          onClick={onCancel}
        >
          <XCircle className="mr-1.5 size-4" />
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
};
