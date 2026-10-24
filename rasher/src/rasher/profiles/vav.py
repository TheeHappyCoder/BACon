"""VC-1, a pressure-independent VAV box with hot water reheat, serving an open-plan office zone off the floor's AHU.

The controller cascades: the zone temperature sets the airflow (between the minimum for fresh air and the maximum for
cooling) or opens the reheat valve, and the airflow loop moves the damper to get that airflow at whatever duct
pressure the AHU gives it. The zone is a small thermal model, like the FCU's room, so its history is its own past.
"""

import math
import random
import time
from dataclasses import dataclass, field

from bacpypes3.basetypes import (
    Action,
    Destination,
    EngineeringUnits,
    EventState,
    EventTransitionBits,
    LimitEnable,
    ObjectPropertyReference,
    Polarity,
    Reliability,
    SetpointReference,
)
from bacpypes3.constructeddata import ArrayOf, ListOf
from bacpypes3.primitivedata import CharacterString, Enumerated, Real, Unsigned

from ..device import AI, AIA, AO, AV, AVC, BI, BVC, MSVC, NC, LoopObj, Profile, flags, ir, oid, ref
from .common import holidays, occupancy_schedule, occupied_by_schedule, office_people, outdoor, trend_logs

MODES = ["Occupied", "Standby", "Unoccupied"]
BAND = {"Occupied": 0.5, "Standby": 1.5, "Unoccupied": 4.0}  # how far the zone may drift before heating or cooling
CAPACITY = 450.0  # l/s through the box fully open at the design duct pressure
DESIGN_PA = 250.0
SUPPLY = 13.0  # the AHU's supply air, °C
STROKE = 90.0  # seconds for the damper to go end to end


@dataclass
class Inputs:
    setpoint: float = 21.0
    offset: float = 0.0
    mode: str = "Occupied"
    min_flow: float = 90.0
    max_flow: float = 350.0
    damper_cmd: float | None = None  # a damper or valve position someone else commands; None means the loops decide
    reheat_cmd: float | None = None
    stuck: bool = False


@dataclass
class Zone:
    temp: float = 21.5
    people: int = 0
    outside: float = 14.0
    outside_override: float | None = None
    pressure: float = DESIGN_PA  # duct static pressure upstream of the box, Pa
    pressure_override: float | None = None

    heat_loop: float = 0.0
    cool_loop: float = 0.0
    flow_sp: float = 0.0
    damper_cmd: float = 30.0  # what the airflow loop asks for
    damper: float = 30.0  # where the blade really is
    flow: float = 0.0
    reheat: float = 0.0
    discharge: float = SUPPLY
    heat_sp: float = 20.5
    cool_sp: float = 21.5

    _i_heat: float = field(default=0.0, repr=False)
    _i_cool: float = field(default=0.0, repr=False)

    @property
    def effective_setpoint(self) -> float:
        return round((self.heat_sp + self.cool_sp) / 2, 2)

    def step(self, t: float, dt: float, inp: Inputs, noise: bool = True) -> None:
        self.outside = self.outside_override if self.outside_override is not None else outdoor(t)
        self.pressure = max(0.0, (self.pressure_override if self.pressure_override is not None else DESIGN_PA) + (random.uniform(-3, 3) if noise else 0))

        sp = inp.setpoint + inp.offset
        band = BAND.get(inp.mode, 0.5)
        self.heat_sp, self.cool_sp = sp - band, sp + band

        # PI loops for heating and cooling, as on the FCU
        kp, ti = 40.0, 900.0
        e_heat = self.heat_sp - self.temp
        e_cool = self.temp - self.cool_sp
        self._i_heat = min(100.0, max(0.0, self._i_heat + kp * e_heat * dt / ti)) if e_heat > -0.3 else 0.0
        self._i_cool = min(100.0, max(0.0, self._i_cool + kp * e_cool * dt / ti)) if e_cool > -0.3 else 0.0
        self.heat_loop = round(min(100.0, max(0.0, kp * e_heat + self._i_heat)), 1)
        self.cool_loop = round(min(100.0, max(0.0, kp * e_cool + self._i_cool)), 1)

        # airflow: the minimum for fresh air while occupied (and for the reheat coil), up to the maximum for cooling
        occupied = inp.mode != "Unoccupied"
        lo = inp.min_flow if occupied or self.heat_loop > 0 else 0.0
        self.flow_sp = round(lo + max(0.0, inp.max_flow - lo) * self.cool_loop / 100, 1)

        # the airflow loop finds the damper position for that flow at today's duct pressure; the actuator takes its time
        gain = CAPACITY * math.sqrt(self.pressure / DESIGN_PA)
        want = min(100.0, self.flow_sp / gain * 100) if gain > 1 else 100.0
        self.damper_cmd = round(want if inp.damper_cmd is None else max(0.0, min(100.0, inp.damper_cmd)), 1)
        if not inp.stuck:
            move = 100 * dt / STROKE
            self.damper += max(-move, min(move, self.damper_cmd - self.damper))
        self.flow = max(0.0, gain * self.damper / 100 + (random.uniform(-1.5, 1.5) if noise and self.damper > 1 else 0))

        self.reheat = self.heat_loop if inp.reheat_cmd is None else max(0.0, min(100.0, inp.reheat_cmd))
        self.discharge = SUPPLY + self.reheat / 100 * min(30.0, 2600 / max(self.flow, 1.0))

        # heat balance in kW, over a zone that takes about 3000 kJ to warm by a kelvin
        air = 0.0012 * self.flow * (self.discharge - self.temp)
        gains = self.people * 0.1 + (2.0 if occupied else 0.3) + 0.15 * (self.outside - self.temp)
        self.temp += (air + gains) * dt / 3000
        if noise:
            self.temp += random.uniform(-0.01, 0.01)


def zone_people(t: float) -> int:
    """An open-plan zone: four times a meeting room."""
    return office_people(t) * 4


class VAV(Profile):
    type = "vav"
    label = "VAV box with reheat"
    prefix = "VAV"
    model = "VC-1 VAV controller"
    location = "Level 2, Open office zone 2.11"
    description = "Simulated pressure-independent VAV box with hot water reheat"
    logs = [("trend-log", 1), ("trend-log", 2), ("trend-log", 3), ("trend-log", 4), ("trend-log-multiple", 1)]
    actions = {
        "offset": {"text": "The zone sensor's - and +: the setpoint offset, in half steps, written at priority 16", "value": {"type": "number", "min": -3, "max": 3, "step": 0.5, "units": "K"}},
        "people": {"text": "How many people are in the zone; null follows the office day", "value": {"type": "integer", "min": 0, "max": 40, "null": "follow the office day"}},
        "pressure": {"text": "The duct static pressure the AHU gives the box; null for its design 250 Pa. Below about 100 Pa the box can't reach its airflow", "value": {"type": "number", "min": 0, "max": 600, "units": "Pa", "null": "the design 250 Pa"}},
        "outside": {"text": "Fix the outside air temperature; null for a normal day", "value": {"type": "number", "units": "°C", "null": "a normal day for the time"}},
        "temp": {"text": "Set the zone temperature now, e.g. 27.5 to pass the 26 °C high limit", "value": {"type": "number", "units": "°C"}},
    }
    faults = {
        "sensor": {"text": "Zone temperature reads -50 °C with reliability open-loop", "value": {"type": "boolean"}},
        "damper": {"text": "The damper sticks where it is: the command moves, the blade and the airflow don't", "value": {"type": "boolean"}},
    }

    def __init__(self, dev):
        super().__init__(dev)
        self.zone = Zone()
        self.auto_people = True

    def history(self, now: float) -> None:
        zone = self.zone = Zone(temp=19.5)
        t = now - 3 * 86400
        t -= t % 900
        while t <= now:
            occ = occupied_by_schedule(t)
            zone.people = zone_people(t)
            mode = "Occupied" if occ and zone.people else "Standby" if occ else "Unoccupied"
            zone.step(t, 60, Inputs(mode=mode))
            if t % 900 < 60:
                self.sample(t)
            t += 60
        zone.people = zone_people(now)

    def sample(self, t: float) -> None:
        z, logs = self.zone, self.dev.logs
        logs[("trend-log", 1)].add(t, round(z.temp, 2))
        logs[("trend-log", 2)].add(t, round(z.flow, 1))
        logs[("trend-log", 3)].add(t, round(z.damper_cmd, 1))
        logs[("trend-log", 4)].add(t, z.reheat)
        logs[("trend-log-multiple", 1)].add(t, [round(z.temp, 2), z.effective_setpoint, round(z.flow, 1), z.flow_sp, round(z.damper_cmd, 1), z.reheat])

    def build(self) -> list:
        z = self.zone
        c = "degrees-celsius"
        ls = "liters-per-second"

        def loop(n, name, controlled, units, setpoint, manipulated, action):
            return LoopObj(objectIdentifier=("loop", n), objectName=name, presentValue=0.0, statusFlags=flags(),
                           eventState=EventState("normal"), outOfService=False, outputUnits=EngineeringUnits("percent"),
                           manipulatedVariableReference=ObjectPropertyReference(objectIdentifier=oid(*manipulated), propertyIdentifier="present-value"),
                           controlledVariableReference=ObjectPropertyReference(objectIdentifier=oid(*controlled), propertyIdentifier="present-value"),
                           controlledVariableValue=0.0, controlledVariableUnits=EngineeringUnits(units),
                           setpointReference=SetpointReference(setpointReference=ObjectPropertyReference(objectIdentifier=oid(*setpoint), propertyIdentifier="present-value")),
                           setpoint=0.0, action=Action(action), priorityForWriting=16, proportionalConstant=40.0,
                           proportionalConstantUnits=EngineeringUnits("percent"), integralConstant=900.0,
                           integralConstantUnits=EngineeringUnits("seconds"), maximumOutput=100.0, minimumOutput=0.0)

        objs = [
            AIA(objectIdentifier=("analog-input", 1), objectName="Zone temperature", presentValue=round(z.temp, 2),
                units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, description="Zone sensor on the column",
                highLimit=26.0, lowLimit=16.0, deadband=0.5, limitEnable=LimitEnable([1, 1]), outOfService=False, **ir(1, 30)),
            AI(objectIdentifier=("analog-input", 2), objectName="Discharge air temperature", presentValue=round(z.discharge, 1),
               units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.5, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="After the reheat coil"),
            AI(objectIdentifier=("analog-input", 3), objectName="Airflow", presentValue=round(z.flow, 1),
               units=EngineeringUnits(ls), statusFlags=flags(), covIncrement=5.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="From the flow cross at the box inlet"),
            AI(objectIdentifier=("analog-input", 4), objectName="Duct static pressure", presentValue=round(z.pressure),
               units=EngineeringUnits("pascals"), statusFlags=flags(), covIncrement=10.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Upstream of the box, from the AHU"),
            AVC(objectIdentifier=("analog-value", 1), objectName="Occupied setpoint", presentValue=21.0, relinquishDefault=21.0,
                units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, outOfService=False,
                minPresValue=15.0, maxPresValue=28.0, description="Base setpoint; the zone sensor adds the offset"),
            AVC(objectIdentifier=("analog-value", 2), objectName="Setpoint offset", presentValue=0.0, relinquishDefault=0.0,
                units=EngineeringUnits("delta-degrees-kelvin"), statusFlags=flags(), covIncrement=0.1, outOfService=False,
                minPresValue=-3.0, maxPresValue=3.0, description="Set from the zone sensor's + and -"),
            AV(objectIdentifier=("analog-value", 3), objectName="Effective setpoint", presentValue=21.0,
               units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, outOfService=False),
            AVC(objectIdentifier=("analog-value", 4), objectName="Minimum airflow", presentValue=90.0, relinquishDefault=90.0,
                units=EngineeringUnits(ls), statusFlags=flags(), covIncrement=5.0, outOfService=False,
                minPresValue=0.0, maxPresValue=CAPACITY, description="Fresh air while occupied, and for the reheat coil"),
            AVC(objectIdentifier=("analog-value", 5), objectName="Maximum airflow", presentValue=350.0, relinquishDefault=350.0,
                units=EngineeringUnits(ls), statusFlags=flags(), covIncrement=5.0, outOfService=False,
                minPresValue=0.0, maxPresValue=CAPACITY, description="Full cooling"),
            AV(objectIdentifier=("analog-value", 6), objectName="Airflow setpoint", presentValue=round(z.flow_sp, 1),
               units=EngineeringUnits(ls), statusFlags=flags(), covIncrement=5.0, outOfService=False,
               description="From the cooling loop, between the minimum and maximum airflow"),
            AO(objectIdentifier=("analog-output", 1), objectName="Damper", presentValue=0.0, relinquishDefault=0.0,
               units=EngineeringUnits("percent"), statusFlags=flags(), covIncrement=1.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Damper actuator, 90 s end to end"),
            AO(objectIdentifier=("analog-output", 2), objectName="Reheat valve", presentValue=0.0, relinquishDefault=0.0,
               units=EngineeringUnits("percent"), statusFlags=flags(), covIncrement=1.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Hot water reheat coil, 0-10 V"),
            BI(objectIdentifier=("binary-input", 1), objectName="Presence detector", presentValue="inactive",
               polarity=Polarity("normal"), statusFlags=flags(), activeText="Present", inactiveText="Empty", outOfService=False,
               reliability=Reliability("no-fault-detected")),
            BVC(objectIdentifier=("binary-value", 1), objectName="Occupancy", presentValue="active", relinquishDefault="inactive",
                statusFlags=flags(), activeText="Occupied", inactiveText="Unoccupied", outOfService=False,
                description="Written by the occupancy schedule at priority 12"),
            MSVC(objectIdentifier=("multi-state-value", 1), objectName="Operating mode", presentValue=1, relinquishDefault=1,
                 numberOfStates=3, stateText=ArrayOf(CharacterString)(MODES), statusFlags=flags(), outOfService=False,
                 description="The controller sets this at priority 16 from occupancy and presence"),
            loop(1, "Cooling loop", ("analog-input", 1), c, ("analog-value", 3), ("analog-value", 6), "direct"),
            loop(2, "Heating loop", ("analog-input", 1), c, ("analog-value", 3), ("analog-output", 2), "reverse"),
            loop(3, "Airflow loop", ("analog-input", 3), ls, ("analog-value", 6), ("analog-output", 1), "reverse"),
            NC(objectIdentifier=("notification-class", 1), objectName="Comfort alarms", notificationClass=1,
               priority=ArrayOf(Unsigned, _length=3)([64, 64, 200]), ackRequired=EventTransitionBits([1, 1, 0]),
               recipientList=ListOf(Destination)([])),
            NC(objectIdentifier=("notification-class", 2), objectName="Maintenance", notificationClass=2,
               priority=ArrayOf(Unsigned, _length=3)([120, 120, 200]), ackRequired=EventTransitionBits([0, 0, 0]),
               recipientList=ListOf(Destination)([])),
            holidays(time.time()),
            occupancy_schedule(),
        ]
        objs += trend_logs([
            ("Zone temperature log", ref("analog-input", 1)),
            ("Airflow log", ref("analog-input", 3)),
            ("Damper log", ref("analog-output", 1)),
            ("Reheat valve log", ref("analog-output", 2)),
        ], ("Zone log", [ref("analog-input", 1), ref("analog-value", 3), ref("analog-input", 3), ref("analog-value", 6), ref("analog-output", 1), ref("analog-output", 2)]))
        return objs

    async def tick(self, now: float) -> None:
        d, o, z = self.dev, self.dev.obj, self.zone
        occupied = str(o("binary-value,1").presentValue) == "active"
        if self.auto_people:
            z.people = zone_people(now)

        mode_obj = o("multi-state-value,1")
        await mode_obj.write_property("presentValue", Unsigned(1 if occupied and z.people else 2 if occupied else 3), priority=16)
        mode = MODES[int(mode_obj.presentValue) - 1]

        damper_cmd = d.held(o("analog-output,1"))
        reheat_cmd = d.held(o("analog-output,2"))
        z.step(now, d.speed, Inputs(
            setpoint=float(o("analog-value,1").presentValue),
            offset=float(o("analog-value,2").presentValue),
            mode=mode,
            min_flow=float(o("analog-value,4").presentValue),
            max_flow=float(o("analog-value,5").presentValue),
            damper_cmd=float(damper_cmd) if damper_cmd is not None else None,
            reheat_cmd=float(reheat_cmd) if reheat_cmd is not None else None,
            stuck=d.faults["damper"],
        ))

        # the loops' outputs go to the actuators at priority 16
        await o("analog-output,1").write_property("presentValue", Real(z.damper_cmd), priority=16)
        await o("analog-output,2").write_property("presentValue", Real(z.heat_loop), priority=16)

        sensor = o("analog-input,1")
        if not sensor.outOfService:
            if d.faults["sensor"]:
                sensor.reliability = Reliability("open-loop")
                sensor.presentValue = Real(-50.0)
            else:
                if str(sensor.reliability) != "no-fault-detected":
                    sensor.reliability = Reliability("no-fault-detected")
                sensor.presentValue = Real(round(z.temp, 2))
        for key, value in (("analog-input,2", round(z.discharge, 1)), ("analog-input,3", round(z.flow, 1)), ("analog-input,4", round(z.pressure))):
            if not o(key).outOfService:
                o(key).presentValue = Real(value)
        presence = o("binary-input,1")
        if not presence.outOfService:
            presence.presentValue = Enumerated(1 if z.people > 0 else 0)
        o("analog-value,3").presentValue = Real(z.effective_setpoint)
        o("analog-value,6").presentValue = Real(z.flow_sp)
        for n, value, cv, sp in ((1, z.cool_loop, float(sensor.presentValue), z.cool_sp), (2, z.heat_loop, float(sensor.presentValue), z.heat_sp),
                                 (3, z.damper_cmd, round(z.flow, 1), z.flow_sp)):
            lp = o(f"loop,{n}")
            lp.presentValue = Real(value)
            lp.controlledVariableValue = Real(cv)
            lp.setpoint = Real(sp)

    def offline(self, now: float) -> None:
        # no controller: the damper and valve stay where they were, and the zone carries on
        self.zone.step(now, self.dev.speed, Inputs(mode="Unoccupied", damper_cmd=self.zone.damper, reheat_cmd=0, stuck=True))

    def state(self) -> dict:
        z = self.zone
        return {"zone": {"temp": round(z.temp, 2), "people": z.people, "autoPeople": self.auto_people, "outside": round(z.outside, 1),
                         "outsideOverride": z.outside_override, "pressure": round(z.pressure), "pressureOverride": z.pressure_override,
                         "flow": round(z.flow, 1), "flowSp": z.flow_sp, "damper": round(z.damper, 1), "damperCmd": z.damper_cmd,
                         "reheat": z.reheat, "heatLoop": z.heat_loop, "coolLoop": z.cool_loop, "discharge": round(z.discharge, 1),
                         "heatSp": round(z.heat_sp, 2), "coolSp": round(z.cool_sp, 2), "speed": self.dev.speed}}

    async def act(self, action: str, value) -> bool:
        z = self.zone
        if action == "offset":
            v = max(-3.0, min(3.0, round(float(value) * 2) / 2))
            await self.dev.write("analog-value,2", v, None, "Zone sensor")
        elif action == "people":
            self.auto_people = value is None
            if value is not None:
                z.people = max(0, min(40, int(value)))
        elif action == "pressure":
            z.pressure_override = None if value is None else max(0.0, min(600.0, float(value)))
        elif action == "outside":
            z.outside_override = None if value is None else float(value)
        elif action == "temp":
            z.temp = float(value)
        else:
            return False
        return True

    def trend(self, since: float) -> dict:
        """The zone log (trend-log-multiple 1): temperature, setpoint, airflow, airflow setpoint, damper and reheat."""
        return {"zone": [[t, *v] for _, t, v in self.dev.logs[("trend-log-multiple", 1)].records if t >= since]}
