from __future__ import annotations

import json
import os
import shutil
from collections import defaultdict
from datetime import datetime
from statistics import mean
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from models.baseline import build_baseline
from models.cycle_detector import CycleDetector
from models.deviation import DeviationDetector
from models.energy_curve import estimate_energy_curve
from models.synthetic_data import generate_synthetic_data
from parser.apple_health import parse_apple_health
from services.llm import generate_exercise_suggestion, generate_intervention
from utils.health import (
    aggregate_sleep_nights,
    build_cycle_features,
    build_daily_summaries,
    get_hours_since_last_workout,
    get_today_values,
    get_latest_data_timestamp,
)

app = FastAPI(title="Nara API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
LOCAL_EXPORT_CANDIDATES = [
    os.environ.get("NARA_LOCAL_APPLE_HEALTH_XML"),
    os.path.expanduser("~/Desktop/apple_health_export/export.xml"),
    os.path.expanduser("~/apple_health_export/export.xml"),
]

cycle_detector = CycleDetector()
deviation_detector = DeviationDetector()
X, y = generate_synthetic_data(n_samples=2000)
cycle_detector.train(X, y)
try:
    from sklearn.model_selection import cross_val_score

    scores = cross_val_score(cycle_detector.model, cycle_detector.scaler.transform(X), y, cv=5)
    print(f"Cycle detector CV accuracy: {scores.mean():.1%} (+/- {scores.std():.1%})")
except ImportError:
    print("scikit-learn missing cross_val_score")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _latest_value(series: list[dict[str, Any]], key: str) -> float:
    if not series:
        return 0.0
    ordered = sorted(series, key=lambda item: item.get("timestamp") or "", reverse=True)
    return float(ordered[0].get(key) or 0.0)


def _safe_mean(values: list[float]) -> float:
    clean = [float(value) for value in values if value is not None]
    return round(mean(clean), 2) if clean else 0.0


def _sanitize_for_serialization(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {k: _sanitize_for_serialization(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_for_serialization(v) for v in value]
    return value


def _extract_user_name(parsed: dict[str, Any]) -> str:
    for bucket in ("heart_rate", "resting_hr", "workouts", "active_energy"):
        for entry in parsed.get(bucket, []):
            source = entry.get("sourceName") or ""
            for apost in ("'s", "’s"):
                if apost in source:
                    return source.split(apost)[0].strip()
    user = parsed.get("user", {})
    fallback = user.get("biological_sex")
    return fallback.title() if isinstance(fallback, str) and fallback else "You"


def _resolve_local_export() -> str | None:
    for candidate in LOCAL_EXPORT_CANDIDATES:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _ingest_export(filepath: str, persist_copy: bool = True) -> dict[str, Any]:
    target_path = os.path.join(DATA_DIR, "export.xml")
    if persist_copy and os.path.abspath(filepath) != os.path.abspath(target_path):
        shutil.copy2(filepath, target_path)
        parse_path = target_path
    else:
        parse_path = filepath

    parsed = parse_apple_health(parse_path, days_back=None, save_path=os.path.join(DATA_DIR, "parsed_health.json"))
    baseline = build_baseline(parsed)
    with open(os.path.join(DATA_DIR, "baseline.json"), "w", encoding="utf-8") as f:
        json.dump(baseline, f, indent=2, default=str)

    cycle_detector.save(os.path.join(DATA_DIR, "cycle_model.pkl"))
    return {
        "status": "success",
        "source_path": filepath,
        "user": parsed["user"],
        "data_summary": parsed["data_summary"],
        "baseline": baseline,
    }


@app.post("/api/upload")
async def upload_health_data(file: UploadFile = File(...)):
    """Upload and parse Apple Health export.xml"""
    filepath = os.path.join(DATA_DIR, "export.xml")
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)

    return _ingest_export(filepath, persist_copy=False)


@app.get("/api/local-export")
async def get_local_export_status():
    path = _resolve_local_export()
    return {
        "available": bool(path),
        "path": path,
    }


@app.post("/api/local-export")
async def load_local_export():
    path = _resolve_local_export()
    if not path:
        raise HTTPException(status_code=404, detail="No local Apple Health export.xml found")
    return _ingest_export(path, persist_copy=True)


@app.get("/api/baseline")
async def get_baseline():
    path = os.path.join(DATA_DIR, "baseline.json")
    if not os.path.exists(path):
        return {"error": "No data uploaded yet"}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/cycle")
async def get_cycle():
    parsed_path = os.path.join(DATA_DIR, "parsed_health.json")
    baseline_path = os.path.join(DATA_DIR, "baseline.json")

    if not os.path.exists(parsed_path) or not os.path.exists(baseline_path):
        return {"error": "No data uploaded yet"}

    with open(parsed_path, encoding="utf-8") as f:
        parsed = json.load(f)
    with open(baseline_path, encoding="utf-8") as f:
        baseline = json.load(f)

    features = build_cycle_features(parsed, baseline)
    phase_result = cycle_detector.predict(features)

    daily_rhr = build_daily_summaries(parsed, 90)
    rhr_series = [day["resting_hr"] for day in daily_rhr if day["resting_hr"] is not None]
    rhr_dates = [day["date"] for day in daily_rhr if day["resting_hr"] is not None]
    cycle_length = cycle_detector.detect_cycle_length(rhr_series, rhr_dates)

    estimated_day = cycle_detector.estimate_current_day(
        rhr_series,
        cycle_length["cycle_length"],
        baseline.get("resting_hr", {}).get("mean") or 0,
    )

    response = {
        **phase_result,
        "cycle_length": cycle_length,
        "estimated_cycle_day": estimated_day,
        "days_until_next_period": max(0, cycle_length["cycle_length"] - estimated_day) if estimated_day > 0 else None,
    }
    return _sanitize_for_serialization(response)


@app.get("/api/today")
async def get_today():
    parsed_path = os.path.join(DATA_DIR, "parsed_health.json")
    baseline_path = os.path.join(DATA_DIR, "baseline.json")

    if not os.path.exists(parsed_path) or not os.path.exists(baseline_path):
        return {"error": "No data uploaded yet"}

    with open(parsed_path, encoding="utf-8") as f:
        parsed = json.load(f)
    with open(baseline_path, encoding="utf-8") as f:
        baseline = json.load(f)

    today = get_today_values(parsed)
    features = build_cycle_features(parsed, baseline)
    cycle_data = cycle_detector.predict(features)
    last_workout_hours = get_hours_since_last_workout(parsed)

    deviation = deviation_detector.detect(
        today,
        baseline,
        cycle_data["predicted_phase"],
        last_workout_hours,
    )

    user_name = _extract_user_name(parsed)
    intervention_text = await generate_intervention(
        deviation,
        baseline,
        cycle_data,
        user_name,
    )
    exercise_suggestion = generate_exercise_suggestion(deviation, baseline, cycle_data)

    return {
        "today_values": today,
        "deviation": deviation,
        "cycle": cycle_data,
        "intervention": intervention_text,
        "exercise_suggestion": exercise_suggestion,
        "last_workout_hours": last_workout_hours,
    }


@app.get("/api/history")
async def get_history(days: int = 14):
    parsed_path = os.path.join(DATA_DIR, "parsed_health.json")
    baseline_path = os.path.join(DATA_DIR, "baseline.json")

    if not os.path.exists(parsed_path) or not os.path.exists(baseline_path):
        return {"error": "No data uploaded yet"}

    with open(parsed_path, encoding="utf-8") as f:
        parsed = json.load(f)
    with open(baseline_path, encoding="utf-8") as f:
        baseline = json.load(f)

    daily = build_daily_summaries(parsed, days)
    return {"days": daily, "baseline": baseline}


@app.get("/api/energy-curve")
async def energy_curve(deviation_score: int, day_color: str, wake_hour: int = 7):
    return {"curve": estimate_energy_curve(deviation_score, day_color, wake_hour)}


def build_cycle_features(parsed, baseline):
    """Build the 10 features needed for cycle detection from recent data."""
    daily = build_daily_summaries(parsed, 7)
    hrv_values = [day["hrv"] for day in daily if day["hrv"] is not None]
    rhr_values = [day["resting_hr"] for day in daily if day["resting_hr"] is not None]
    sleep_hours = [day["sleep_hours"] for day in daily if day["sleep_hours"] is not None]
    deep_sleep = [day["deep_sleep_pct"] for day in daily if day["deep_sleep_pct"] is not None]
    awakenings = [day["awakenings"] for day in daily if day["awakenings"] is not None]

    hrv_mean = _safe_mean(hrv_values)
    rhr_mean = _safe_mean(rhr_values)

    return {
        "hrv_7day_mean": hrv_mean,
        "hrv_7day_std": round(float(np.std(hrv_values)), 2) if hrv_values else 0.0,
        "hrv_delta_from_baseline": round(hrv_mean - float(baseline.get("hrv_sdnn", {}).get("mean") or 0), 2),
        "rhr_7day_mean": rhr_mean,
        "rhr_delta_from_baseline": round(rhr_mean - float(baseline.get("resting_hr", {}).get("mean") or 0), 2),
        "sleep_hours_7day_mean": _safe_mean(sleep_hours),
        "deep_sleep_pct_7day_mean": _safe_mean(deep_sleep),
        "awakenings_7day_mean": _safe_mean(awakenings),
        "hrv_day_over_day_change": round((hrv_values[-1] - hrv_values[-2]), 2) if len(hrv_values) >= 2 else 0.0,
        "rhr_day_over_day_change": round((rhr_values[-1] - rhr_values[-2]), 2) if len(rhr_values) >= 2 else 0.0,
    }


def get_today_values(parsed):
    """Extract most recent values for each biomarker."""
    sleep_nights = aggregate_sleep_nights(parsed.get("sleep", []))
    latest_sleep = sleep_nights[-1] if sleep_nights else {}

    return {
        "hrv": _latest_value(parsed.get("hrv", []), "sdnn_ms"),
        "resting_hr": _latest_value(parsed.get("resting_hr", []), "value"),
        "sleep_hours": float(latest_sleep.get("total_sleep_hours") or 0.0),
        "deep_sleep_pct": float(latest_sleep.get("deep_sleep_pct") or 0.0),
    }


def get_hours_since_last_workout(parsed):
    """Calculate hours since most recent workout."""
    workouts = parsed.get("workouts", [])
    if not workouts:
        return 9999.0
    latest_end = max((_parse_iso(workout.get("end")) for workout in workouts), default=None)
    if not latest_end:
        return 9999.0
    reference_time = get_latest_data_timestamp(parsed, ("hrv", "resting_hr", "sleep", "workouts")) or datetime.now(latest_end.tzinfo)
    return round((reference_time - latest_end).total_seconds() / 3600.0, 2)


def build_daily_summaries(parsed, days):
    """Build per-day summaries of all biomarkers for trend charts."""
    reference_date = (
        get_latest_data_timestamp(parsed, ("hrv", "resting_hr", "sleep", "workouts"))
        or datetime.now().astimezone()
    ).date()
    cutoff = reference_date.fromordinal(reference_date.toordinal() - days + 1)
    daily: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "date": None,
            "hrv_values": [],
            "resting_hr_values": [],
            "sleep_hours": 0.0,
            "deep_sleep_pct": None,
            "awakenings": 0,
            "workout": False,
        }
    )

    for item in parsed.get("hrv", []):
        dt = _parse_iso(item.get("timestamp"))
        if dt and dt.date() >= cutoff and item.get("sdnn_ms") is not None:
            entry = daily[dt.date().isoformat()]
            entry["date"] = dt.date().isoformat()
            entry["hrv_values"].append(float(item["sdnn_ms"]))

    for item in parsed.get("resting_hr", []):
        dt = _parse_iso(item.get("timestamp"))
        if dt and dt.date() >= cutoff and item.get("value") is not None:
            entry = daily[dt.date().isoformat()]
            entry["date"] = dt.date().isoformat()
            entry["resting_hr_values"].append(float(item["value"]))

    for night in aggregate_sleep_nights(parsed.get("sleep", [])):
        night_date = datetime.fromisoformat(f"{night['night']}").date()
        if night_date >= cutoff:
            entry = daily[night["night"]]
            entry["date"] = night["night"]
            entry["sleep_hours"] = float(night.get("total_sleep_hours") or 0.0)
            entry["deep_sleep_pct"] = float(night.get("deep_sleep_pct") or 0.0)
            entry["awakenings"] = int(night.get("awakenings") or 0)

    for workout in parsed.get("workouts", []):
        dt = _parse_iso(workout.get("start"))
        if dt and dt.date() >= cutoff:
            entry = daily[dt.date().isoformat()]
            entry["date"] = dt.date().isoformat()
            entry["workout"] = True

    results = []
    for offset in range(days):
        day = cutoff.fromordinal(cutoff.toordinal() + offset)
        key = day.isoformat()
        entry = daily.get(key, {"date": key, "hrv_values": [], "resting_hr_values": [], "sleep_hours": None, "deep_sleep_pct": None, "awakenings": None, "workout": False})
        results.append(
            {
                "date": key,
                "hrv": round(mean(entry["hrv_values"]), 2) if entry.get("hrv_values") else None,
                "resting_hr": round(mean(entry["resting_hr_values"]), 2) if entry.get("resting_hr_values") else None,
                "sleep_hours": entry.get("sleep_hours"),
                "deep_sleep_pct": entry.get("deep_sleep_pct"),
                "awakenings": entry.get("awakenings"),
                "workout": entry.get("workout", False),
            }
        )
    return results
