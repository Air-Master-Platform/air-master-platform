# CargoFlow Engine — Logic & Constraints

Air Master platform · Egyptair **B737-800SF** main deck build-up + balance engine.
This document mirrors the live Python engine (`engine/`); numbers are read from the same config the engine uses.

> **Golden rule:** a box's **height cannot rotate** ("this way up"). Only length/width may swap.

---

## 1. Pipeline

| Stage | File | What it does |
|---|---|---|
| **Input** | `plan_api.py` | Manifest = boxes `{id, length, width, height (cm), weight (kg)}` + `family` (`PMC`/`PAG`). |
| **A. Build-up** | `stacker.py` | Pack boxes onto ULD pallets. Reject boxes failing door / weight / height / contour / aisle / support. |
| **B. Balance** | `balancer.py` | OR-Tools CP-SAT assigns each pallet to a deck position to steer CG toward the trim target within all limits. |
| **C. Re-validate** | `revalidator.py` | Independent judge — re-derives every limit and re-checks the plan. Authoritative PASS/FAIL + CG. |
| **Output** | `plan_api.py` | `positions`, `pallets`, `cg{arm,margins}`, `validation{ok,violations}`, `rejected[]`. |

---

## 2. Aircraft constants

| Parameter | Value | Notes |
|---|---|---|
| OWE (empty weight) | 38,827 kg | BEW, manual p.12 |
| OWE arm | 630.0 in | **placeholder** — override per tail (LIR/AFM) |
| Target CG arm | 645.0 in | trim target the optimiser steers toward |
| CG fwd limit | 600.0 in | secondary guard (cumulative curve is certified) |
| CG aft limit | 690.0 in | secondary guard |
| Total payload | 23,500 kg | |
| MZFW | 62,750 kg | max zero fuel weight |
| MTOW | 79,016 kg | max take-off weight |
| MLW / MTW | 66,350 / 79,240 kg | landing / taxi |
| Low-TOW threshold | 50,802 kg | below this only M5–M7 / A5–A7 usable |
| Assumed fuel | 5,000 kg | to compute TOW |
| Pallet base PMC / PAG | 318×244 / 318×224 cm | length × width |

---

## 3. Position limits

### PMC
| Position | Weight limit (kg) | Arm (in) |
|---|---|---|
| M1 | 2,494 | 218.95 |
| M2 | 2,948 | 315.95 |
| M3 | 2,948 | 412.95 |
| M4 | 2,948 | 509.95 |
| M5 | 3,628 | 606.95 |
| M6 | 3,628 | 703.95 |
| M7 | 2,948 | 800.95 |
| M8 | 2,948 | 897.95 |
| M9 | 2,948 | 994.95 |
| M10 | 2,494 | 1091.95 |
| P12 | 1,133 | 1180.45 |

### PAG
| Position | Weight limit (kg) | Arm (in) |
|---|---|---|
| A1 | 1,814 | 214.95 |
| A2 | 2,948 | 303.95 |
| A3 | 2,948 | 392.95 |
| A4 | 2,948 | 481.95 |
| A5 | 3,628 | 570.95 |
| A6 | 3,628 | 659.95 |
| A7 | 2,948 | 748.95 |
| A8 | 2,948 | 837.95 |
| A9 | 2,948 | 926.95 |
| A10 | 2,948 | 1015.95 |
| A11 | 1,814 | 1104.95 |
| P12 | 1,133 | 1180.45 |

---

## 4. Cumulative load limits (certified CG backbone)

Running total over the group must not exceed the limit. Enforced strictly.

**PMC fwd:** M1 ≤ 3,855 · M1+M2 ≤ 6,463 · +M3 ≤ 9,638 · +M4 ≤ 12,020 · +M5 ≤ 13,834
**PMC aft:** P12+M10 ≤ 4,309 · +M9 ≤ 7,257 · +M8 ≤ 10,432 · +M7 ≤ 13,721
**PAG fwd:** A1 ≤ 3,742 · A1+A2 ≤ 6,010 · +A3 ≤ 8,845 · +A4 ≤ 11,339 · +A5 ≤ 13,063
**PAG aft:** P12+A11 ≤ 3,855 · +A10 ≤ 6,350 · +A9 ≤ 9,298 · +A8 ≤ 12,473 · +A7 ≤ 14,968

---

## 5. Cargo-door envelope

Read: pick the **height row ≥ box height**, then the **width column ≥ box width** → cell = **max box length**. Box fits if it passes in *any* length/width rotation.

### AFT door — max length (cm)
| Height↓ / Width→ | 12 | 50 | 101 | 152 | 203 | 254 | 279 | 317 |
|---|---|---|---|---|---|---|---|---|
| 203 | 902 | 665 | | | | | | |
| 193 | 1069 | 758 | 551 | | | | | |
| 182 | 1293 | 871 | 612 | 476 | | | | |
| 172 | 1608 | 1014 | 684 | 519 | 422 | | | |
| 162 | 1866 | 1118 | 733 | 549 | 441 | 371 | | |
| 152 | 2206 | 1240 | 788 | 580 | 461 | 385 | 357 | |
| 142 | 2413 | 1387 | 849 | 614 | 483 | 400 | 370 | 334 |
| ≤132 | 2413 | 1600 | 931 | 658 | 510 | 418 | 384 | 335 |

*(FWD door is tighter; see the Excel "5. FWD Door Envelope" sheet.)*

---

## 6. Fuselage contour (roof curves inward with height)

The `318 cm` axis is the pallet's long axis **across the deck**. The fuselage **roof curves inward** as height rises, so a box whose top is at height `z` may only occupy the x-range (usable width) shown. The **full 318 cm exists only at floor level (z ≤ 90)**. Taller = narrower. **Above 200 cm nothing fits.** *(Values match the IATA L-45 max aircraft contour, B737C.)*

| Stack top z (cm) | SIDE x-range (usable width) | CENTRE x-range (usable width) |
|---|---|---|
| ≤ 90 | 0–318 (**318**) | 0–318 (**318**) |
| 90–150 | 40–278 (238) | 40–278 (238) |
| 150–170 | 70–248 (**178**) | 65–248 (183) |
| 170–200 | 100–218 (**118**) | 65–229 / 95–215 (164→120) |
| > 200 | **rejected** | **rejected** |

*(170–200 SIDE band corrected to 100–218 / 118 cm to match the IATA diagram inset of 100 cm per side.)*

---

## 7. Build-up algorithm (per box)

1. **AFT door gate** — must pass in some rotation, else `DOOR_ENVELOPE_REJECT`.
2. **Sort** valid boxes by volume → footprint → weight (largest first).
3. **Try open pallets** — skip if adding box exceeds pallet weight limit; else attempt placement.
4. **FWD door** — M1/M2/A1/A2 positions also require FWD-door fit.
5. **Height cap** — `z_top` ≤ position max (200 cm; **162 cm** for P12/M10/A11).
6. **Aisle** — centre positions: if stack > 150 cm, box must clear first 35 cm (crew aisle).
7. **Contour** — box x-span must fit allowed range for its top height (§6).
8. **Support** — if stacked, ≥ 90% of footprint must rest on the surface below.
9. **Score** — pick lowest landing height, then forward-most, then most centred.
10. **New pallet** — else open next position (by weight limit desc). Reject reasons: `EXCEEDS_REMAINING_VP_LIMIT`, `VP_CONTOUR_OR_DOOR_REJECT`, `NO_VIRTUAL_POSITIONS_REMAINING`.

---

## 8. Centre of Gravity & validation

```
CG arm = total_moment / total_weight

total_moment = (OWE × OWE_arm) + Σ(pallet_weight × position_arm)
total_weight = OWE + Σ(cargo)          (= Zero Fuel Weight)

fwd margin = CG − 600 in
aft margin = 690 in − CG
CG passes if  600 ≤ CG ≤ 690
```

**Re-validator re-checks all of:** assignment integrity, no double-booked position, family match, per-position weight ≤ limit, height ≤ 162/200, door (aft always; fwd if fwd position), 35 cm aisle, contour, cumulative fwd+aft limits, cargo ≤ payload, ZFW ≤ MZFW, TOW ≤ MTOW, low-TOW centring, CG within envelope.

**Statuses:** `OK` · `NO_PALLETS` · `INFEASIBLE` · `REVALIDATION_FAILED` · `ERROR`

---

### Worked example — why `250×191×165, 1100 kg` is rejected
- **Door:** passes (250×191 @ h165 → aft door allows 422 cm length). ✓
- **Weight:** 1100 kg — under every position limit. ✓
- **Height:** 165 cm, cannot rotate. Against the contour (§6), a 165 cm top needs x-range 65–229 (centre) / 89–229 (side); combined with the >150 cm aisle rule and 162 cm caps at P12/M10, no valid placement exists → **`VP_CONTOUR_OR_DOOR_REJECT`**.
- **Fix:** reduce height to ≤ 150 cm, or reorient if the cargo genuinely allows a shorter face as height.
