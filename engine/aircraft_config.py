import csv
import os
from typing import Dict, List, Tuple

class AircraftConfig:
    """Base interface for all aircraft configurations."""
    
    @property
    def name(self) -> str:
        raise NotImplementedError
        
    @property
    def total_payload_kg(self) -> int:
        raise NotImplementedError
        
    @property
    def pmc_limits_kg(self) -> Dict[str, int]:
        raise NotImplementedError

    @property
    def pag_limits_kg(self) -> Dict[str, int]:
        raise NotImplementedError
        
    @property
    def owe_weight_kg(self) -> int:
        return 38827 # BEW from Egyptair manual Page 12

    @property
    def owe_arm_in(self) -> float:
        # NOTE: The Basic Empty Weight (38,827 KG) is certified by the Egyptair manual,
        # but its balance ARM is NOT published in the provided documents. This is an
        # operational placeholder. For revenue flights it MUST be overridden with the
        # Dry Operating Index / arm from the specific tail's weight record (LIR / AFM).
        return 630.0

    @property
    def target_cg_arm_in(self) -> float:
        # Desired trim target (loaded CG arm the optimiser steers toward). Operational
        # default; tune per operator preference. Not a certified limit (see CG envelope).
        return 645.0

    @property
    def cg_fwd_limit_in(self) -> float:
        # Forward CG limit (balance arm). The provided manuals do NOT publish an explicit
        # %MAC envelope; the *certified* CG protection is the cumulative load curve
        # (get_cumulative_*_limits), which is enforced strictly. This window is a
        # secondary gross-error guard and MUST be replaced with the AFM-certified
        # forward/aft CG envelope before operational use.
        raise NotImplementedError

    @property
    def cg_aft_limit_in(self) -> float:
        raise NotImplementedError

    @property
    def mzfw_kg(self) -> int:
        raise NotImplementedError

    @property
    def mtow_kg(self) -> int:
        raise NotImplementedError

    @property
    def mlw_kg(self) -> int:
        raise NotImplementedError

    @property
    def mtw_kg(self) -> int:
        raise NotImplementedError
        
    def get_position_arm(self, position: str, family: str = "PMC") -> int:
        raise NotImplementedError
        
    def get_allowed_x_range(self, z_cm: int, is_center_position: bool = False) -> Tuple[int, int]:
        raise NotImplementedError
        
    def get_max_door_length(self, height_cm: int, width_cm: int, is_aft: bool = True) -> int:
        raise NotImplementedError

    @property
    def takeoff_weight_threshold_kg(self) -> int:
        return 50802 # 112,000 LB

    @property
    def assumed_fuel_weight_kg(self) -> int:
        return 5000 # Conservative estimate to compute TOW

    def get_low_weight_allowed_positions(self, family: str = "PMC") -> List[str]:
        raise NotImplementedError

    def get_cumulative_fwd_limits(self, family: str = "PMC") -> List[Tuple[List[str], int]]:
        raise NotImplementedError

    def get_cumulative_aft_limits(self, family: str = "PMC") -> List[Tuple[List[str], int]]:
        raise NotImplementedError


class B737_800SF_Config(AircraftConfig):
    """
    Configuration and constraints for the Egyptair B737-800SF.
    Data is loaded strictly from the exact PDF tables exported as CSVs.
    """
    
    def __init__(self):
        self.data_dir = os.path.join(os.path.dirname(__file__), 'data')
        self._pmc_limits, self._pmc_arms = self._load_weight_limits('b737_800sf_pmc_limits.csv')
        self._pag_limits, self._pag_arms = self._load_weight_limits('b737_800sf_pag_limits.csv')
        self._fwd_door_table = self._load_door_table('b737_800sf_door_fwd.csv')
        self._aft_door_table = self._load_door_table('b737_800sf_door_aft.csv')
        
    def _load_weight_limits(self, filename: str) -> Tuple[Dict[str, int], Dict[str, int]]:
        path = os.path.join(self.data_dir, filename)
        limits = {}
        arms = {}
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader) # skip header
            for row in reader:
                if row and len(row) >= 2:
                    pos = row[0].strip()
                    limits[pos] = int(row[1].strip())
                    if len(row) >= 3 and row[2].strip():
                        arms[pos] = float(row[2].strip())
                    else:
                        arms[pos] = 0.0
        return limits, arms

    def _load_door_table(self, filename: str) -> dict:
        """
        Loads the door matrix into a dictionary: { height: [(width_limit, length_limit), ...] }
        """
        path = os.path.join(self.data_dir, filename)
        table = {}
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader) # Skip "Maximum Allowed Length (CM)"
            headers = next(reader)
            # Headers are like: Height (CM) \ Width (CM), 12, 50, 101, 152, 203, 254, 279, 317
            width_columns = [int(h) for h in headers[1:] if h.strip()]
            
            for row in reader:
                if not row or not row[0].strip(): continue
                height = int(row[0].strip())
                limits = []
                for i, col_val in enumerate(row[1:]):
                    if col_val.strip():
                        limits.append((width_columns[i], int(col_val.strip())))
                table[height] = limits
        return table
    
    @property
    def name(self) -> str:
        return "Egyptair B737-800SF"
        
    @property
    def total_payload_kg(self) -> int:
        return 23500

    @property
    def mzfw_kg(self) -> int:
        return 62750 # Egyptair manual Page 12

    @property
    def mtow_kg(self) -> int:
        return 79016 # Egyptair manual Page 12

    @property
    def mlw_kg(self) -> int:
        return 66350 # Maximum Landing Weight, Egyptair manual Page 12

    @property
    def mtw_kg(self) -> int:
        return 79240 # Maximum Taxi Weight, Egyptair manual Page 12

    @property
    def cg_fwd_limit_in(self) -> float:
        # Secondary gross-error guard (see base-class note). Generous operational window
        # around the trim target; the cumulative load curve is the certified protection.
        return 600.0

    @property
    def cg_aft_limit_in(self) -> float:
        return 690.0

    @property
    def pmc_limits_kg(self) -> Dict[str, int]:
        return self._pmc_limits

    @property
    def pag_limits_kg(self) -> Dict[str, int]:
        return self._pag_limits
        
    def get_position_arm(self, position: str, family: str = "PMC") -> float:
        if family == "PMC":
            return self._pmc_arms.get(position, 0.0)
        return self._pag_arms.get(position, 0.0)

    def get_allowed_x_range(self, z_cm: int, is_center_position: bool = False) -> Tuple[int, int]:
        if z_cm > 200:
            return (0, 0)
        if not is_center_position:
            if z_cm <= 90:
                return (0, 318)
            elif z_cm <= 150:
                return (40, 278)
            elif z_cm <= 170:
                return (70, 248)
            else:
                return (89, 229)
        else:
            if z_cm <= 150:
                if z_cm <= 90:
                    return (0, 318)
                else:
                    return (40, 278)
            elif z_cm <= 155:
                return (35, 248)
            elif z_cm <= 170:
                return (65, 248)
            elif z_cm <= 185:
                return (65, 229)
            else:
                return (95, 215)

    def get_max_door_length(self, height_cm: int, width_cm: int, is_aft: bool = True) -> int:
        # Strict lookup using the CSV matrices
        envelope = self._aft_door_table if is_aft else self._fwd_door_table
        
        applicable_heights = [h for h in sorted(envelope.keys()) if h >= height_cm]
        if not applicable_heights:
            return 0
        
        bracket_h = applicable_heights[0]
        width_limits = envelope[bracket_h]
        
        for max_w, max_l in width_limits:
            if width_cm <= max_w:
                return max_l
                
        return 0

    def get_low_weight_allowed_positions(self, family: str = "PMC") -> List[str]:
        if family == "PMC":
            return ["M5", "M6", "M7"]
        return ["A5", "A6", "A7"]

    def get_cumulative_fwd_limits(self, family: str = "PMC") -> List[Tuple[List[str], int]]:
        if family == "PMC":
            return [
                (["M1"], 3855),
                (["M1", "M2"], 6463),
                (["M1", "M2", "M3"], 9638),
                (["M1", "M2", "M3", "M4"], 12020),
                (["M1", "M2", "M3", "M4", "M5"], 13834)
            ]
        else:
            return [
                (["A1"], 3742),
                (["A1", "A2"], 6010),
                (["A1", "A2", "A3"], 8845),
                (["A1", "A2", "A3", "A4"], 11339),
                (["A1", "A2", "A3", "A4", "A5"], 13063)
            ]

    def get_cumulative_aft_limits(self, family: str = "PMC") -> List[Tuple[List[str], int]]:
        if family == "PMC":
            return [
                (["P12", "M10"], 4309),
                (["P12", "M10", "M9"], 7257),
                (["P12", "M10", "M9", "M8"], 10432),
                (["P12", "M10", "M9", "M8", "M7"], 13721)
            ]
        else:
            return [
                (["P12", "A11"], 3855),
                (["P12", "A11", "A10"], 6350),
                (["P12", "A11", "A10", "A9"], 9298),
                (["P12", "A11", "A10", "A9", "A8"], 12473),
                (["P12", "A11", "A10", "A9", "A8", "A7"], 14968)
            ]
