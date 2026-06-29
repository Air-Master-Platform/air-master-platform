# CargoFlow Core Engine ✈️📦

CargoFlow is an advanced, two-stage mathematical optimization engine designed to automate the loading of cargo aircraft. It adheres strictly to physical door envelope dimensions, 3D fuselage contours, and complex position-based weight limits.

## 🏗️ Architecture

The engine solves the aircraft loading problem by breaking it into two distinct puzzles:

### 1. Puzzle A: The 3D Stacker (`stacker.py` & `grid_25d.py`)
This is a heuristic 2.5D Bin Packing algorithm. It takes a manifest of individual boxes and builds them into ULD Pallets (PMC or PAG).
- **Physical Constraints:** It cross-references every box against the aircraft's Door Envelope matrices (loaded from CSVs) to ensure it can physically enter the aircraft.
- **Contour Constraints:** It builds the pallet row-by-row, ensuring the height and width never exceed the curved ceiling of the fuselage.
- **Weight-Bin Awareness:** It dynamically monitors how many "Heavy", "Medium", and "Light" positions exist on the aircraft. If the aircraft only has two 3,600kg positions, the stacker will refuse to build a third pallet over 2,948kg, preventing unsolvable balance scenarios later.

### 2. Puzzle B: The CP-SAT Balancer (`balancer.py`)
Once the pallets are built, they must be safely assigned to physical locks on the main deck. 
- **Constraint Programming:** It uses Google OR-Tools (CP-SAT solver) to find a mathematically valid map of Pallet -> Position.
- **Strict Weight Limits:** It ensures no position exceeds its maximum structural weight limit.
- **Total Payload / MZFW / MTOW:** Validated as fast pre-checks before solving, with a clear reason on rejection.
- **Cumulative Load Limits:** The fore/aft running-total caps from the WBM — the certified CG-protection backbone — are enforced exactly.
- **CG Optimization:** The objective minimises the loaded CG's deviation from the trim target, expressed as the *moment about the target* and bounded with two linear inequalities (presolve-safe; avoids the `AddAbsEquality` blow-up on dense loads). A configurable CG envelope `[cg_fwd_limit_in, cg_aft_limit_in]` is enforced as a hard secondary guard.
- **Robustness:** The solver runs under a wall-clock and a memory limit and never crashes the host — a pathological instance degrades to "no plan found".

### 3. The Independent Re-validator (`revalidator.py`)
Every plan the solver claims is legal is re-checked from scratch by `revalidate(...)`, which re-derives each hard rule (weights, cumulative limits, height, door, crew aisle, contour, low-TOW centering, weight envelopes, and CG) independently and reports pass/fail plus the CG and its margins. The solver proposes; the re-validator disposes.

---

## ⚙️ Configuration & Data (`aircraft_config.py`)

CargoFlow is designed to be 100% data-driven and aircraft-agnostic. 

Instead of hardcoding rules, the engine expects an `AircraftConfig` object. Currently, it implements the `B737_800SF_Config` which reads directly from strict CSV lookup tables located in the `data/` directory:

- `data/b737_800sf_door_fwd.csv` (Forward Door Envelope Matrix)
- `data/b737_800sf_door_aft.csv` (AFT Door Envelope Matrix)
- `data/b737_800sf_pmc_limits.csv` (PMC Position Weight Limits)
- `data/b737_800sf_pag_limits.csv` (PAG Position Weight Limits)

### Adding a New Aircraft (e.g., Boeing 777F)
To add a new aircraft, you do **not** need to touch the core math algorithms.
1. Export the 777F's door and weight tables to CSVs in the `data/` folder.
2. Create a new class in `aircraft_config.py` (e.g., `class B777F_Config(AircraftConfig):`).
3. Pass that new config object into the `build_up_pallets` and `balance_aircraft` functions.

---

## 🧪 Testing

The engine comes with a robust test suite (`main.py`) that tests 5 core integration scenarios (Light Load, Heavy Industrial, Oversized Rejections, Full Flight Simulation, and PAG Family switching).

Additionally, `stress_test.py` pushes the Python engine to its computational limits, testing scenarios like High-Volume E-commerce (200+ items), extreme weight overloads, and geometrically impossible cargo.

## 🚀 Known Limitations & Future Roadmap

CG optimization, the 35 cm crew-aisle clearance, the cumulative load curve, the CG-envelope guard, and the independent re-validator are all **implemented**. Remaining items to address before operational use:
1. **Certified CG envelope:** The provided manuals do not publish an explicit %MAC fwd/aft CG envelope, so `cg_fwd_limit_in` / `cg_aft_limit_in` ship as a generous *operational guard* around the trim target. The certified CG protection is the cumulative load curve (enforced exactly); replace the guard window with the operator's AFM-certified envelope when available.
2. **Empty-CG provenance:** `owe_arm_in` (the Basic Empty Weight's balance arm) and `target_cg_arm_in` are operational placeholders — the BEW *weight* is certified, but its arm is not published here. Override both from the specific tail's weight record (LIR/AFM) for revenue flights.
3. **Greedy stacker:** The build-up heuristic is not guaranteed optimal; a different pallet build can occasionally make an otherwise-solvable balance infeasible.
