import numpy as np
from pydantic import BaseModel
from typing import List, Tuple, Optional
from aircraft_config import AircraftConfig

class Box(BaseModel):
    id: str
    length: int  # cm
    width: int   # cm
    height: int  # cm
    weight: int  # kg
    # Rotations (length/width can swap, height cannot because of "this way up" typical rules)
    
    def allowed_rotations(self) -> List[Tuple[int, int, int]]:
        return [
            (self.length, self.width, self.height),
            (self.width, self.length, self.height)
        ]

class Grid25D:
    def __init__(self, pallet_length: int = 318, pallet_width: int = 244):
        self.length = pallet_length
        self.width = pallet_width
        self.cell_size = 1 # cm
        # The 2.5D height map. Array of shape (length, width) storing Z-heights
        self.height_map = np.zeros((self.length, self.width), dtype=int)
        self.centerline_y = self.width // 2
        
    def get_landing_z(self, x: int, y: int, box_l: int, box_w: int) -> int:
        """Finds the maximum Z height underneath the proposed box footprint."""
        if x + box_l > self.length or y + box_w > self.width:
            return -1 # Out of bounds
            
        footprint = self.height_map[x:x+box_l, y:y+box_w]
        return int(np.max(footprint))
        
    def check_contour(self, z_top: int, x_min: int, x_max: int, config: AircraftConfig, is_center_pos: bool = False) -> bool:
        x_min_allowed, x_max_allowed = config.get_allowed_x_range(z_top, is_center_pos)
        return x_min >= x_min_allowed and x_max <= x_max_allowed
        
    def place_box(self, x: int, y: int, box_l: int, box_w: int, box_h: int):
        """Updates the height map with the new box."""
        landing_z = self.get_landing_z(x, y, box_l, box_w)
        new_z = landing_z + box_h
        self.height_map[x:x+box_l, y:y+box_w] = new_z

def is_door_compatible(box: Box, config: AircraftConfig, is_aft: bool = True) -> bool:
    """
    Checks if a rigid box can physically pass through the cargo door.
    The box can be rotated to pass through. We check the most favorable orientation.
    """
    fits = False
    for l, w, h in box.allowed_rotations():
        max_allowed_len = config.get_max_door_length(height_cm=h, width_cm=w, is_aft=is_aft)
        if l <= max_allowed_len:
            fits = True
            break
    return fits
