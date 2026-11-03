"""Evaluate rules only, model only and hybrid on the synthetic test sets; write EVALUATION.md."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.features import FormValues, compute_features  # noqa: E402
from app.model import load_scorer  # noqa: E402
from app.rules import evaluate_rules  # noqa: E402
from training.generate import FAULTS  # noqa: E402


def load(name: str) -> list[dict]:
    return [json.loads(line) for line in (ROOT / "data" / f"{name}.jsonl").read_text().splitlines()]


def flags(rows: list[dict], scorer) -> list[dict]:
    feats = [compute_features(FormValues.model_validate(r["values"]), r["today"], r["requiredDocs"]) for r in rows]
    scores = scorer.score_many(feats)
    return [{"rule": bool(evaluate_rules(f)), "model": bool(s > scorer.threshold), "fault": r["fault"]} for f, s, r in zip(feats, scores, rows)]


def metrics(normal: list[dict], faulty: list[dict], key) -> dict:
    tp = sum(1 for x in faulty if key(x))
    fn = len(faulty) - tp
    fp = sum(1 for x in normal if key(x))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": precision, "recall": recall, "false_alarm_rate": fp / len(normal), "tp": tp, "fp": fp, "fn": fn}


def short_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def write_metrics(payload: dict) -> None:
    """Stamp metrics.json with when (and at which commit) these figures were produced.

    Re-running over identical figures keeps the existing stamp, so a reproducibility re-run does not
    dirty the file; the stamp moves only when the figures themselves change.
    """
    path = ROOT / "metrics.json"
    if path.exists():
        try:
            old = json.loads(path.read_text())
        except ValueError:
            old = {}
        stamp = {k: old.pop(k) for k in ("generatedAt", "commit") if k in old}
        if old == payload and "generatedAt" in stamp:
            payload = {**payload, **stamp}
            path.write_text(json.dumps(payload, indent=2) + "\n")
            return
    payload = {**payload, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    commit = short_commit()
    if commit:
        payload["commit"] = commit
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    scorer = load_scorer()
    if scorer is None:
        raise SystemExit("Train the model first (training/train.py).")
    normal = flags(load("test_normal"), scorer)
    faulty = flags(load("test_faulty"), scorer)
    modes = {
        "Rules only": lambda x: x["rule"],
        "Model only": lambda x: x["model"],
        "Hybrid (rules or model)": lambda x: x["rule"] or x["model"],
    }
    results = {name: metrics(normal, faulty, fn) for name, fn in modes.items()}
    per_fault = {}
    for fault in FAULTS:
        sub = [x for x in faulty if x["fault"] == fault]
        per_fault[fault] = {name: sum(1 for x in sub if fn(x)) / len(sub) for name, fn in modes.items()}

    lines = [
        "# Form check evaluation (synthetic data)",
        "",
        "**All figures below are measured on synthetic data** produced by `training/generate.py` (seeded). They show that the",
        "pipeline works and how the rules and the model complement each other; they say nothing yet about real AICTE forms.",
        "Real-world performance must be measured on labelled historical applications before any claim is made.",
        "",
        f"Model: Isolation Forest (200 trees, 256 samples per tree, random_state 7), version `{scorer.version}`.",
        f"Threshold: 97th percentile of training anomaly scores = {scorer.threshold:.4f}.",
        f"Test sets: {len(normal)} normal forms, {len(faulty)} faulty forms (200 per fault type).",
        "",
        "## Overall",
        "",
        "| Mode | Precision | Recall | False-alarm rate |",
        "|---|---:|---:|---:|",
    ]
    for name, m in results.items():
        lines.append(f"| {name} | {m['precision']:.3f} | {m['recall']:.3f} | {m['false_alarm_rate']:.3f} |")
    lines += ["", "## Recall per fault type", "", "| Fault | Rules only | Model only | Hybrid |", "|---|---:|---:|---:|"]
    labels = {
        "unit_error": "Unit error on land area (x10, /10, x10.76)",
        "builtup_over": "Built-up larger than plot",
        "faculty_short": "Faculty shortage",
        "expired_lease": "Expired lease",
        "bulk_missing": "Bulk fill with missing documents",
    }
    for fault, r in per_fault.items():
        lines.append(f"| {labels[fault]} | {r['Rules only']:.3f} | {r['Model only']:.3f} | {r['Hybrid (rules or model)']:.3f} |")
    lines += [
        "",
        "## Reading the numbers",
        "",
        "* Rules catch the faults they were written for with no false alarms on normal forms; they cannot see a unit error that keeps",
        "  the built-up area below the plot (for example land multiplied by 10).",
        "* The model flags unusual combinations, which is where unit errors show up, at the cost of a small false-alarm rate set by the",
        "  97th-percentile threshold. Model warnings are MEDIUM severity and only ask for a justification.",
        "* The check is advisory: it never blocks filing and never affects routing, deadlines, assignment or Action Center order.",
        "",
    ]
    payload = {
        "model": scorer.version,
        "threshold": round(float(scorer.threshold), 4),
        "datasets": {"train": len(load("train")), "testNormal": len(normal), "testFaulty": len(faulty), "synthetic": True},
        "modes": {
            name: {k: round(r[k], 3) for k in ("precision", "recall", "false_alarm_rate")} for name, r in results.items()
        },
        "perFault": {fault: {name: round(v, 3) for name, v in by_mode.items()} for fault, by_mode in per_fault.items()},
    }
    write_metrics(payload)
    (ROOT / "EVALUATION.md").write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
