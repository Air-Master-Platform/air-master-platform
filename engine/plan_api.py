"""
JSON bridge between the Node platform and the CargoFlow engine.

Usage (the platform spawns this and pipes JSON on stdin):
    python engine/plan_api.py  < request.json  > response.json

Request JSON:
    {
      "family": "PMC" | "PAG",          # optional, default "PMC"
      "boxes": [
        {"id": "BOX1", "length": 120, "width": 100, "height": 80, "weight": 500},
        ...
      ]
    }

Response JSON (stdout, single line):
    {
      "ok": bool,
      "status": "OK" | "NO_PALLETS" | "INFEASIBLE" | "REVALIDATION_FAILED" | "ERROR",
      "family": "PMC",
      "positions": [ {"id","type","limit","load","pallet"} , ... ],   # for the deck canvas
      "pallets":   [ {"id","weight","height","position","boxes":[...]} , ... ],
      "cg":        {"arm","target","fwd_limit","aft_limit","fwd_margin","aft_margin"},
      "validation":{"ok": bool, "violations": [...]},
      "rejected":  [ {"id","dims","weight","reason"} , ... ],
      "totals":    {"manifest_weight","packed_weight","payload_limit","pallets_built","positions_used"},
      "runtime_s": float,
      "error": str | null
    }

IMPORTANT: only JSON is written to stdout. The engine's own console output is
suppressed (balance_aircraft is called with verbose=False) so stdout stays clean.
"""
import sys
import os
import json
import time

# Make sibling engine modules importable regardless of caller cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from grid_25d import Box
from stacker import build_up_pallets
from balancer import balance_aircraft
from revalidator import revalidate
from aircraft_config import B737_800SF_Config


def _err(status, message):
    return {
        "ok": False, "status": status, "error": message,
        "positions": [], "pallets": [], "cg": None,
        "validation": {"ok": False, "violations": [message]},
        "rejected": [], "totals": {}, "runtime_s": 0.0,
    }


def build_plan(payload: dict) -> dict:
    t0 = time.time()
    family = (payload.get("family") or "PMC").upper()
    if family not in ("PMC", "PAG"):
        return _err("ERROR", f"Unknown family '{family}' (expected PMC or PAG)")

    raw_boxes = payload.get("boxes") or []
    if not raw_boxes:
        return _err("ERROR", "No boxes supplied")

    config = B737_800SF_Config()
    limits = config.pmc_limits_kg if family == "PMC" else config.pag_limits_kg

    # Parse boxes (pydantic validates types / positivity downstream).
    try:
        manifest = []
        for i, b in enumerate(raw_boxes):
            manifest.append(Box(
                id=str(b.get("id") or f"BOX_{i+1}"),
                length=int(b["length"]), width=int(b["width"]),
                height=int(b["height"]), weight=int(b["weight"]),
            ))
    except (KeyError, ValueError, TypeError) as exc:
        return _err("ERROR", f"Invalid box data: {exc}")

    manifest_weight = sum(b.weight for b in manifest)

    # --- Puzzle A: build-up ---
    pallets, unplaced = build_up_pallets(manifest, config, family=family, is_aft=True)
    rejected = [{
        "id": box.id,
        "dims": f"{box.length}x{box.width}x{box.height}",
        "weight": box.weight,
        "reason": reason,
    } for box, reason in unplaced]

    packed_weight = sum(p.current_gross_weight for p in pallets)

    def positions_payload(assignment):
        pos_to_pallet = {pos: pid for pid, pos in assignment.items()}
        pid_to_pallet = {p.id: p for p in pallets}
        out = []
        for pos, limit in limits.items():
            ptype = "AKE/PKC" if pos == "P12" else family
            pid = pos_to_pallet.get(pos)
            load = pid_to_pallet[pid].current_gross_weight if pid else 0
            out.append({"id": pos, "type": ptype, "limit": limit, "load": load, "pallet": pid})
        return out

    if not pallets:
        r = _err("NO_PALLETS", "No pallets could be built from the manifest")
        r["family"] = family
        r["positions"] = positions_payload({})
        r["rejected"] = rejected
        r["totals"] = {"manifest_weight": manifest_weight, "packed_weight": 0,
                       "payload_limit": config.total_payload_kg, "pallets_built": 0, "positions_used": 0}
        r["runtime_s"] = round(time.time() - t0, 3)
        return r

    # --- Puzzle B: balance (quiet, so stdout stays pure JSON) ---
    assignment = balance_aircraft(pallets, config, family=family, verbose=False)

    pallets_payload = [{
        "id": p.id,
        "weight": p.current_gross_weight,
        "height": p.max_height_used,
        "position": assignment.get(p.id),
        "boxes": [pb.box.id for pb in p.placed_boxes],
    } for p in pallets]

    base_totals = {
        "manifest_weight": manifest_weight,
        "packed_weight": packed_weight,
        "payload_limit": config.total_payload_kg,
        "pallets_built": len(pallets),
        "positions_used": len(assignment),
    }

    if not assignment:
        return {
            "ok": False, "status": "INFEASIBLE", "error": None, "family": family,
            "positions": positions_payload({}), "pallets": pallets_payload,
            "cg": None, "validation": {"ok": False, "violations": ["No legal balance found"]},
            "rejected": rejected, "totals": base_totals, "runtime_s": round(time.time() - t0, 3),
        }

    # --- Independent re-validation (authoritative pass/fail + CG) ---
    report = revalidate(pallets, assignment, config, family=family)
    cg = {
        "arm": round(report.cg_arm_in, 2),
        "target": config.target_cg_arm_in,
        "fwd_limit": config.cg_fwd_limit_in,
        "aft_limit": config.cg_aft_limit_in,
        "fwd_margin": round(report.cg_fwd_margin_in, 1),
        "aft_margin": round(report.cg_aft_margin_in, 1),
    }
    status = "OK" if report.ok else "REVALIDATION_FAILED"
    return {
        "ok": report.ok, "status": status, "error": None, "family": family,
        "positions": positions_payload(assignment), "pallets": pallets_payload,
        "cg": cg, "validation": {"ok": report.ok, "violations": report.violations},
        "rejected": rejected, "totals": base_totals, "runtime_s": round(time.time() - t0, 3),
    }


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        sys.stdout.write(json.dumps(_err("ERROR", f"Invalid JSON request: {exc}")))
        return
    try:
        result = build_plan(payload)
    except Exception as exc:  # never crash the bridge; report as JSON
        result = _err("ERROR", f"{type(exc).__name__}: {exc}")
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
