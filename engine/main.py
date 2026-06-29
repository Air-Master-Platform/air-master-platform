"""
CargoFlow Engine - Comprehensive Test Suite
Tests the full pipeline: Stacker (3D Geometry) -> Balancer (OR-Tools Weight & Balance)
Uses realistic cargo data matching the Egyptair B737-800SF constraints.
"""
from grid_25d import Box
from stacker import build_up_pallets
from balancer import balance_aircraft
from revalidator import revalidate
from aircraft_config import B737_800SF_Config

def print_separator(title: str):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

def run_test(test_name: str, manifest: list, family: str = "PMC", expect_all_placed: bool = True):
    print_separator(test_name)
    
    config = B737_800SF_Config()
    limits = config.pmc_limits_kg if family == "PMC" else config.pag_limits_kg
    positions = [p for p in limits.keys() if p != "P12"]
    num_main_positions = len(positions)
    
    total_manifest_weight = sum(b.weight for b in manifest)
    print(f"  Aircraft Config: {config.name}")
    print(f"  Family: {family}")
    print(f"  Manifest: {len(manifest)} boxes, Total Weight: {total_manifest_weight} KG")
    print(f"  Aircraft Max Payload: {config.total_payload_kg} KG")
    print(f"  Available Main Deck Positions: {num_main_positions} + P12")
    
    # --- PUZZLE A: STACKER ---
    print(f"\n  [PUZZLE A] Running 3D Stacker...")
    pallets, unplaced = build_up_pallets(manifest, config, family=family, is_aft=True)
    
    print(f"  -> Built {len(pallets)} pallets:")
    total_packed_weight = 0
    for p in pallets:
        total_packed_weight += p.current_gross_weight
        box_ids = [pb.box.id for pb in p.placed_boxes]
        print(f"     {p.id}: {len(p.placed_boxes)} boxes, {p.current_gross_weight} KG  [{', '.join(box_ids)}]")
    
    if unplaced:
        print(f"  -> {len(unplaced)} items rejected:")
        for item, reason in unplaced:
            print(f"     {item.id} ({item.length}x{item.width}x{item.height}, {item.weight}kg): {reason}")
        if expect_all_placed:
            print(f"\n  RESULT: FAILED. {len(unplaced)} items were rejected, but all were expected to be placed.")
            return False
    
    if len(pallets) == 0:
        print(f"\n  RESULT: NO PALLETS BUILT. Cannot proceed to Balancer.")
        return False
    
    # --- PUZZLE B: BALANCER ---
    print(f"\n  [PUZZLE B] Running OR-Tools Balancer...")
    assignment = balance_aircraft(pallets, config, family=family)
    
    if assignment:
        print(f"  -> SUCCESS! Legal aircraft loading plan found:\n")
        print(f"     {'POSITION':<10} {'LIMIT (KG)':<12} {'PALLET':<12} {'WEIGHT (KG)':<12} {'MARGIN (KG)':<12}")
        print(f"     {'-'*58}")
        
        pos_to_pallet = {}
        for pallet_id, pos in assignment.items():
            pos_to_pallet[pos] = pallet_id
            
        for pos in sorted(limits.keys()):
            limit = limits[pos]
            if pos in pos_to_pallet:
                pid = pos_to_pallet[pos]
                pallet = next(p for p in pallets if p.id == pid)
                w = pallet.current_gross_weight
                margin = limit - w
                print(f"     {pos:<10} {limit:<12} {pid:<12} {w:<12} {margin:<12}")
            else:
                print(f"     {pos:<10} {limit:<12} {'(empty)':<12} {'-':<12} {'-':<12}")
        
        print(f"\n     Total Loaded: {total_packed_weight} KG / {config.total_payload_kg} KG")

        # Independent re-validation: the solver proposes, the re-validator disposes.
        report = revalidate(pallets, assignment, config, family=family)
        if report.ok:
            print(f"     [RE-VALIDATOR] PASS  |  CG {report.cg_arm_in:.2f} in  "
                  f"(margins fwd {report.cg_fwd_margin_in:+.1f} / aft {report.cg_aft_margin_in:+.1f} in)")
            return True
        print(f"     [RE-VALIDATOR] FAIL - plan rejected by independent check:")
        for v in report.violations:
            print(f"        - {v}")
        return False
    else:
        print(f"  -> FAILED: OR-Tools could not find a legal balance.")
        return False


# =====================================================================
#  TEST 1: Light Mixed Cargo (Should PASS easily)
# =====================================================================
test1_manifest = [
    Box(id="SmallBox_1",  length=80,  width=60,  height=50,  weight=200),
    Box(id="SmallBox_2",  length=80,  width=60,  height=50,  weight=200),
    Box(id="SmallBox_3",  length=80,  width=60,  height=50,  weight=200),
    Box(id="SmallBox_4",  length=80,  width=60,  height=50,  weight=200),
    Box(id="MedBox_1",    length=120, width=100, height=80,  weight=500),
    Box(id="MedBox_2",    length=120, width=100, height=80,  weight=500),
    Box(id="MedBox_3",    length=120, width=100, height=80,  weight=500),
    Box(id="MedBox_4",    length=120, width=100, height=80,  weight=500),
    Box(id="MedBox_5",    length=120, width=100, height=80,  weight=500),
    Box(id="MedBox_6",    length=120, width=100, height=80,  weight=500),
]

# =====================================================================
#  TEST 2: Heavy Industrial Cargo (Tests position limit enforcement)
#  Each pallet stays under 2948 KG so all positions can accept them.
# =====================================================================
test2_manifest = [
    Box(id="Engine_A",    length=150, width=120, height=80,  weight=2500),
    Box(id="Engine_B",    length=150, width=120, height=80,  weight=2500),
    Box(id="Engine_C",    length=150, width=120, height=80,  weight=2500),
    Box(id="Engine_D",    length=150, width=120, height=80,  weight=2500),
    Box(id="Engine_E",    length=150, width=120, height=80,  weight=2500),
    Box(id="Pump_A",      length=80,  width=60,  height=60,  weight=400),
    Box(id="Pump_B",      length=80,  width=60,  height=60,  weight=400),
    Box(id="Pump_C",      length=80,  width=60,  height=60,  weight=400),
    Box(id="Pump_D",      length=80,  width=60,  height=60,  weight=400),
    Box(id="Pump_E",      length=80,  width=60,  height=60,  weight=400),
    Box(id="Spare_1",     length=60,  width=50,  height=40,  weight=100),
    Box(id="Spare_2",     length=60,  width=50,  height=40,  weight=100),
    Box(id="Spare_3",     length=60,  width=50,  height=40,  weight=100),
    Box(id="Spare_4",     length=60,  width=50,  height=40,  weight=100),
    Box(id="Spare_5",     length=60,  width=50,  height=40,  weight=100),
]

# =====================================================================
#  TEST 3: Oversized Cargo (Tests door envelope & contour rejection)
#  Includes items that are too long/wide/tall for the aircraft.
# =====================================================================
test3_manifest = [
    Box(id="Container_OK",    length=250, width=200, height=80,  weight=1800),
    Box(id="LongPipe_REJECT", length=600, width=30,  height=30,  weight=300),  # 600cm > 318cm pallet base!
    Box(id="TallCrate_EDGE",  length=100, width=100, height=195, weight=800),  # Very close to 200cm max
    Box(id="WideCrate_OK",    length=100, width=230, height=60,  weight=600),
    Box(id="NormalBox_1",     length=80,  width=60,  height=50,  weight=200),
    Box(id="NormalBox_2",     length=80,  width=60,  height=50,  weight=200),
]

# =====================================================================
#  TEST 4: Full Flight Simulation (11 pallets worth of cargo)
#  Designed to fill all 10 main deck PMC positions + P12.
#  Each "group" of boxes is designed to build one pallet under limits.
# =====================================================================
test4_manifest = []
# Generate 11 groups of boxes, each group ~2000-2400 KG
for group in range(11):
    if group < 10:
        # Main deck pallets: stay under 2494 KG (M1/M10 limit)
        test4_manifest.append(Box(id=f"G{group+1}_HeavyA", length=150, width=120, height=80, weight=800))
        test4_manifest.append(Box(id=f"G{group+1}_HeavyB", length=150, width=120, height=80, weight=800))
        test4_manifest.append(Box(id=f"G{group+1}_LightA", length=80,  width=60,  height=50, weight=200))
        test4_manifest.append(Box(id=f"G{group+1}_LightB", length=80,  width=60,  height=50, weight=200))
    else:
        # P12 pallet: stay under 1133 KG
        test4_manifest.append(Box(id=f"G{group+1}_SmallA", length=60, width=50, height=40, weight=300))
        test4_manifest.append(Box(id=f"G{group+1}_SmallB", length=60, width=50, height=40, weight=300))
        test4_manifest.append(Box(id=f"G{group+1}_SmallC", length=60, width=50, height=40, weight=300))

# =====================================================================
#  TEST 5: PAG Family Test (Uses A1-A11 positions instead of M1-M10)
# =====================================================================
test5_manifest = [
    Box(id="PAG_Crate_1", length=100, width=100, height=80, weight=1500),
    Box(id="PAG_Crate_2", length=100, width=100, height=80, weight=1500),
    Box(id="PAG_Crate_3", length=100, width=100, height=80, weight=1500),
    Box(id="PAG_Crate_4", length=100, width=100, height=80, weight=1000),
    Box(id="PAG_Crate_5", length=100, width=100, height=80, weight=1000),
    Box(id="PAG_Small_1", length=60,  width=50,  height=40, weight=300),
    Box(id="PAG_Small_2", length=60,  width=50,  height=40, weight=300),
    Box(id="PAG_Small_3", length=60,  width=50,  height=40, weight=300),
]

# =====================================================================
#  TEST 6: Tetris Effect (Tests greedy sorting/placement failure)
#  Tiny boxes have larger footprint area than massive boxes, so they
#  are processed first and occupy high-capacity slots.
# =====================================================================
test6_manifest = [
    Box(id="TinyBox_1", length=200, width=150, height=50, weight=10),
    Box(id="TinyBox_2", length=200, width=150, height=50, weight=10),
    Box(id="MassiveBox_1", length=180, width=140, height=160, weight=3000),
    Box(id="MassiveBox_2", length=180, width=140, height=160, weight=3000),
    Box(id="NormalBox_1", length=100, width=100, height=100, weight=600),
    Box(id="NormalBox_2", length=100, width=100, height=100, weight=600),
]

# =====================================================================
#  TEST 7: P12 Height Limit
# =====================================================================
def run_test_7() -> bool:
    print_separator("TEST 7: P12 Height Limit (Expect INFEASIBLE)")
    config = B737_800SF_Config()
    from stacker import Pallet, PlacedBox
    
    pallets = []
    # 10 heavy pallets
    for i in range(10):
        pb = PlacedBox(
            box=Box(id=f"HeavyBox_{i}", length=100, width=100, height=100, weight=2000),
            x=100, y=0, z=0, rotation=(100, 100, 100)
        )
        pallets.append(Pallet(
            id=f"ULD_{i+1}", family="PMC", max_gross_weight=2494,
            base_length=318, base_width=244, placed_boxes=[pb],
            virtual_pos_name="M1", is_center=False, is_fwd=True, max_height_limit=200
        ))
    
    # 1 tall pallet (height 170 cm > 162 cm)
    pb_tall = PlacedBox(
        box=Box(id="TallBox", length=100, width=100, height=170, weight=1000),
        x=100, y=0, z=0, rotation=(100, 100, 170)
    )
    pallets.append(Pallet(
        id="ULD_11", family="PMC", max_gross_weight=1133,
        base_length=318, base_width=244, placed_boxes=[pb_tall],
        virtual_pos_name="P12", is_center=False, is_fwd=False, max_height_limit=162
    ))
    
    pallets.sort(key=lambda p: p.current_gross_weight, reverse=True)
    for i, p in enumerate(pallets):
        p.id = f"ULD_{i+1}"
        
    assignment = balance_aircraft(pallets, config, family="PMC")
    
    if not assignment:
        print("  -> SUCCESS: Balancer correctly returned INFEASIBLE due to P12 height limit!")
        return True
    else:
        print(f"  -> FAILURE: Balancer assigned tall pallet to P12: {assignment}")
        return False

def run_test_7_control() -> bool:
    print_separator("TEST 7 Control: P12 Height Limit (Under Limit, Expect PASS)")
    config = B737_800SF_Config()
    from stacker import Pallet, PlacedBox
    
    pallets = []
    # 10 heavy pallets
    for i in range(10):
        pb = PlacedBox(
            box=Box(id=f"HeavyBox_{i}", length=100, width=100, height=100, weight=2000),
            x=100, y=0, z=0, rotation=(100, 100, 100)
        )
        pallets.append(Pallet(
            id=f"ULD_{i+1}", family="PMC", max_gross_weight=2494,
            base_length=318, base_width=244, placed_boxes=[pb],
            virtual_pos_name="M1", is_center=False, is_fwd=True, max_height_limit=200
        ))
    
    # 1 tall pallet (height 160 cm <= 162 cm)
    pb_tall = PlacedBox(
        box=Box(id="TallBox", length=100, width=100, height=160, weight=1000),
        x=100, y=0, z=0, rotation=(100, 100, 160)
    )
    pallets.append(Pallet(
        id="ULD_11", family="PMC", max_gross_weight=1133,
        base_length=318, base_width=244, placed_boxes=[pb_tall],
        virtual_pos_name="P12", is_center=False, is_fwd=False, max_height_limit=162
    ))
    
    pallets.sort(key=lambda p: p.current_gross_weight, reverse=True)
    for i, p in enumerate(pallets):
        p.id = f"ULD_{i+1}"
        
    assignment = balance_aircraft(pallets, config, family="PMC")
    
    if assignment:
        print("  -> SUCCESS: Balancer found assignment when height is under limit!")
        return True
    else:
        print("  -> FAILURE: Balancer failed even when height is under limit!")
        return False

# =====================================================================
#  TEST 8: FWD Door Turn Limits
# =====================================================================
def run_test_8() -> bool:
    print_separator("TEST 8: FWD Door Turn Limits (Expect INFEASIBLE)")
    config = B737_800SF_Config()
    from stacker import Pallet, PlacedBox
    
    pallets = []
    # 10 pallets containing FWD-incompatible boxes (each weighing 1000 kg)
    for i in range(10):
        pb = PlacedBox(
            box=Box(id=f"FwdFailBox_{i}", length=600, width=40, height=190, weight=1000),
            x=100, y=0, z=0, rotation=(40, 600, 190)
        )
        pallets.append(Pallet(
            id=f"ULD_{i+1}", family="PMC", max_gross_weight=1133,
            base_length=318, base_width=244, placed_boxes=[pb],
            virtual_pos_name="M3", is_center=False, is_fwd=False, max_height_limit=200
        ))
        
    # 1 normal pallet weighing 1000 kg
    pb_norm = PlacedBox(
        box=Box(id="NormalBox", length=100, width=100, height=100, weight=1000),
        x=0, y=0, z=0, rotation=(100, 100, 100)
    )
    pallets.append(Pallet(
        id="ULD_11", family="PMC", max_gross_weight=1133,
        base_length=318, base_width=244, placed_boxes=[pb_norm],
        virtual_pos_name="M1", is_center=False, is_fwd=True, max_height_limit=200
    ))
    
    pallets.sort(key=lambda p: p.current_gross_weight, reverse=True)
    for i, p in enumerate(pallets):
        p.id = f"ULD_{i+1}"
        
    assignment = balance_aircraft(pallets, config, family="PMC")
    
    if not assignment:
        print("  -> SUCCESS: Balancer correctly returned INFEASIBLE because FWD-incompatible pallets exceeded AFT positions!")
        return True
    else:
        print(f"  -> FAILURE: Balancer found assignment for FWD-incompatible pallets: {assignment}")
        return False

def run_test_8_control() -> bool:
    print_separator("TEST 8 Control: FWD Door Turn Limits (7 incompatible, 4 normal, Expect PASS)")
    config = B737_800SF_Config()
    from stacker import Pallet, PlacedBox
    
    pallets = []
    # 7 pallets containing FWD-incompatible boxes (each weighing 1000 kg)
    for i in range(7):
        pb = PlacedBox(
            box=Box(id=f"FwdFailBox_{i}", length=600, width=40, height=190, weight=1000),
            x=100, y=40, z=0, rotation=(40, 600, 190)
        )
        pallets.append(Pallet(
            id=f"ULD_{i+1}", family="PMC", max_gross_weight=1133,
            base_length=318, base_width=244, placed_boxes=[pb],
            virtual_pos_name="M3", is_center=False, is_fwd=False, max_height_limit=200
        ))
        
    # 4 normal pallets weighing 1000 kg each
    for i in range(4):
        pb_norm = PlacedBox(
            box=Box(id=f"NormalBox_{i}", length=100, width=100, height=100, weight=1000),
            x=100, y=0, z=0, rotation=(100, 100, 100)
        )
        pallets.append(Pallet(
            id=f"ULD_norm_{i+1}", family="PMC", max_gross_weight=1133,
            base_length=318, base_width=244, placed_boxes=[pb_norm],
            virtual_pos_name="M1", is_center=False, is_fwd=True, max_height_limit=200
        ))
    
    pallets.sort(key=lambda p: p.current_gross_weight, reverse=True)
    for i, p in enumerate(pallets):
        p.id = f"ULD_{i+1}"
        
    assignment = balance_aircraft(pallets, config, family="PMC")
    
    if assignment:
        print("  -> SUCCESS: Balancer found assignment when 8 pallets are FWD-incompatible!")
        # Verify that FWD-incompatible pallets are not placed in M1 or M2
        invalid_placement = False
        for p in pallets:
            pos = assignment.get(p.id)
            if any(pb.box.id.startswith("FwdFailBox") for pb in p.placed_boxes) and pos in ("M1", "M2"):
                print(f"     BUT pallet {p.id} (FWD-incompatible) was assigned to FWD position {pos}! FAILURE.")
                invalid_placement = True
        
        if invalid_placement:
            return False
        else:
            print("     All FWD-incompatible pallets were correctly assigned to non-FWD positions.")
            return True
    else:
        print("  -> FAILURE: Balancer could not find assignment even though one was possible!")
        return False

# =====================================================================
#  TEST 9: Crew Aisle Constraint
# =====================================================================
def run_test_9() -> bool:
    print_separator("TEST 9: Crew Aisle Constraint (Expect FAIL - 1 Unplaced)")
    test9_manifest = []
    # 3 Base Boxes: 300x244x90 @ 1500kg. These take up the entire pallet footprint.
    # 3 Top Boxes: 100x100x70 @ 1000kg.
    # Together, a Base+Top combo weighs 2500kg and reaches 160cm tall.
    # Because they are 2500kg, they CANNOT fit in M1 or M10 (limit 2494kg).
    # Because they are 160cm tall and block the aisle (Base Box width=244), they CANNOT fit in center positions (M4-M9).
    # This leaves ONLY M2 and M3 (2 positions) that can take them!
    # Therefore, the 3rd Top Box will be rejected by the Stacker because no Virtual Position can legally accept it.
    for i in range(3):
        test9_manifest.append(Box(id=f"BaseBox_{i}", length=300, width=244, height=90, weight=1500))
        test9_manifest.append(Box(id=f"TopBox_{i}", length=100, width=100, height=70, weight=1000))
        
    return run_test("TEST 9: Crew Aisle Constraint (Expect 1 Unplaced)", test9_manifest, expect_all_placed=True)

def run_test_9_control() -> bool:
    print_separator("TEST 9 Control: Crew Aisle Constraint (2 combos, Expect PASS)")
    test9_control_manifest = []
    # Only 2 combos. These will perfectly fit into M2 and M3.
    for i in range(2):
        test9_control_manifest.append(Box(id=f"BaseBox_{i}", length=300, width=244, height=90, weight=1500))
        test9_control_manifest.append(Box(id=f"TopBox_{i}", length=100, width=100, height=70, weight=1000))
    # 4 normal boxes that can easily fit in the center positions without violating the aisle.
    for i in range(4):
        test9_control_manifest.append(Box(id=f"NormalBox_{i}", length=100, width=100, height=100, weight=1000))
        
    return run_test("TEST 9 Control: Crew Aisle Constraint (Expect PASS)", test9_control_manifest, expect_all_placed=True)

def run_test_10() -> bool:
    print_separator("TEST 10: Low Takeoff Weight (Expect PASS)")
    test10_manifest = []
    # Very light load: 3000 KG total.
    # TOW = 41413 (OWE) + 5000 (Fuel) + 3000 = 49413 < 50802 KG threshold.
    # Must be placed ONLY in M5, M6, M7.
    for i in range(3):
        test10_manifest.append(Box(id=f"LightBox_{i}", length=100, width=100, height=100, weight=1000))
        
    return run_test("TEST 10: Low Takeoff Weight", test10_manifest, expect_all_placed=True)

def run_test_11() -> bool:
    print_separator("TEST 11: Low Weight + Aisle Conflict (Expect INFEASIBLE)")
    config = B737_800SF_Config()
    from stacker import Pallet, PlacedBox
    
    pallets = []
    # Manually build 1 aisle-violating pallet (weight 2500 kg, height 160 cm, has_aisle_violation=True)
    pb_base = PlacedBox(
        box=Box(id="BaseBox_0", length=300, width=244, height=90, weight=1500),
        x=0, y=0, z=0, rotation=(300, 244, 90)
    )
    pb_top = PlacedBox(
        box=Box(id="TopBox_0", length=100, width=100, height=70, weight=1000),
        x=0, y=0, z=90, rotation=(100, 100, 70)
    )
    pallets.append(Pallet(
        id="ULD_1", family="PMC", max_gross_weight=3628,
        base_length=318, base_width=244, placed_boxes=[pb_base, pb_top],
        virtual_pos_name="M5", is_center=True, is_fwd=False, max_height_limit=200
    ))
    
    assignment = balance_aircraft(pallets, config, family="PMC")
    
    if not assignment:
        print("  -> SUCCESS: Balancer correctly returned INFEASIBLE due to Low Weight + Aisle Conflict!")
        return True
    else:
        print(f"  -> FAILURE: Balancer found a legal assignment: {assignment}")
        return False


# =====================================================================
#  RUN ALL TESTS
# =====================================================================
if __name__ == "__main__":
    results = {}
    
    results["Test 1: Light Mixed Cargo"]     = run_test("TEST 1: Light Mixed Cargo (Expect PASS)", test1_manifest)
    results["Test 2: Heavy Industrial"]      = run_test("TEST 2: Heavy Industrial Cargo (Expect PASS)", test2_manifest)
    results["Test 3: Oversized Cargo"]       = run_test("TEST 3: Oversized Cargo (Tests Rejections)", test3_manifest, expect_all_placed=False)
    results["Test 4: Full Flight Sim"]       = run_test("TEST 4: Full Flight Simulation (Expect PASS)", test4_manifest)
    results["Test 5: PAG Family"]            = run_test("TEST 5: PAG Family Test (Expect PASS)", test5_manifest, family="PAG")
    results["Test 6: Tetris Effect"]         = run_test("TEST 6: Tetris Effect (Expect FAIL)", test6_manifest, expect_all_placed=True)
    results["Test 7: P12 Height Limit"]      = run_test_7()
    results["Test 7 Control: P12 Height"]    = run_test_7_control()
    results["Test 8: FWD Door Turn Limits"]  = run_test_8()
    results["Test 8 Control: FWD Door Limits"] = run_test_8_control()
    results["Test 9: Crew Aisle Constraint"] = run_test_9()
    results["Test 9 Control: Crew Aisle"]    = run_test_9_control()
    results["Test 10: Low Takeoff Weight"]   = run_test_10()
    results["Test 11: Low Weight Conflict"]  = run_test_11()
    
    print_separator("FINAL SUMMARY")
    for name, passed in results.items():
        status = "[PASS]" if passed else "[FAIL]"
        print(f"  {status}  {name}")
    
    total_pass = sum(1 for v in results.values() if v)
    total_fail = sum(1 for v in results.values() if not v)
    print(f"\n  {total_pass} passed, {total_fail} failed out of {len(results)} tests.")

    import sys
    sys.exit(0 if total_fail == 0 else 1)
