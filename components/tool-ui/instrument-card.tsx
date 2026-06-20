"use client";

import { useMemo, type FC } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Activity,
  Gauge,
  Radio,
  Waves,
} from "lucide-react";

// ── Types ──

interface OscilloscopeChannelData {
  channel: number;
  coupling: string;
  voltageRangeV: number;
  timebaseS?: number;
  probeAttenuation: number;
}

interface GeneratorChannelData {
  channel: number;
  waveform: string;
  frequencyHz: number;
  amplitudeVpp: number;
  offsetV: number;
}

/** Format timebase seconds into a human-readable string */
function formatTimebase(s: number): string {
  if (s >= 1) return `${s} s/div`;
  if (s >= 0.001) return `${(s * 1_000).toFixed(0)} ms/div`;
  return `${(s * 1_000_000).toFixed(0)} µs/div`;
}

/** Format frequency Hz into a human-readable string */
function formatFrequency(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

/** Format voltage with appropriate unit */
function formatVoltage(v: number): string {
  if (v >= 1) return `${v.toFixed(1)} V`;
  return `${(v * 1_000).toFixed(0)} mV`;
}

// ── Channel row component ──

const ChannelRow: FC<{
  channel: number;
  coupling?: string;
  voltageRange?: number;
  timebase?: number;
  probeAttenuation?: number;
  waveform?: string;
  frequency?: number;
  amplitude?: number;
  offset?: number;
}> = ({
  channel,
  coupling,
  voltageRange,
  timebase,
  probeAttenuation,
  waveform,
  frequency,
  amplitude,
  offset,
}) => (
  <div className="rounded-lg border bg-card p-3">
    <div className="flex items-center gap-2 mb-2">
      <Badge
        variant="outline"
        className="bg-primary/10 text-primary border-primary/30 text-xs font-mono"
      >
        CH{channel}
      </Badge>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Channel
      </span>
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
      {coupling && (
        <>
          <span className="text-muted-foreground text-xs">Coupling</span>
          <span className="font-mono text-xs text-right">{coupling}</span>
        </>
      )}
      {voltageRange !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">V/div</span>
          <span className="font-mono text-xs text-right">{voltageRange} V</span>
        </>
      )}
      {timebase !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">Timebase</span>
          <span className="font-mono text-xs text-right">{formatTimebase(timebase)}</span>
        </>
      )}
      {probeAttenuation !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">Probe</span>
          <span className="font-mono text-xs text-right">{probeAttenuation}×</span>
        </>
      )}
      {waveform && (
        <>
          <span className="text-muted-foreground text-xs">Waveform</span>
          <span className="font-mono text-xs text-right capitalize">{waveform}</span>
        </>
      )}
      {frequency !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">Frequency</span>
          <span className="font-mono text-xs text-right">{formatFrequency(frequency)}</span>
        </>
      )}
      {amplitude !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">Amplitude</span>
          <span className="font-mono text-xs text-right">{amplitude} Vpp</span>
        </>
      )}
      {offset !== undefined && (
        <>
          <span className="text-muted-foreground text-xs">Offset</span>
          <span className="font-mono text-xs text-right">{formatVoltage(offset)}</span>
        </>
      )}
    </div>
  </div>
);

// ── Parse JSON result ──

function parseInstrumentResult(result: unknown): Record<string, unknown> | null {
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof result === "object" && result !== null) {
    return result as Record<string, unknown>;
  }
  return null;
}

// ── Main Instrument Card ──

export type InstrumentCardProps = {
  result: unknown;
  status: { readonly type: string };
};

export const InstrumentCard: FC<InstrumentCardProps> = ({
  result: rawResult,
  status: rawStatus,
}) => {
  const status = rawStatus.type;
  const data = useMemo(() => parseInstrumentResult(rawResult), [rawResult]);

  if (status === "running") {
    return (
      <Card className="my-2 border-muted-foreground/30">
        <CardContent className="flex items-center gap-2 pt-4">
          <Activity className="size-4 animate-pulse text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Reading instrument state...</span>
        </CardContent>
      </Card>
    );
  }

  if (status !== "complete" || !data) return null;

  // Detect if this is oscilloscope data or generator data
  const hasOscilloscope = "oscilloscope" in data;
  const hasGenerator = "signalGenerator" in data || "signal_generator" in data;
  const isChannelConfig = "channel" in data && ("coupling" in data || "waveform" in data);

  // ── Full instrument state (get_instrument_state) ──
  if (hasOscilloscope || hasGenerator) {
    const scope = data.oscilloscope as any;
    const gen = (data.signalGenerator ?? data.signal_generator) as any;

    return (
      <Card className="my-2">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-blue-600" />
            <CardTitle className="text-sm font-semibold">Instrument State</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Oscilloscope */}
          {scope && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Radio className="size-3.5 text-blue-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                  Oscilloscope
                </span>
                {scope.triggerSource && (
                  <Badge variant="secondary" className="text-[10px] ml-auto">
                    Trig: CH{scope.triggerSource} @ {formatVoltage(scope.triggerLevelV ?? 0)}
                  </Badge>
                )}
              </div>
              <div className="grid gap-2">
                {(scope.channels ?? [] as OscilloscopeChannelData[]).map((ch: OscilloscopeChannelData) => (
                  <ChannelRow
                    key={`scope-ch${ch.channel}`}
                    channel={ch.channel}
                    coupling={ch.coupling}
                    voltageRange={ch.voltageRangeV}
                    timebase={ch.timebaseS}
                    probeAttenuation={ch.probeAttenuation}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Signal Generator */}
          {gen && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Waves className="size-3.5 text-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Signal Generator
                </span>
              </div>
              <div className="grid gap-2">
                {(gen.channels ?? [] as GeneratorChannelData[]).map((ch: GeneratorChannelData) => (
                  <ChannelRow
                    key={`gen-ch${ch.channel}`}
                    channel={ch.channel}
                    waveform={ch.waveform}
                    frequency={ch.frequencyHz}
                    amplitude={ch.amplitudeVpp}
                    offset={ch.offsetV}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Single channel config (get_channel_config) ──
  if (isChannelConfig) {
    const ch = data as any;
    const channelNum = ch.channel as number;
    const isScope = "coupling" in ch;

    return (
      <Card className="my-2">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            {isScope ? (
              <Radio className="size-4 text-blue-600" />
            ) : (
              <Waves className="size-4 text-emerald-600" />
            )}
            <CardTitle className="text-sm font-semibold">
              {isScope ? "Oscilloscope" : "Generator"} CH{channelNum}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ChannelRow
            channel={channelNum}
            coupling={isScope ? (ch.coupling as string) : undefined}
            voltageRange={isScope ? (ch.voltageRangeV as number) : undefined}
            timebase={isScope ? (ch.timebaseS as number) : undefined}
            probeAttenuation={isScope ? (ch.probeAttenuation as number) : undefined}
            waveform={!isScope ? (ch.waveform as string) : undefined}
            frequency={!isScope ? (ch.frequencyHz as number) : undefined}
            amplitude={!isScope ? (ch.amplitudeVpp as number) : undefined}
            offset={!isScope ? (ch.offsetV as number) : undefined}
          />
        </CardContent>
      </Card>
    );
  }

  // Fallback: show raw data
  return (
    <Card className="my-2">
      <CardContent className="pt-4">
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
};
