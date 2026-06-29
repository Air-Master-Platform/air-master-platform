from typing import List, Dict, Any, Tuple
from pydantic import BaseModel
import numpy as np
from grid_25d import Grid25D, Box, is_door_compatible
from aircraft_config import AircraftConfig

class PlacedBox(BaseModel):
    box: Box
    x: int
    y: int
    z: int
    rotation: Tuple[int, int, int] # (l, w, h)

class VirtualPosition(BaseModel):
    name: str
    weight_limit: int
    is_center: bool
    is_fwd: bool
    max_height: int

class Pallet(BaseModel):
    id: str
    family: str # "PMC" or "PAG"
    max_gross_weight: int
    base_length: int
    base_width: int
    virtual_pos_name: str
    is_center: bool
    is_fwd: bool
    max_height_limit: int
    placed_boxes: List[PlacedBox] = []
    
    @property
    def current_gross_weight(self) -> int:
        return sum(pb.box.weight for pb in self.placed_boxes)

    @property
    def max_height_used(self) -> int:
        return max((pb.z + pb.rotation[2] for pb in self.placed_boxes), default=0)

def _try_place_on_grid(grid: Grid25D, box: Box, base_l: int, base_w: int, config: AircraftConfig, placed_boxes: List[PlacedBox], vp: VirtualPosition) -> PlacedBox | None:
    valid_placements = []
    
    # Pre-check FWD door compatibility if this virtual position requires it
    if vp.is_fwd and not is_door_compatible(box, config, is_aft=False):
        return None
        
    current_max_h = np.max(grid.height_map) if grid.height_map.any() else 0
    has_aisle_occupied = np.any(grid.height_map[0:35, :]) if vp.is_center else False
    
    # Optimize: limit pb scan to last 10 boxes to reduce candidate count quadratic explosion
    pb_subset = placed_boxes[-10:]
    has_placed = len(placed_boxes) > 0
    
    for rot_l, rot_w, rot_h in box.allowed_rotations():
        # Generate candidates
        # Center candidate (base_l - rot_l) // 2 is only checked if pallet is empty
        if not has_placed:
            candidates_x = {0, base_l - rot_l, (base_l - rot_l) // 2}
            candidates_y = {0, base_w - rot_w, (base_w - rot_w) // 2}
        else:
            candidates_x = {0, base_l - rot_l}
            candidates_y = {0, base_w - rot_w}
            
        for pb in pb_subset:
            candidates_x.add(pb.x + pb.rotation[0])
            candidates_x.add(pb.x - rot_l)
            candidates_x.add(pb.x)
            
        for pb in pb_subset:
            candidates_y.add(pb.y + pb.rotation[1])
            candidates_y.add(pb.y - rot_w)
            candidates_y.add(pb.y)
            
        # Filter candidate coordinates to ensure they are within the pallet bounds
        valid_cx = sorted(list({cx for cx in candidates_x if 0 <= cx <= base_l - rot_l}))
        valid_cy = sorted(list({cy for cy in candidates_y if 0 <= cy <= base_w - rot_w}))
        
        # Check all candidate pairs
        for cx in valid_cx:
            for cy in valid_cy:
                # Fast path: if empty pallet, landing_z is 0
                landing_z = 0 if current_max_h == 0 else grid.get_landing_z(cx, cy, rot_l, rot_w)
                if landing_z < 0:
                    continue
                z_top = landing_z + rot_h
                
                # Check absolute height limit for this virtual position
                if z_top > vp.max_height:
                    continue
                
                # 35cm Aisle Constraint Check
                if vp.is_center:
                    new_max_h = max(current_max_h, z_top)
                    if new_max_h > 150:
                        if cx < 35:
                            continue
                        if has_aisle_occupied:
                            continue
                
                # Check contour
                if not grid.check_contour(z_top, cx, cx + rot_l, config, is_center_pos=vp.is_center):
                    continue
                    
                # Stability / Support Check - skip if landing on floor (landing_z == 0)
                if landing_z > 0:
                    footprint = grid.height_map[cx : cx + rot_l, cy : cy + rot_w]
                    supported_cells = np.sum(footprint == landing_z)
                    support_ratio = supported_cells / (rot_l * rot_w)
                    if support_ratio < 0.90:
                        continue
                    
                valid_placements.append((landing_z, cx, cy, rot_l, rot_w, rot_h))
                
    if not valid_placements:
        return None
        
    # Score valid candidate placements by (landing_z, cx, abs(cy + rot_w / 2 - base_w / 2), cy) ascending.
    valid_placements.sort(key=lambda item: (item[0], item[1], abs(item[2] + item[4] / 2 - base_w / 2), item[2]))
    best_landing_z, best_cx, best_cy, best_rot_l, best_rot_w, best_rot_h = valid_placements[0]
    
    return PlacedBox(
        box=box,
        x=best_cx,
        y=best_cy,
        z=best_landing_z,
        rotation=(best_rot_l, best_rot_w, best_rot_h)
    )

def build_up_pallets(manifest: List[Box], config: AircraftConfig, family: str = "PMC", is_aft: bool = True) -> tuple:
    base_l = 318
    base_w = 244 if family == "PMC" else 224
    
    # 1. Initialize Virtual Positions based on physical aircraft capabilities
    limits = config.pmc_limits_kg if family == "PMC" else config.pag_limits_kg
    
    virtual_positions: List[VirtualPosition] = []
    for pos, limit in limits.items():
        is_center = pos in ("A4", "A5", "A6", "A7", "A8", "A9", "M4", "M5", "M6", "M7", "M8", "M9")
        is_fwd = pos in ("A1", "A2", "M1", "M2")
        max_h = 162 if pos == "P12" or (family == "PMC" and pos == "M10") or (family == "PAG" and pos == "A11") else 200
        virtual_positions.append(VirtualPosition(name=pos, weight_limit=limit, is_center=is_center, is_fwd=is_fwd, max_height=max_h))
        
    # Sort VP pool descending by weight limit to pack heaviest pallets first
    virtual_positions.sort(key=lambda vp: vp.weight_limit, reverse=True)
            
    valid_boxes = []
    unplaced_boxes = []
    for box in manifest:
        # Only global check is AFT door since it's the absolute minimum requirement to get on the aircraft
        if is_door_compatible(box, config, is_aft=True):
            valid_boxes.append(box)
        else:
            unplaced_boxes.append((box, "DOOR_ENVELOPE_REJECT"))
            
    # Sort manifest boxes using the robust multi-criteria sort key
    valid_boxes.sort(key=lambda b: (b.length * b.width * b.height, b.length * b.width, b.weight), reverse=True)
    
    pallets: List[Pallet] = []
    pallet_grids: List[Grid25D] = []
    
    for box in valid_boxes:
        placed = False
        
        # Try placing on existing active pallets
        for p_idx, pallet in enumerate(pallets):
            if pallet.current_gross_weight + box.weight > pallet.max_gross_weight:
                continue
                
            vp_def = next(vp for vp in virtual_positions if vp.name == pallet.virtual_pos_name)
            result = _try_place_on_grid(pallet_grids[p_idx], box, base_l, base_w, config, pallet.placed_boxes, vp_def)
            if result is not None:
                pallet_grids[p_idx].place_box(result.x, result.y, *result.rotation)
                pallet.placed_boxes.append(result)
                placed = True
                break
                
        if not placed:
            # Try starting a new pallet from the Virtual Position pool
            if len(pallets) >= len(virtual_positions):
                unplaced_boxes.append((box, "NO_VIRTUAL_POSITIONS_REMAINING"))
                continue
                
            # The next available Virtual Position in our sorted pool
            vp_def = virtual_positions[len(pallets)]
            
            if box.weight > vp_def.weight_limit:
                unplaced_boxes.append((box, f"EXCEEDS_REMAINING_VP_LIMIT_{box.weight}kg"))
                continue
                
            new_grid = Grid25D(pallet_length=base_l, pallet_width=base_w)
            result = _try_place_on_grid(new_grid, box, base_l, base_w, config, [], vp_def)
            
            if result is not None:
                new_grid.place_box(result.x, result.y, *result.rotation)
                new_pallet = Pallet(
                    id=f"ULD_VP_{vp_def.name}",
                    family=family,
                    max_gross_weight=vp_def.weight_limit,
                    base_length=base_l,
                    base_width=base_w,
                    virtual_pos_name=vp_def.name,
                    is_center=vp_def.is_center,
                    is_fwd=vp_def.is_fwd,
                    max_height_limit=vp_def.max_height,
                    placed_boxes=[result]
                )
                pallets.append(new_pallet)
                pallet_grids.append(new_grid)
            else:
                unplaced_boxes.append((box, "VP_CONTOUR_OR_DOOR_REJECT"))
                
    # Sort the final pallets by gross weight descending for display purposes
    pallets.sort(key=lambda p: p.current_gross_weight, reverse=True)
    for i, pallet in enumerate(pallets):
        pallet.id = f"ULD_{i+1}"
        
    return pallets, unplaced_boxes

