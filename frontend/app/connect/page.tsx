"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { uploadHealthFile } from "@/lib/api";

const progressSteps = [
  { id: "hr", label: "Heart rate data mapped" },
  { id: "hrv", label: "HRV baseline built" },
  { id: "sleep", label: "Sleep patterns detected" },
  { id: "cycle", label: "Cycle intelligence ready" }
];

export default function ConnectPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [sequenceIndex, setSequenceIndex] = useState(-1);
  const [sequenceDone, setSequenceDone] = useState(false);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timers, setTimers] = useState<number[]>([]);

  useEffect(() => () => timers.forEach((timeout) => clearTimeout(timeout)), [timers]);

  const triggerSequence = useCallback(() => {
    setSequenceIndex(-1);
    setSequenceDone(false);
    setTimers((prev) => {
      prev.forEach((timeout) => clearTimeout(timeout));
      return [];
    });
    const handles: number[] = [];
    progressSteps.forEach((_, index) => {
      handles.push(
        window.setTimeout(() => {
          setSequenceIndex(index);
          if (index === progressSteps.length - 1) {
            setSequenceDone(true);
            window.setTimeout(() => router.push("/baseline"), 1200);
          }
        }, index * 900 + 500)
      );
    });
    setTimers(handles);
  }, [router]);

  const handleUpload = useCallback(
    async (file: File) => {
      try {
        setError(null);
        setUploading(true);
        setFileLabel(file.name);
        await uploadHealthFile(file);
        triggerSequence();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [triggerSequence]
  );

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  };

  const stepStatus = useMemo(
    () =>
      progressSteps.map((step, index) => ({
        ...step,
        done: index <= sequenceIndex && sequenceIndex >= 0
      })),
    [sequenceIndex]
  );

  return (
    <main className="screen-shell flex flex-col items-center justify-center gap-10">
      <div className="w-full max-w-5xl space-y-10">
        <section className="panel relative overflow-hidden border border-white/10 px-8 py-10">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />
          <div className="relative flex flex-col items-center gap-3 text-center">
            <div className="flex items-center justify-center gap-3 rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.4em] text-white/60">
              <span className="h-2 w-2 rounded-full bg-day-green animate-pulseSoft" />
              Live sync active
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">Apple Health Connected</h1>
            <p className="text-base text-white/70">Your biometrics are syncing in real time from your Apple Watch.</p>
            <div className="mt-6 space-y-2 text-sm text-white/60">
              <p>Last sync: 2 min ago</p>
              <p>103,895 heart rate readings analyzed</p>
              <p>869 HRV measurements processed</p>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-black shadow-lg shadow-black/30"
                onClick={() => router.push("/baseline")}
              >
                View your baseline
              </button>
              <label
                className="text-xs uppercase tracking-[0.4em] text-white/60"
                onClick={() => document.getElementById("nara-upload-toggle")?.click()}
              >
                Import health data
              </label>
            </div>
          </div>
        </section>

        <section className="panel border border-white/10 px-8 py-10">
          <h2 className="text-lg font-semibold text-white">Readiness checklist</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {stepStatus.map((step) => (
              <div key={step.id} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
                <span className={`h-3 w-3 rounded-full ${step.done ? "bg-day-green" : "bg-white/10"}`} />
                <p className={`text-sm ${step.done ? "text-white" : "text-white/60"}`}>{step.label}</p>
              </div>
            ))}
          </div>
          {sequenceDone && (
            <p className="mt-6 text-sm text-day-green">Ready for your first analysis.</p>
          )}
          {error ? <p className="mt-4 text-sm text-day-red">{error}</p> : null}
        </section>

        <input
          id="nara-upload-toggle"
          type="file"
          accept=".xml,text/xml"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
      </div>
    </main>
  );
}
