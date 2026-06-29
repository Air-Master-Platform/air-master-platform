# CargoFlow Engine Constraints

This document acts as the source of truth for the strict mathematical constraints governing the CargoFlow engine, extracted directly from the `Egyptair Cargo B737-800SF_English.pdf`.

## 1. Aircraft Volumes & Payload (Page 12)
- **Total Maximum Payload**: 23,500 KG
- **Main Deck Usable Volume**: 137 M³
- **Lower Deck Usable Volume**: 19 M³ (FWD), 25 M³ (AFT)

## 2. Pallet Position Constraints (Pages 7 & 8)

### PAG Configuration (11 PAG + 1 AKE/PKC)
- A1: 1814 KG
- A2, A3, A4: 2948 KG
- A5, A6: 3628 KG
- A7, A8, A9, A10: 2948 KG
- A11: 1814 KG
- P12: 1133 KG

### PMC Configuration (10 PMC + 1 AKE/PKC)
- M1: 2494 KG
- M2, M3, M4: 2948 KG
- M5, M6: 3628 KG
- M7, M8, M9: 2948 KG
- M10: 2494 KG
- P12: 1133 KG

## 3. Contour Steps & Build-up (Pages 3 & 4)
When building pallets, the contour of the aircraft dictates maximum widths at specific heights.
Base Width is assumed to be the 318cm dimension across the aircraft.

1. Up to 90 cm: Full width.
2. At 90 cm: Step inside 40 cm from both sides.
3. At 150 cm: Step inside 30 cm from both sides.
4. At 170 cm: Step inside 30 cm from both sides.
5. Absolute maximum height: 200 cm (except Pos 12 which is 162 cm).
6. Maximum width of top row: 140 cm.
7. Figure 2: For 6 pallets in the center (A4-A9 or M4-M9), step 35 cm from one side only to allow loading staff aisle. Ignore if max height is <= 150 cm.

## 4. Main Deck Cargo Door Dimensions (Pages 10 & 11)
Due to the rigid nature of cargo, boxes must be able to physically turn through the door. 
The tables dictate the absolute **maximum length** of a rigid item given its Height and Width.

- **FWD Door (Positions 1 & 2)**: Restricted turn radius. Example: A box 162cm high and 152cm wide can be at most 533cm long.
- **AFT Door (Positions 3 to 12)**: Looser turn radius. Example: The same box (162cm high, 152cm wide) can be 549cm long.

## 5. Safety Rules (Page 13)
- No mixing of pallet families (All PAG or All PMC).
- Dangerous Goods (Class 3 & Class 4) are completely forbidden.
- No overhangs are allowed outside the pallet footprint.
