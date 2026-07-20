# Sky Vision Airlines — Build Up Plan Test Cases

Manifests for testing the loading engine via the **Build Up Plan** view
(`/app` → Build Up Plan → paste a manifest → **Run Plan**).

**Format:** one item per line — `name: LxWxH, weight` (dimensions in **cm**, weight in **kg**).
The `name:` prefix is optional (`120x100x80, 2000` also works). Each line is one
physical box/crate; the engine packs boxes into pallets, then assigns deck positions.

---

## Case A — Clean success (PMC)
Family: **PMC**

```
ENGINE:  150x120x90, 2200
PUMP_A:  120x100x80, 2000
PUMP_B:  120x100x80, 1800
CRATE_1: 110x90x70, 1500
CRATE_2: 110x90x70, 1500
GEARBOX: 100x100x95, 2400
BOX_S1:  80x60x50, 600
BOX_S2:  80x60x50, 600
```

**Expected:** several pallets built and placed; deck mostly green; CG ≈ 640–645 in
(inside envelope); validation ✓; 0 rejected.

---

## Case B — Rejection: door turn (PMC)
Family: **PMC** — Case A plus one oversized item.

```
ENGINE:   150x120x90, 2200
PUMP_A:   120x100x80, 2000
PUMP_B:   120x100x80, 1800
CRATE_1:  110x90x70, 1500
CRATE_2:  110x90x70, 1500
GEARBOX:  100x100x95, 2400
BOX_S1:   80x60x50, 600
BOX_S2:   80x60x50, 600
OVERSIZE: 600x40x40, 300
```

**Expected:** everything from A still plans; `OVERSIZE` appears under **Rejected**
(too long to turn through the cargo door — `DOOR_ENVELOPE_REJECT`).

---

## Case C — Weight limits & utilization (PMC)
Family: **PMC**

```
HVY_1: 150x120x90, 2900
HVY_2: 150x120x90, 2900
HVY_3: 150x120x90, 3600
HVY_4: 150x120x90, 3600
HVY_5: 150x120x90, 2900
HVY_6: 150x120x90, 2900
```

**Expected:** the 3600 kg pallets routed to the high-capacity positions (M5/M6,
limit 3628); positions show amber/red as they approach their limit; CG kept near target.

---

## Case D — Hard limit reject (PMC)
Family: **PMC**

```
TOOHEAVY: 150x120x100, 4000
```

**Expected:** rejected — 4000 kg exceeds every position limit (max is 3628 kg).

---

## Case E — PAG family (A1–A11)
Family: **PAG**

```
PAG_A: 100x100x80, 1500
PAG_B: 100x100x80, 1500
PAG_C: 100x100x80, 1500
PAG_D: 100x100x80, 1000
PAG_E: 100x100x80, 1000
SMALL_1: 60x50x40, 300
SMALL_2: 60x50x40, 300
SMALL_3: 60x50x40, 300
```

**Expected:** deck switches to A1–A11 + P12; pallets placed and balanced; validation ✓.

---

## Case F — Tall item / P12 height ceiling (PMC)
Family: **PMC**

```
TALL:   100x100x190, 1200
NORMAL: 120x100x80, 1500
```

**Expected:** the 190 cm pallet is kept out of P12/M10 (162 cm ceiling) and placed in a
full-height position; both plan successfully.

---

## What to check in the results card
- **CG bar** — marker position vs. the fwd/aft envelope and the target tick.
- **Validation** — independent ✓/✗ and any specific violation messages.
- **Rejected** — item id, dimensions/weight, and the reason.
- **Pallets built** — assigned position, weight, height, and contents.

> Note: the CG **envelope shown is a provisional operational guard** (600–690 in),
> pending the certified AFM CG envelope and the per-tail empty-CG arm. CG behaviour is
> correct; only the absolute number and envelope bounds refine once that data arrives.

---

## Command-line equivalent (no browser/DB needed)
The same engine can be tested directly:

```bash
echo '{"family":"PMC","boxes":[
  {"id":"ENGINE","length":150,"width":120,"height":90,"weight":2200},
  {"id":"PUMP_A","length":120,"width":100,"height":80,"weight":2000},
  {"id":"OVERSIZE","length":600,"width":40,"height":40,"weight":300}
]}' | python engine/plan_api.py
```
