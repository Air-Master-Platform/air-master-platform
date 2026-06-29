import time
import random
import sys
from grid_25d import Box
from stacker import build_up_pallets
from balancer import balance_aircraft
from revalidator import revalidate
from aircraft_config import B737_800SF_Config

def print_header(title: str):
    print(f"\n{'='*80}")
    print(f"  STRESS TEST: {title}")
    print(f"{'='*80}")

def generate_random_manifest(num_boxes: int, min_dim: int, max_dim: int, min_weight: int, max_weight: int) -> list:
    manifest = []
    for i in range(num_boxes):
        l = random.randint(min_dim, max_dim)
        w = random.randint(min_dim, max_dim)
        h = random.randint(min_dim, max_dim)
        weight = random.randint(min_weight, max_weight)
        manifest.append(Box(id=f"RND_{i}", length=l, width=w, height=h, weight=weight))
    return manifest

def run_stress_scenario(scenario_name: str, manifest: list, family: str = "PMC") -> bool:
    """Returns True if the scenario completed without any crash. INFEASIBLE is a valid
    (non-crash) outcome for overloaded/impossible loads."""
    print_header(scenario_name)
    config = B737_800SF_Config()

    total_weight = sum(b.weight for b in manifest)
    print(f"  -> Generated {len(manifest)} boxes.")
    print(f"  -> Total Manifest Weight: {total_weight} KG")
    print(f"  -> Aircraft Limit: {config.total_payload_kg} KG")

    # 1. Stacker
    print(f"\n  [PHASE 1] Running 3D Stacker...")
    start_time = time.time()
    try:
        pallets, unplaced = build_up_pallets(manifest, config, family=family, is_aft=True)
        stacker_time = time.time() - start_time
    except Exception as e:
        print(f"  [ERROR] Stacker crashed: {e}")
        return False

    packed_weight = sum(p.current_gross_weight for p in pallets)
    print(f"  -> Stacker Finished in {stacker_time:.4f} seconds.")
    print(f"  -> Built {len(pallets)} Pallets.")
    print(f"  -> Packed Weight: {packed_weight} KG")
    print(f"  -> Rejected Items: {len(unplaced)}")

    if len(pallets) == 0:
        print("  -> No pallets built. Cannot balance (valid outcome for impossible cargo).")
        return True

    # 2. Balancer
    print(f"\n  [PHASE 2] Running CP-SAT Balancer...")
    start_time = time.time()
    try:
        assignment = balance_aircraft(pallets, config, family=family)
        balancer_time = time.time() - start_time
    except Exception as e:
        print(f"  [ERROR] Balancer crashed: {e}")
        return False

    print(f"  -> Balancer Finished in {balancer_time:.4f} seconds.")
    if not assignment:
        print("  -> INFEASIBLE: No legal balance found (valid if overloaded).")
        return True

    # 3. Independent re-validation of any plan the solver claims is legal.
    report = revalidate(pallets, assignment, config, family=family)
    if report.ok:
        print(f"  -> SUCCESS: Legal balance, re-validated. CG {report.cg_arm_in:.2f} in.")
        return True
    print(f"  -> [CRITICAL] Solver returned a plan the re-validator REJECTED:")
    for v in report.violations:
        print(f"        - {v}")
    return False

if __name__ == "__main__":
    random.seed(42) # For reproducible stress tests
    results = []

    mani_ecommerce = generate_random_manifest(200, 20, 50, 5, 15)
    results.append(run_stress_scenario("E-Commerce Nightmare (200 small items)", mani_ecommerce))

    mani_heavy = generate_random_manifest(30, 80, 150, 500, 1200)
    results.append(run_stress_scenario("Heavy Machinery (30 dense items)", mani_heavy))

    mani_impossible = generate_random_manifest(50, 200, 400, 100, 500)
    results.append(run_stress_scenario("Impossible Cargo (Oversized)", mani_impossible))

    mani_perfect = generate_random_manifest(150, 40, 100, 100, 200)
    results.append(run_stress_scenario("Standard Load (150 normal items)", mani_perfect))

    print(f"\n{'='*80}")
    if all(results):
        print("  STRESS TESTS COMPLETED SUCCESSFULLY (no crashes, all plans re-validated).")
        sys.exit(0)
    else:
        print(f"  STRESS TESTS FAILED: {results.count(False)}/{len(results)} scenario(s) crashed or were rejected.")
        sys.exit(1)
