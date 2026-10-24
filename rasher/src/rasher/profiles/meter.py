"""EM-3, a three-phase energy meter on an office floor's distribution board: power, energy, demand, voltage and current
per phase, power factor and frequency, with a phase failure input.

The board's load follows the office day and the weather. The meter only measures: there is nothing to command, so it
exercises the read side of a BMS (polling, COV on analog values, a demand alarm, trends), and its faults are the kind
that make the readings wrong rather than missing.
"""

import math
import random
import time
from dataclasses import dataclass, field

from bacpypes3.basetypes import Destination, EngineeringUnits, EventTransitionBits, LimitEnable, Polarity, Reliability
from bacpypes3.constructeddata import ArrayOf, ListOf
from bacpypes3.primitivedata import Enumerated, Real, Unsigned

from ..device import AI, AIA, BIA, NC, Profile, flags, ir, ref
from .common import occupied_by_schedule, outdoor, trend_logs

SPLIT = (0.36, 0.33, 0.31)  # how the load sits across L1, L2 and L3: never quite balanced
NOMINAL = 230.0


def building_load(t: float) -> float:
    """What the floor draws at time t, in kW: servers, lighting and heating at night; people, kitchen and cooling by day."""
    lt = time.localtime(t)
    hour = lt.tm_hour + lt.tm_min / 60
    out = outdoor(t)
    load = 9.0 + 0.6 * max(0.0, 12.0 - out)
    if occupied_by_schedule(t):
        load += 26.0 + 6.0 * math.sin(max(0.0, hour - 7) / 11 * math.pi) + max(0.0, out - 20.0)
        if lt.tm_hour == 12:
            load += 5.0  # the kitchen at lunch
    return load


@dataclass
class Board:
    load: float = 20.0  # what the floor really draws, kW
    load_override: float | None = None
    pf_override: float | None = None
    energy: float = 183_400.0  # kWh imported since the meter was fitted
    demand: float = 20.0  # the 15-minute average of the measured power
    total: float = 0.0  # measured active power, kW
    pf: float = 0.95  # measured
    hz: float = 50.0
    volts: list[float] = field(default_factory=lambda: [NOMINAL] * 3)
    amps: list[float] = field(default_factory=lambda: [0.0] * 3)
    kw: list[float] = field(default_factory=lambda: [0.0] * 3)  # measured per phase

    def step(self, t: float, dt: float, phase_lost: bool = False, ct_reversed: bool = False, noise: bool = True) -> None:
        self.load = max(0.0, self.load_override if self.load_override is not None else building_load(t) + (random.uniform(-0.6, 0.6) if noise else 0))
        pf = self.pf_override if self.pf_override is not None else 0.92 + 0.05 * min(1.0, self.load / 50)
        apparent = 0.0
        for i in range(3):
            p = 0.0 if phase_lost and i == 2 else self.load * SPLIT[i]
            amps = p * 1000 / (NOMINAL * pf)
            volts = 0.0 if phase_lost and i == 2 else NOMINAL + 1.5 - 0.04 * amps + (random.uniform(-0.4, 0.4) if noise else 0)
            self.volts[i], self.amps[i] = volts, amps
            self.kw[i] = -p if ct_reversed and i == 1 else p  # a CT fitted backwards measures the power going the other way
            apparent += volts * amps / 1000
        self.total = sum(self.kw)
        self.pf = max(-1.0, min(1.0, self.total / apparent)) if apparent > 0.01 else 1.0
        self.energy += max(0.0, self.total) * dt / 3600
        self.demand += (self.total - self.demand) * min(1.0, dt / 900)
        self.hz = 50.0 + 0.02 * math.sin(t / 37) + (random.uniform(-0.005, 0.005) if noise else 0)


class Meter(Profile):
    type = "meter"
    label = "Energy meter"
    prefix = "EM"
    model = "EM-3 Three-phase energy meter"
    location = "Level 2, Riser cupboard 2.R1"
    description = "Simulated three-phase energy meter on the level 2 distribution board"
    logs = [("trend-log", 1), ("trend-log", 2), ("trend-log", 3), ("trend-log-multiple", 1)]
    actions = {
        "load": {"text": "What the floor draws; null follows the office day and the weather. 70 pushes demand past its 55 kW limit", "value": {"type": "number", "min": 0, "max": 200, "units": "kW", "null": "follow the office day"}},
        "pf": {"text": "The load's power factor; null for a normal office mix", "value": {"type": "number", "min": 0.5, "max": 1, "null": "a normal office mix"}},
    }
    faults = {
        "phase": {"text": "L3 is lost: its voltage and current drop to zero and the phase failure input alarms after 5 s", "value": {"type": "boolean"}},
        "ct": {"text": "The L2 current transformer is fitted backwards: L2 power reads negative, so the total and power factor read low", "value": {"type": "boolean"}},
    }

    def __init__(self, dev):
        super().__init__(dev)
        self.board = Board()

    def history(self, now: float) -> None:
        board = self.board
        t = now - 3 * 86400
        t -= t % 900
        board.load = board.demand = building_load(t)
        while t <= now:
            board.step(t, 60)
            if t % 900 < 60:
                self.sample(t)
            t += 60

    def sample(self, t: float) -> None:
        b, logs = self.board, self.dev.logs
        logs[("trend-log", 1)].add(t, round(b.total, 2))
        logs[("trend-log", 2)].add(t, round(b.demand, 2))
        logs[("trend-log", 3)].add(t, round(b.energy, 1))
        logs[("trend-log-multiple", 1)].add(t, [round(b.total, 2), round(b.demand, 2), round(b.pf, 3), round(b.energy, 1)])

    def build(self) -> list:
        b = self.board

        def ai(n, name, value, units, cov, description=""):
            return AI(objectIdentifier=("analog-input", n), objectName=name, presentValue=value, units=EngineeringUnits(units),
                      statusFlags=flags(), covIncrement=cov, outOfService=False, reliability=Reliability("no-fault-detected"), description=description)

        objs = [
            ai(1, "Active power", round(b.total, 2), "kilowatts", 0.5, "Total, all three phases"),
            ai(2, "Active energy", round(b.energy, 1), "kilowatt-hours", 1.0, "Imported since the meter was fitted"),
            AIA(objectIdentifier=("analog-input", 3), objectName="Demand", presentValue=round(b.demand, 2), units=EngineeringUnits("kilowatts"),
                statusFlags=flags(), covIncrement=0.5, outOfService=False, description="Active power averaged over 15 minutes",
                highLimit=55.0, lowLimit=0.0, deadband=3.0, limitEnable=LimitEnable([0, 1]), **ir(1, 60, (1, 0, 1))),
            *[ai(4 + i, f"Voltage L{i + 1}", round(b.volts[i], 1), "volts", 2.0, f"L{i + 1} to neutral") for i in range(3)],
            *[ai(7 + i, f"Current L{i + 1}", round(b.amps[i], 1), "amperes", 1.0) for i in range(3)],
            ai(10, "Power factor", round(b.pf, 3), "power-factor", 0.02, "Total, all three phases"),
            ai(11, "Frequency", round(b.hz, 2), "hertz", 0.05),
            BIA(objectIdentifier=("binary-input", 1), objectName="Phase failure", presentValue="inactive",
                polarity=Polarity("normal"), statusFlags=flags(), activeText="Failed", inactiveText="Normal", outOfService=False,
                description="Any phase below 80 % of nominal", alarmValue="active", **ir(1, 5, (1, 0, 1))),
            NC(objectIdentifier=("notification-class", 1), objectName="Meter alarms", notificationClass=1,
               priority=ArrayOf(Unsigned, _length=3)([64, 64, 200]), ackRequired=EventTransitionBits([1, 1, 0]),
               recipientList=ListOf(Destination)([])),
        ]
        objs += trend_logs([
            ("Active power log", ref("analog-input", 1)),
            ("Demand log", ref("analog-input", 3)),
            ("Active energy log", ref("analog-input", 2)),
        ], ("Meter log", [ref("analog-input", 1), ref("analog-input", 3), ref("analog-input", 10), ref("analog-input", 2)]), nc=1)
        return objs

    async def tick(self, now: float) -> None:
        b, o, f = self.board, self.dev.obj, self.dev.faults
        b.step(now, self.dev.speed, f["phase"], f["ct"])
        values = [("analog-input,1", round(b.total, 2)), ("analog-input,2", round(b.energy, 1)), ("analog-input,3", round(b.demand, 2)),
                  ("analog-input,10", round(b.pf, 3)), ("analog-input,11", round(b.hz, 2))]
        values += [(f"analog-input,{4 + i}", round(b.volts[i], 1)) for i in range(3)]
        values += [(f"analog-input,{7 + i}", round(b.amps[i], 1)) for i in range(3)]
        for key, value in values:
            if not o(key).outOfService:
                o(key).presentValue = Real(value)
        failed = o("binary-input,1")
        if not failed.outOfService:
            failed.presentValue = Enumerated(1 if min(b.volts) < 0.8 * NOMINAL else 0)

    def state(self) -> dict:
        b = self.board
        return {"meter": {"load": round(b.load, 2), "autoLoad": b.load_override is None, "pfOverride": b.pf_override, "total": round(b.total, 2),
                          "energy": round(b.energy, 1), "demand": round(b.demand, 2), "pf": round(b.pf, 3), "hz": round(b.hz, 2),
                          "phases": [{"v": round(b.volts[i], 1), "a": round(b.amps[i], 1), "kw": round(b.kw[i], 2)} for i in range(3)],
                          "speed": self.dev.speed}}

    async def act(self, action: str, value) -> bool:
        b = self.board
        if action == "load":
            b.load_override = None if value is None else max(0.0, min(200.0, float(value)))
        elif action == "pf":
            b.pf_override = None if value is None else max(0.5, min(1.0, float(value)))
        else:
            return False
        return True

    def trend(self, since: float) -> dict:
        """The meter log (trend-log-multiple 1): power, demand, power factor and energy."""
        return {"meter": [[t, *v] for _, t, v in self.dev.logs[("trend-log-multiple", 1)].records if t >= since]}
