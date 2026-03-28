"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { BiomarkerCard } from "@/components/BiomarkerCard";
import { CycleArc } from "@/components/CycleArc";
import { DayBadge } from "@/components/DayBadge";
import { ExerciseCard } from "@/components/ExerciseCard";
import { LiveToast } from "@/components/LiveToast";
import SparklineChart from "@/components/SparklineChart";
import { fetchEnergyCurve, fetchHistory, fetchLive, fetchToday } from "@/lib/api";
import type { EnergyCurvePoint, HistoryResponse, LiveResponse, TodayResponse } from "@/lib/api";

const dayColorPalette: Record<string, { card: string; glow: string }> = {
  green: { card: "from-[#0f766e]/40 to-[#020617]", glow: "shadow-[0_0_55px_rgba(16,185,129,0.45)]" },
  yellow: { card: "from-[#d97706]/30 to-[#020617]", glow: "shadow-[0_0_55px_rgba(234,179,8,0.35)]" },
  orange: { card: "from-[#f97316]/30 to-[#020617]", glow: "shadow-[0_0_55px_rgba(249,115,22,0.35)]" },
  red: { card: "from-[#ef4444]/30 to-[#020617]", glow: "shadow-[0_0_55px_rgba(239,68,68,0.35)]" }
};

const baseEnergyCurve = [
  { hour: 6, energy: 40 },
  { hour: 7, energy: 70 },
  { hour: 8, energy: 85 },
  { hour: 9, energy: 95 },
  { hour: 10, energy: 90 },
  { hour: 11, energy: 85 },
  { hour: 12, energy: 75 },
  { hour: 13, energy: 65 },
  { hour: 14, energy: 55 },
  { hour: 15, energy: 60 },
  { hour: 16, energy: 70 },
  { hour: 17, energy: 65 },
  { hour: 18, energy: 55 },
  { hour: 19, energy: 45 },
  { hour: 20, energy: 35 },
  { hour: 21, energy: 25 },
  { hour: 22, energy: 20 },
  { hour: 23, energy: 15 }
];

const energyModifiers = {
  green: { factor: 1, dip: 0 },
  yellow: { factor: 0.8, dip: 12 },
  orange: { factor: 0.65, dip: 22 },
  red: { factor: 0.5, dip: 32 }
};

function computeEnergyCurve(color: string) {
  const config = energyModifiers[color] ?? energyModifiers.green;
  return baseEnergyCurve.map((point) => ({
    hour: point.hour,
    label: `${point.hour}:00`,
    energy: Math.max(5, Math.min(100, point.energy * config.factor - (point.hour >= 13 ? config.dip : 0)))
  }));
}

function EnergyCurve({ data, color }: { data: EnergyCurvePoint[]; color: string }) {
  const stroke = color === "green" ? "#30D158" : color === "yellow" ? "#FFD60A" : color === "orange" ? "#FF9F0A" : "#FF375F";

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.35em] text-white/60">Energy curve</p>
        <span className="text-xs text-white/40">6am – 11pm</span>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.8} />
                <stop offset="85%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.45)" />
            <YAxis axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.45)" domain={[0, 100]} />
            <Tooltip
              contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14 }}
              labelStyle={{ color: "rgba(255,255,255,0.65)" }}
            />
            <Area type="monotone" dataKey="energy" stroke={stroke} strokeWidth={3} fill="url(#energyGradient)" dot={false} />
            <ReferenceLine x={(new Date().getHours() % 24).toString()} stroke="rgba(255,255,255,0.6)" strokeDasharray="3 6" label={{ position: "top", value: "Now", fill: "rgba(255,255,255,0.6)" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function TodayPage() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [energyCurve, setEnergyCurve] = useState<EnergyCurvePoint[] | null>(null);
  const [liveReading, setLiveReading] = useState<LiveResponse | null>(null);
  const [toastQueue, setToastQueue] = useState<LiveResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchToday(), fetchHistory(7)])
      .then(([todayData, historyData]) => {
        if (!isMounted) return;
        if ("error" in todayData) throw new Error(todayData.error);
        setToday(todayData);
        setHistory(historyData);
        return fetchEnergyCurve(todayData.deviation.deviation_score, todayData.deviation.day_color);
      })
      .then((curveData) => {
        if (!isMounted) return;
        setEnergyCurve(curveData.curve);
      })
      .catch((err) => console.error(err))
      .finally(() => isMounted && setLoading(false));

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchLive().then((data) => {
        if ("error" in data) return;
        setLiveReading(data);
        if (data.intervention) {
          setToastQueue((prev) => [...prev, data]);
          setTimeout(() => setToastQueue((prev) => prev.slice(1)), 20000);
        }
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const sparklineData = useMemo(() => history?.days ?? [], [history]);

  if (loading || !today) {
    return (
      <main className="screen-shell grid place-items-center">
        <div className="panel px-5 py-5 text-center text-white/70">Loading today’s signal…</div>
      </main>
    );
  }

  const badgeColor = today.deviation.day_color ?? "green";
  const hero = dayColorPalette[badgeColor] ?? dayColorPalette.green;
  const cycleLengthValue = today.cycle?.cycle_length?.cycle_length ?? 28;
  const cyclePhaseLabel = today.cycle?.predicted_phase ?? "unknown";
  const gaugeProgress = (biomarker: TodayResponse["deviation"]["biomarkers"][number]) => Math.min(1, Math.abs(biomarker.z_score) / 3);

  return (
    <main className="screen-shell flex flex-col gap-6">
      <section className={`panel relative overflow-hidden border border-white/10 bg-gradient-to-br ${hero.card} ${hero.glow}`}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-white/60">Daily load</p>
            <p className="text-[80px] font-semibold text-white tabular-nums">{today.deviation.deviation_score}</p>
            <p className="uppercase tracking-[0.4em] text-sm text-white/60">{badgeColor} day</p>
          </div>
          <div className="max-w-2xl text-base leading-relaxed text-white/90">
            <p className="text-xs uppercase tracking-[0.3em] text-white/70">Intervention</p>
            <p className="mt-3 text-lg leading-relaxed">{today.intervention}</p>
          </div>
        </div>
        {liveReading ? (
          <div className="absolute right-6 top-6 flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[0.65rem] uppercase tracking-[0.35em] text-white">
            <span className="h-2 w-2 rounded-full bg-day-green animate-pulseSoft" />
            LIVE {liveReading.value} BPM
          </div>
        ) : null}
      </section>

      <DayBadge color={badgeColor as "green" | "yellow" | "orange" | "red"} score={today.deviation.deviation_score} />

      <section className="grid gap-4 lg:grid-cols-2">
        {today.deviation.biomarkers.map((biomarker) => (
          <BiomarkerCard
            key={biomarker.name}
            label={biomarker.name}
            value={`${biomarker.value.toFixed(1)} ${biomarker.unit}`}
            description={`Expected ${biomarker.expected.toFixed(1)} ${biomarker.unit}`}
            status={biomarker.status}
            direction={biomarker.direction}
            progress={gaugeProgress(biomarker)}
          />
        ))}
      </section>

      <EnergyCurve data={energyCurve ?? computeEnergyCurve(badgeColor)} color={badgeColor} />

      <ExerciseCard text={today.exercise_suggestion} />

      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-[0.45em] text-white/50">Cycle position</p>
          <CycleArc
            currentPhase={cyclePhaseLabel}
            currentDay={today.cycle?.estimated_cycle_day ?? 0}
            cycleLength={cycleLengthValue}
            compact={false}
          />
          <p className="mt-4 text-sm text-white/60">
            Day {today.cycle?.estimated_cycle_day ?? "--"} of {cycleLengthValue} — {cyclePhaseLabel}
          </p>
        </div>
        <div className="grid gap-4">
          <SparklineChart
            data={sparklineData}
            dataKey="hrv"
            baseline={history?.baseline?.hrv_sdnn?.mean ?? 0}
            color="#5AC8FA"
            label="HRV"
          />
          <SparklineChart
            data={sparklineData}
            dataKey="resting_hr"
            baseline={history?.baseline?.resting_hr?.mean ?? 0}
            color="#FF375F"
            label="Resting HR"
          />
        </div>
      </section>

      <div className="space-y-2">
        {toastQueue.map((toast) => (
          <LiveToast
            key={toast.timestamp}
            color={toast.status === "alert" ? "border-day-red" : toast.status === "warning" ? "border-day-orange" : "border-day-green"}
            message={toast.intervention ?? "Live reading"}
            onClose={() => setToastQueue((prev) => prev.filter((t) => t.timestamp !== toast.timestamp))}
          />
        ))}
      </div>

      <section className="panel p-5">
        <p className="text-xs uppercase tracking-[0.45em] text-white/60">Live readings</p>
        <div className="mt-3 grid gap-3">
          {[...new Array(3)].map((_, index) => (
            <div key={index} className="flex items-center justify-between">
              <span className="text-sm text-white/60">{liveReading?.timestamp ?? "--"}</span>
              <span className="text-lg font-semibold text-white">{liveReading?.value ?? "--"} BPM</span>
              <span
                className={`h-3 w-3 rounded-full ${
                  liveReading?.status === "alert" ? "bg-day-red" : liveReading?.status === "warning" ? "bg-day-orange" : "bg-day-green"
                }`}
              />
            </div>
          ))}
        </div>
      </section>

      <Link href="/cycle" className="text-sm uppercase tracking-[0.35em] text-white/60">
        Open cycle deep dive
      </Link>
    </main>
  );
}
