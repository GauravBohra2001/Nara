"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BiomarkerCard } from "@/components/BiomarkerCard";
import { CycleArc } from "@/components/CycleArc";
import { fetchBaseline, fetchCycle, type BaselineResponse, type CycleResponse } from "@/lib/api";

export default function BaselinePage() {
  const [baseline, setBaseline] = useState<BaselineResponse | null>(null);
  const [cycle, setCycle] = useState<CycleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchBaseline(), fetchCycle()])
      .then(([baselineData, cycleData]) => {
        if ((baselineData as any).error) throw new Error((baselineData as any).error);
        if ((cycleData as any).error) throw new Error((cycleData as any).error);
        setBaseline(baselineData as BaselineResponse);
        setCycle(cycleData as CycleResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load baseline"))
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    if (!baseline) return [];
    return [
      {
        id: "hrv",
        label: "HRV",
        value: `${baseline.hrv_sdnn.mean?.toFixed(1) ?? "--"} ms`,
        description: `Range ${baseline.hrv_sdnn.p10?.toFixed(0) ?? "--"} - ${baseline.hrv_sdnn.p90?.toFixed(0) ?? "--"} ms`,
        progress: 0.7,
        status: "normal",
        direction: "above"
      },
      {
        id: "resting_hr",
        label: "Resting HR",
        value: `${baseline.resting_hr.mean?.toFixed(0) ?? "--"} BPM`,
        description: `Typical range ${baseline.resting_hr.p10?.toFixed(0) ?? "--"} - ${baseline.resting_hr.p90?.toFixed(0) ?? "--"} BPM`,
        progress: 0.5,
        status: "normal",
        direction: "below"
      },
      {
        id: "sleep",
        label: "Sleep",
        value: `${baseline.sleep_hours.mean?.toFixed(2) ?? "--"} hrs`,
        description: `Deep sleep ${baseline.deep_sleep_pct.mean?.toFixed(1) ?? "--"} %`,
        progress: 0.4,
        status: "watch",
        direction: "above"
      },
      {
        id: "exercise",
        label: "Exercise",
        value: `${baseline.exercise.workouts_per_week?.toFixed(1) ?? "--"}x / week`,
        description: `Avg ${baseline.exercise.avg_duration_min?.toFixed(0) ?? "--"} min · Preferred ${baseline.exercise.preferred_type ?? "—"}`,
        progress: 0.6,
        status: "normal",
        direction: "above"
      }
    ];
  }, [baseline]);

  if (loading) {
    return (
      <main className="screen-shell flex items-center justify-center">
        <div className="space-y-4">
          {[...Array(4)].map((_, idx) => (
            <div key={idx} className="panel h-24 w-[320px] animate-pulse bg-white/5" />
          ))}
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="screen-shell flex items-center justify-center">
        <div className="panel border border-red-400/70 px-6 py-6 text-center text-white">
          <p className="text-lg font-semibold text-red-300">{error}</p>
          <p className="mt-2 text-sm text-white/70">Make sure Apple Health export has been uploaded.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen-shell flex flex-col gap-10">
      <section className="panel px-8 py-10 text-center">
        <p className="text-xs uppercase tracking-[0.5em] text-white/60">Baseline</p>
        <h1 className="mt-4 text-4xl font-semibold">This is your body</h1>
        <p className="mt-2 text-base text-white/70">
          We learn from your actual metrics so every insight feels like it was co-written with your biology.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <BiomarkerCard key={card.id} label={card.label} value={card.value} description={card.description} status={card.status as any} direction={card.direction as any} progress={card.progress} />
        ))}
      </section>

      {cycle ? (
        <section className="panel grid gap-6 lg:grid-cols-[360px_1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-white/60">Cycle detection</p>
            <CycleArc currentPhase={cycle.predicted_phase} currentDay={cycle.estimated_cycle_day} cycleLength={cycle.cycle_length.cycle_length} />
          </div>
          <div className="flex flex-col justify-between gap-3">
            <p className="text-2xl font-semibold text-white">{cycle.cycle_length.cycle_length}-day cycle</p>
            <p className="text-sm text-white/70">
              Current phase: <span className="font-medium text-white">{cycle.predicted_phase}</span>
            </p>
            <p className="text-sm text-white/70">Estimated day {cycle.estimated_cycle_day}</p>
            <p className="text-sm text-white/70">Confidence {Math.round(cycle.confidence * 100)}%</p>
            <p className="text-sm text-white/70">
              Next period in {cycle.days_until_next_period ?? cycle.cycle_length.cycle_length} days
            </p>
            <Link href="/today" className="mt-4 inline-flex items-center justify-center rounded-2xl border border-white/30 px-5 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/60">
              Continue to Today
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}
