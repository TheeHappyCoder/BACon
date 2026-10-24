"""The room behind the controller: a small thermal model and the controller's own logic.

Pure Python with no BACnet in it, so it can run ahead in time (the trend history is the model's own past) and be
tested on its own. Everything is in simulated seconds; the clock can run faster than real time for demos.
"""

import math
import random
import time
from dataclasses import dataclass, field

MODES = ["Comfort", "Standby", "Economy", "Frost protection"]
FAN = ["Off", "Low", "Medium", "High"]

# How far each mode lets the room drift from the setpoint before heating or cooling starts, in kelvin.
BAND = {"Comfort": 0.5, "Standby": 2.0, "Economy": 4.0}
FROST = 8.0


def outdoor(t: float) -> float:
    """Outside air: coldest just before sunrise, warmest mid-afternoon, with a slow weather wobble."""
    lt = time.localtime(t)
    hour = lt.tm_hour + lt.tm_min / 60 + lt.tm_sec / 3600
    return 14.0 + 6.0 * math.sin((hour - 9) / 24 * 2 * math.pi) + 1.5 * math.sin(t / 50000)


def occupied_by_schedule(t: float) -> bool:
    """The default weekly occupancy: weekdays 07:00 to 18:00, Saturday morning."""
    lt = time.localtime(t)
    minute = lt.tm_hour * 60 + lt.tm_min
    if lt.tm_wday < 5:
        return 7 * 60 <= minute < 18 * 60
    if lt.tm_wday == 5:
        return 8 * 60 <= minute < 12 * 60
    return False


@dataclass
class Inputs:
    """What the controller acts on: its setpoints and commands as the BACnet objects currently hold them."""

    setpoint: float = 21.0
    offset: float = 0.0
    mode: str = "Comfort"
    occupied: bool = True
    heat_cmd: float | None = None  # a valve or fan position someone else commands; None means the loop decides
    cool_cmd: float | None = None
    fan_cmd: str | None = None


@dataclass
class Room:
    temp: float = 21.0
    humidity: float = 45.0
    co2: float = 480.0
    people: int = 0
    window_open: bool = False
    outside_override: float | None = None
    outside: float = 14.0

    # controller outputs (what the loop wants) and actuator positions (what the room gets)
    heat_loop: float = 0.0
    cool_loop: float = 0.0
    heat: float = 0.0
    cool: float = 0.0
    fan: str = "Off"
    heat_sp: float = 20.5
    cool_sp: float = 21.5

    _i_heat: float = field(default=0.0, repr=False)
    _i_cool: float = field(default=0.0, repr=False)

    @property
    def effective_setpoint(self) -> float:
        return round((self.heat_sp + self.cool_sp) / 2, 2)

    def step(self, t: float, dt: float, inp: Inputs, noise: bool = True) -> None:
        """Advance the room by dt simulated seconds at simulated time t."""
        self.outside = self.outside_override if self.outside_override is not None else outdoor(t)

        # setpoints for the mode: a band around setpoint + offset, or frost protection only
        sp = inp.setpoint + inp.offset
        if inp.mode == "Frost protection":
            self.heat_sp, self.cool_sp = FROST, 40.0
        else:
            band = BAND.get(inp.mode, 0.5)
            self.heat_sp, self.cool_sp = sp - band, sp + band

        # PI loops, one for heating and one for cooling; the integral only winds while the loop is active
        kp, ti = 40.0, 900.0
        e_heat = self.heat_sp - self.temp
        e_cool = self.temp - self.cool_sp
        self._i_heat = min(100.0, max(0.0, self._i_heat + kp * e_heat * dt / ti)) if e_heat > -0.3 else 0.0
        self._i_cool = min(100.0, max(0.0, self._i_cool + kp * e_cool * dt / ti)) if e_cool > -0.3 else 0.0
        self.heat_loop = round(min(100.0, max(0.0, kp * e_heat + self._i_heat)), 1)
        self.cool_loop = round(min(100.0, max(0.0, kp * e_cool + self._i_cool)), 1)
        if self.window_open:  # window interlock: no point conditioning the street
            self.heat_loop = self.cool_loop = 0.0
            self._i_heat = self._i_cool = 0.0

        self.heat = self.heat_loop if inp.heat_cmd is None else max(0.0, min(100.0, inp.heat_cmd))
        self.cool = self.cool_loop if inp.cool_cmd is None else max(0.0, min(100.0, inp.cool_cmd))

        demand = max(self.heat, self.cool)
        auto_fan = "Off" if demand < 1 else "Low" if demand < 40 else "Medium" if demand < 75 else "High"
        if inp.mode == "Comfort" and inp.occupied and auto_fan == "Off":
            auto_fan = "Low"  # keep air moving while the room is in use
        self.fan = inp.fan_cmd if inp.fan_cmd in FAN else auto_fan
        airflow = FAN.index(self.fan) / 3  # 0 .. 1

        # heat balance in kelvin per hour: losses to outside, the coil (only with air moving), people
        loss = (self.outside - self.temp) / (5.0 if self.window_open else 30.0)
        coil = (0.25 + 0.75 * airflow) if airflow else 0.15  # a coil still radiates a little with the fan off
        gain = self.heat / 100 * 4.0 * coil - self.cool / 100 * 4.0 * coil + self.people * 0.12
        self.temp += (loss + gain) * dt / 3600

        # CO2: people breathe it in, ventilation and an open window take it out towards outdoor air (420 ppm)
        vent = 0.3 + 2.5 * airflow + (6.0 if self.window_open else 0.0)
        self.co2 += (self.people * 260.0 - (self.co2 - 420.0) * vent) * dt / 3600
        self.co2 = max(410.0, self.co2)

        # humidity: people add a little, cooling dries the air, it relaxes towards 45 %
        self.humidity += (self.people * 0.8 - self.cool / 100 * 3.0 + (45.0 - self.humidity) * 0.4) * dt / 3600
        self.humidity = min(95.0, max(15.0, self.humidity))

        if noise:
            self.temp += random.uniform(-0.01, 0.01)
            self.co2 += random.uniform(-2, 2)

    def people_by_schedule(self, t: float) -> int:
        """How many people a typical office room has at time t, used for the history and Auto presence."""
        if not occupied_by_schedule(t):
            return 0
        lt = time.localtime(t)
        if lt.tm_hour == 12:
            return 1  # lunch
        return 2 + (lt.tm_yday + lt.tm_hour) % 3
