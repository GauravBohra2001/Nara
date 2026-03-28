"use client";

import { Area, AreaChart, CartesianGrid, Legend, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { CycleArc } from "@/components/CycleArc";
import { fetchCycle, fetchHistory, type CycleResponse, type HistoryResponse } from "@/lib/api";

const phaseColors = {
  menstruation: "rgba(239,68,68,0.3)",
  follicular: "rgba(34,197,94,0.25)",
  ovulation: "rgba(16,185,129,0.25)",
  luteal: "rgba(249,115,22,0.25)"
};

const phaseThresholds = (length: number) => {
  const menstruation = Math.max(5, Math.round(length * 0.18));
  const follicular = Math.max(menstruation + 1, Math.round(length * 0.46));
  const ovulation = Math.max(follicular + 1, Math.round(length * 0.57));
  return { menstruation, follicular, ovulation };
};

export default function CyclePage() {
  const [cycle, setCycle] = useState<CycleResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchCycle(), fetchHistory(60)])
      .then(([cycleData, historyData]) => {
        if ((cycleData as any).error) {
          throw new Error((cycleData as any).error);
        }
        if ((historyData as any).error) {
          throw new Error((historyData as any).error);
        }
        setCycle(cycleData);
        setHistory(historyData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load cycle data"))
      .finally(() => setLoading(false));
  }, []);

  const chartData = useMemo(() => {
    if (!history) return [];
    return history.days.map((day, index) => ({
      date: day.date,
      hrv: day.hrv,
      resting_hr: day.resting_hr,
      index: index + 1
    }));
  }, [history]);
  const getDateAt = (position: number) => chartData[position]?.date;

  if (loading) {
    return (
      <main className="screen-shell grid place-items-center">
        <div className="panel flex flex-col items-center gap-3 px-6 py-6">
          <div className="h-2 w-48 animate-pulse bg-white/10" />
          <div className="h-2 w-40 animate-pulse bg-white/10" />
          <div className="h-2 w-32 animate-pulse bg-white/10" />
        </div>
      </main>
    );
  }

  if (error || !cycle) {
    return (
      <main className="screen-shell flex items-center justify-center">
        <div className="panel border border-red-400/70 px-6 py-6 text-center text-white">
          <p className="text-lg font-semibold text-red-300">{error ?? "Cycle data unavailable"}</p>
          <p className="mt-2 text-sm text-white/70">Make sure you've uploaded your Apple Health export.</p>
        </div>
      </main>
    );
  }

  const { menstruation, follicular, ovulation } = phaseThresholds(cycle.cycle_length.cycle_length);

  return (
    <main className="screen-shell">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <header>
          <p className="text-xs uppercase tracking-[0.35em] text-white/45">Cycle</p>
          <h1 className="mt-3 text-4xl font-semibold">Cycle Deep Dive</h1>
        </header>

        <section className="panel p-5">
          <ResponsiveContainer width="100%" height={360}>
            <AreaChart data={chartData} margin={{ top: 20, right: 40, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} />
              <YAxis yAxisId="left" orientation="left" tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 12 }} stroke="#5AC8FA" />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 12 }} stroke="#FF375F" />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12 }} />
              <Legend wrapperStyle={{ color: "rgba(255,255,255,0.65)" }} />
              {chartData.length > 1 && (
                <>
                  <ReferenceArea yAxisId="left" x1={chartData[menstruation - 1]?.date} x2={chartData[follicular - 1]?.date} fill={phaseColors.menstruation} />
                  <ReferenceArea yAxisId="left" x1={chartData[follicular]?.date} x2={chartData[ovulation - 1]?.date} fill={phaseColors.follicular} />
                  <ReferenceArea yAxisId="left" x1={chartData[ovulation]?.date} x2={chartData[chartData.length - 1]?.date} fill={phaseColors.luteal} />
                  <ReferenceLine
                    yAxisId="left"
                    x={chartData[chartData.length - 1]?.date}
                    stroke="#FFD60A"
                    strokeDasharray="4 6"
                    label={{ position: "top", value: "Now", fill: "rgba(255,255,255,0.6)" }}
                  />
                </>
              )}
              <Area yAxisId="left" dataKey="hrv" stroke="#5AC8FA" fill="rgba(90,200,250,0.2)" strokeWidth={3} dot={false} />
              <Area yAxisId="right" dataKey="resting_hr" stroke="#FF375F" fill="rgba(255,55,95,0.2)" strokeWidth={3} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="panel p-6">
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">Cycle detection</p>
            <CycleArc
              currentPhase={cycle.predicted_phase}
              currentDay={cycle.estimated_cycle_day}
              cycleLength={cycle.cycle_length.cycle_length}
            />
            <p className="mt-4 text-sm text-white/70">
              Confidence {Math.round(cycle.confidence * 100)}% · next period in {cycle.days_until_next_period ?? "--"} days
            </p>
          </div>
          <div className="panel p-6">
            <p className="text-lg font-semibold text-white">Phases</p>
            <div className="mt-3 space-y-3">
              {[
                { label: "Menstruation", start: 1, end: menstruation, color: phaseColors.menstruation },
                { label: "Follicular", start: menstruation + 1, end: follicular, color: phaseColors.follicular },
                { label: "Ovulation", start: follicular + 1, end: ovulation, color: phaseColors.ovulation },
                { label: "Luteal", start: ovulation + 1, end: cycle.cycle_length.cycle_length, color: phaseColors.luteal }
              ].map((band) => (
                <div key={band.label} className="rounded-2xl border border-white/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/60">{band.label}</p>
                    <span className="text-xs text-white/50">Days {band.start}-{band.end}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full" style={{ background: band.color }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel grid gap-4 md:grid-cols-2">
          {["menstruation", "follicular", "ovulation", "luteal"].map((phase) => {
            const subset = history?.days.filter((day, index) => {
              const cycleDay = ((index % cycle.cycle_length.cycle_length) + 1);
              if (phase === "menstruation") return cycleDay <= menstruation;
              if (phase === "follicular") return cycleDay > menstruation && cycleDay <= follicular;
              if (phase === "ovulation") return cycleDay > follicular && cycleDay <= ovulation;
              if (phase === "luteal") return cycleDay > ovulation;
              return false;
            });
            const hrvValues = subset?.map((day) => day.hrv).filter((value): value is number => value !== null) ?? [];
            const rhrValues = subset?.map((day) => day.resting_hr).filter((value): value is number => value !== null) ?? [];
            const hrv = hrvValues.length ? (hrvValues.reduce((sum, val) => sum + val, 0) / hrvValues.length).toFixed(1) : "--";
            const rhr = rhrValues.length ? (rhrValues.reduce((sum, val) => sum + val, 0) / rhrValues.length).toFixed(1) : "--";
            return (
              <div key={phase} className="panel flex flex-col gap-3 p-4">
                <p className="text-xs uppercase tracking-[0.35em] text-white/50">{phase}</p>
                <p className="text-lg font-semibold text-white">HRV {hrv} ms</p>
                <p className="text-lg font-semibold text-white">Resting HR {rhr} BPM</p>
              </div>
            );
          })}
        </section>

        <section className="panel p-6 text-center">
          <p className="text-lg font-semibold text-white">Next period in {cycle.days_until_next_period ?? "--"} days</p>
          <p className="mt-2 text-sm text-white/70">Model confidence {Math.round(cycle.confidence * 100)}% · {cycle.cycle_length.cycle_length}-day cycle</p>
        </section>
      </div>
    </main>
  );
}
