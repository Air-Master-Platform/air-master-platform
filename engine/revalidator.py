"""
Independent re-validator.

Re-checks a final (pallets + assignment) loading plan against every hard rule, deriving
each limit from scratch rather than trusting the solver that produced the plan. This is
the safety backstop required by the engineering blueprint: the solver is the author, the
re-validator is the independent judge.

Usage:
    report = revalidate(pallets, assignment, config, family)
    if not report.ok: ...   # report.violations lists every breached rule
"""
from dataclasses import dataclass, field
from typing import List, Dict
from stacker import Pallet
from aircraft_config import AircraftConfig
from grid_25d import is_door_compatible
from balancer import CENTER_POSITIONS, FWD_POSITIONS, _is_height_restricted


@dataclass
class ValidationReport:
    ok: bool = True
    violations: List[str] = field(default_factory=list)
    total_weight_kg: int = 0
    cg_arm_in: float = 0.0
    cg_fwd_margin_in: float = 0.0
    cg_aft_margin_in: float = 0.0

    def fail(self, msg: str):
        self.ok = False
        self.violations.append(msg)


def revalidate(pallets: List[Pallet], assignment: Dict[str, str],
               config: AircraftConfig, family: str = "PMC") -> ValidationReport:
    r = ValidationReport()
    limits = config.pmc_limits_kg if family == "PMC" else config.pag_limits_kg
    by_id = {p.id: p for p in pallets}

    # 1. Structural assignment integrity -------------------------------------------------
    if len(assignment) != len(pallets):
        r.fail(f"Assignment covers {len(assignment)}/{len(pallets)} pallets")
    used = {}
    for pid, pos in assignment.items():
        if pid not in by_id:
            r.fail(f"Unknown pallet {pid} in assignment")
        if pos not in limits:
            r.fail(f"Pallet {pid} assigned to unknown position {pos}")
        used.setdefault(pos, []).append(pid)
    for pos, pids in used.items():
        if len(pids) > 1:
            r.fail(f"Position {pos} double-booked by {pids}")

    # 2. Family consistency --------------------------------------------------------------
    for p in pallets:
        if p.family != family:
            r.fail(f"Pallet {p.id} family {p.family} != flight family {family}")

    # 3. Per-position weight, height, door, aisle, contour -------------------------------
    for pid, pos in assignment.items():
        p = by_id.get(pid)
        if p is None:
            continue
        w = p.current_gross_weight
        if w > limits.get(pos, 0):
            r.fail(f"{pid} {w} KG exceeds {pos} limit {limits.get(pos)} KG")

        if _is_height_restricted(pos, family) and p.max_height_used > 162:
            r.fail(f"{pid} height {p.max_height_used} cm exceeds 162 cm ceiling at {pos}")
        if p.max_height_used > 200:
            r.fail(f"{pid} height {p.max_height_used} cm exceeds absolute 200 cm")

        is_aft = pos not in FWD_POSITIONS
        for pb in p.placed_boxes:
            if not is_door_compatible(pb.box, config, is_aft=True):
                r.fail(f"{pid} box {pb.box.id} cannot pass AFT door")
            if not is_aft and not is_door_compatible(pb.box, config, is_aft=False):
                r.fail(f"{pid} box {pb.box.id} cannot pass FWD door (required for {pos})")

        is_center = pos in CENTER_POSITIONS
        if is_center and p.max_height_used > 150 and any(pb.x < 35 for pb in p.placed_boxes):
            r.fail(f"{pid} violates 35 cm crew aisle at centre position {pos}")

        for pb in p.placed_boxes:
            z_top = pb.z + pb.rotation[2]
            x_min, x_max = config.get_allowed_x_range(z_top, is_center_position=is_center)
            if pb.x < x_min or (pb.x + pb.rotation[0]) > x_max:
                r.fail(f"{pid} box {pb.box.id} breaches contour at {pos} "
                       f"(x {pb.x}-{pb.x + pb.rotation[0]} vs allowed {x_min}-{x_max})")

    # 4. Cumulative load limits ----------------------------------------------------------
    pos_weight = {pos: by_id[pid].current_gross_weight for pid, pos in assignment.items() if pid in by_id}
    for pos_list, limit in config.get_cumulative_fwd_limits(family) + config.get_cumulative_aft_limits(family):
        s = sum(pos_weight.get(pos, 0) for pos in pos_list)
        if s > limit:
            r.fail(f"Cumulative {pos_list} = {s} KG exceeds {limit} KG")

    # 5. Aircraft weight envelopes -------------------------------------------------------
    total_cargo = sum(p.current_gross_weight for p in pallets)
    zfw = config.owe_weight_kg + total_cargo
    tow = zfw + config.assumed_fuel_weight_kg
    r.total_weight_kg = zfw
    if total_cargo > config.total_payload_kg:
        r.fail(f"Cargo {total_cargo} KG exceeds payload {config.total_payload_kg} KG")
    if zfw > config.mzfw_kg:
        r.fail(f"ZFW {zfw} KG exceeds MZFW {config.mzfw_kg} KG")
    if tow > config.mtow_kg:
        r.fail(f"TOW {tow} KG exceeds MTOW {config.mtow_kg} KG")

    # 6. Low-takeoff-weight centering ----------------------------------------------------
    if tow < config.takeoff_weight_threshold_kg:
        allowed = set(config.get_low_weight_allowed_positions(family))
        for pid, pos in assignment.items():
            if pos not in allowed:
                r.fail(f"Low-TOW rule: {pid} at {pos} not in {sorted(allowed)}")

    # 7. CG envelope (independent recompute) ---------------------------------------------
    moment = config.owe_weight_kg * config.owe_arm_in
    for pid, pos in assignment.items():
        if pid in by_id:
            moment += by_id[pid].current_gross_weight * config.get_position_arm(pos, family)
    if zfw > 0:
        cg = moment / zfw
        r.cg_arm_in = cg
        r.cg_fwd_margin_in = cg - config.cg_fwd_limit_in
        r.cg_aft_margin_in = config.cg_aft_limit_in - cg
        if cg < config.cg_fwd_limit_in:
            r.fail(f"CG {cg:.2f} in forward of limit {config.cg_fwd_limit_in:.2f} in")
        if cg > config.cg_aft_limit_in:
            r.fail(f"CG {cg:.2f} in aft of limit {config.cg_aft_limit_in:.2f} in")

    return r
