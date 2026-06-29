"""
Puzzle B - CP-SAT Balancer.

Assigns built-up pallets (from the Stacker) to physical main-deck positions so that
every hard limit is respected and the loaded Centre of Gravity (CG) is driven toward
the trim target.

Design notes
------------
* The OR-Tools CP-SAT solver is integer-only, so every balance arm (inches) is scaled
  by 100 and rounded to the nearest integer before entering the model.
* The CG objective is expressed as the *moment about the trim target* and its absolute
  value is modelled with two plain linear inequalities (dev >= +expr, dev >= -expr)
  rather than AddAbsEquality. The latter builds a LinMax constraint that, combined with
  the large moment coefficients, sends CP-SAT presolve into a runaway / out-of-memory
  state on dense real-world loads. The two-inequality form is presolve-friendly and
  solves the same problem.
* All structural weight envelopes (payload / MZFW / MTOW) are constant given the
  manifest, so they are validated as fast Python pre-checks instead of (degenerate)
  model constraints, returning a clear reason on failure.
"""
from typing import List, Dict, Optional
import sys
try:
    from ortools.sat.python import cp_model
except ImportError:
    print("OR-Tools is not installed.")
    sys.exit(1)

from stacker import Pallet
from aircraft_config import AircraftConfig
from grid_25d import is_door_compatible

CENTER_POSITIONS = ("A4", "A5", "A6", "A7", "A8", "A9", "M4", "M5", "M6", "M7", "M8", "M9")
FWD_POSITIONS = ("M1", "M2", "A1", "A2")
# Solver guards: a wall-clock limit AND a memory ceiling so a pathological instance
# degrades to "no plan found" instead of crashing the host process.
SOLVER_TIME_LIMIT_S = 10.0
SOLVER_MEMORY_LIMIT_MB = 4096


def _is_height_restricted(pos: str, family: str) -> bool:
    return pos == "P12" or (family == "PMC" and pos == "M10") or (family == "PAG" and pos == "A11")


def balance_aircraft(pallets: List[Pallet], config: AircraftConfig,
                     family: str = "PMC", verbose: bool = True) -> Dict[str, str]:
    """Return {pallet_id: position}. Empty dict means no legal/feasible plan."""
    position_limits = config.pmc_limits_kg if family == "PMC" else config.pag_limits_kg
    positions = list(position_limits.keys())

    # --- Structural weight envelope pre-checks (constant given the manifest) ---
    total_cargo_weight = sum(p.current_gross_weight for p in pallets)
    if total_cargo_weight > config.total_payload_kg:
        if verbose:
            print(f"     [REJECT] Cargo {total_cargo_weight} KG exceeds max payload {config.total_payload_kg} KG")
        return {}

    total_aircraft_weight = config.owe_weight_kg + total_cargo_weight  # Zero Fuel Weight
    estimated_tow = total_aircraft_weight + config.assumed_fuel_weight_kg
    if total_aircraft_weight > config.mzfw_kg:
        if verbose:
            print(f"     [REJECT] ZFW {total_aircraft_weight} KG exceeds MZFW {config.mzfw_kg} KG")
        return {}
    if estimated_tow > config.mtow_kg:
        if verbose:
            print(f"     [REJECT] Estimated TOW {estimated_tow} KG exceeds MTOW {config.mtow_kg} KG")
        return {}

    model = cp_model.CpModel()
    assign = {}

    # --- Decision variables + per-(pallet, position) physical feasibility ---
    for p_idx, pallet in enumerate(pallets):
        is_tall = pallet.max_height_used > 162
        for pos in positions:
            var = model.NewBoolVar(f"assign_p{p_idx}_{pos}")
            assign[(p_idx, pos)] = var

            # Ceiling height limit (162 cm) for P12 / M10 / A11.
            if _is_height_restricted(pos, family) and is_tall:
                model.Add(var == 0)
                continue

            # Physical door clearance for the two FWD positions (tighter turn radius).
            if pos in FWD_POSITIONS and any(
                not is_door_compatible(pb.box, config, is_aft=False) for pb in pallet.placed_boxes
            ):
                model.Add(var == 0)
                continue

            is_center = pos in CENTER_POSITIONS

            # Crew-aisle: a >150 cm pallet must keep 35 cm clear on one side in a centre slot.
            if is_center and pallet.max_height_used > 150 and any(pb.x < 35 for pb in pallet.placed_boxes):
                model.Add(var == 0)
                continue

            # Asymmetric fuselage contour check for every box in this pallet.
            contour_ok = True
            for pb in pallet.placed_boxes:
                box_z_top = pb.z + pb.rotation[2]
                x_min_allowed, x_max_allowed = config.get_allowed_x_range(box_z_top, is_center_position=is_center)
                if pb.x < x_min_allowed or (pb.x + pb.rotation[0]) > x_max_allowed:
                    contour_ok = False
                    break
            if not contour_ok:
                model.Add(var == 0)

    # --- Assignment structure: every pallet placed once, every position used at most once ---
    for p_idx in range(len(pallets)):
        model.AddExactlyOne([assign[(p_idx, pos)] for pos in positions])
    for pos in positions:
        model.AddAtMostOne([assign[(p_idx, pos)] for p_idx in range(len(pallets))])

    # --- Per-position structural weight limit ---
    for pos in positions:
        model.Add(
            sum(assign[(p_idx, pos)] * pallet.current_gross_weight
                for p_idx, pallet in enumerate(pallets)) <= position_limits[pos]
        )

    # --- Low-takeoff-weight centering rule (manual: only M5-M7 / A5-A7 below 50,802 KG) ---
    if estimated_tow < config.takeoff_weight_threshold_kg:
        allowed = set(config.get_low_weight_allowed_positions(family))
        for p_idx in range(len(pallets)):
            for pos in positions:
                if pos not in allowed:
                    model.Add(assign[(p_idx, pos)] == 0)

    # --- Cumulative load limits (FWD and AFT) - the certified CG-safety backbone ---
    for pos_list, limit in config.get_cumulative_fwd_limits(family) + config.get_cumulative_aft_limits(family):
        model.Add(
            sum(assign[(p_idx, pos)] * pallet.current_gross_weight
                for p_idx, pallet in enumerate(pallets)
                for pos in pos_list if pos in positions) <= limit
        )

    # --- CG moment model (all arms scaled x100 to integers) ---
    target_scaled = round(config.target_cg_arm_in * 100)
    owe_arm_scaled = round(config.owe_arm_in * 100)
    pos_arm_scaled = {pos: round(config.get_position_arm(pos, family) * 100) for pos in positions}

    # owe_moment + cargo_moment = total moment (scaled). W is constant (all pallets placed).
    owe_moment = config.owe_weight_kg * owe_arm_scaled
    cargo_moment = sum(assign[(p_idx, pos)] * pallet.current_gross_weight * pos_arm_scaled[pos]
                       for p_idx, pallet in enumerate(pallets) for pos in positions)
    total_moment = owe_moment + cargo_moment

    # --- CG envelope (secondary gross-error guard; cumulative limits are the certified one) ---
    # fwd_limit <= CG <= aft_limit  <=>  fwd_limit*W <= total_moment <= aft_limit*W
    model.Add(total_moment >= round(config.cg_fwd_limit_in * 100) * total_aircraft_weight)
    model.Add(total_moment <= round(config.cg_aft_limit_in * 100) * total_aircraft_weight)

    # --- Objective: minimise |moment about the trim target| (centred coefficients) ---
    # deviation_moment = total_moment - target_arm * W. Modelled with two inequalities.
    target_moment = target_scaled * total_aircraft_weight
    dev_bound = total_aircraft_weight * (max(target_scaled,
                                             max(pos_arm_scaled.values())) - min(pos_arm_scaled.values()) + 1)
    deviation = model.NewIntVar(0, dev_bound, "cg_deviation")
    model.Add(deviation >= total_moment - target_moment)
    model.Add(deviation >= target_moment - total_moment)
    model.Minimize(deviation)

    # --- Solve (guarded) ---
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT_S
    solver.parameters.max_memory_in_mb = SOLVER_MEMORY_LIMIT_MB
    solver.parameters.num_search_workers = 8
    try:
        status = solver.Solve(model)
    except Exception as exc:  # pragma: no cover - defensive: never crash the host
        if verbose:
            print(f"     [SOLVER ERROR] {type(exc).__name__}: {exc}")
        return {}

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if verbose:
            print(f"     [INFEASIBLE] No legal balance ({solver.StatusName(status)}).")
        return {}

    final_cg_arm = solver.Value(total_moment) / 100.0 / total_aircraft_weight
    if verbose:
        tag = "OPTIMAL" if status == cp_model.OPTIMAL else "feasible"
        print(f"     [CG Optimization] Target {config.target_cg_arm_in:.1f} in  |  "
              f"Actual {final_cg_arm:.2f} in  |  Envelope [{config.cg_fwd_limit_in:.0f}, "
              f"{config.cg_aft_limit_in:.0f}] in  ({tag})")

    assignment_map = {}
    for p_idx, pallet in enumerate(pallets):
        for pos in positions:
            if solver.Value(assign[(p_idx, pos)]) == 1:
                assignment_map[pallet.id] = pos
    return assignment_map
