"""RC-1, a room controller with a four-pipe fan coil: heating and cooling valves, a three-speed fan, CO2, a window
contact and presence, in a meeting room. Its room unit has keys for the setpoint, the system mode (auto changeover,
heat or cool only, fan only, off) and the fan speed.

The room is a small thermal model with no BACnet in it, so it can run ahead in time (the trend history is the model's
own past). Everything is in simulated seconds; the clock can run faster than real time for demos. The profile below it
ties the model to the controller's objects.
"""

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

from ..device import AI, AIA, AO, AV, AVC, BI, BIA, BVC, MSOC, MSVC, NC, LoopObj, Profile, flags, ir, oid, ref
from .common import holidays, occupancy_schedule, occupied_by_schedule, office_people, outdoor, trend_logs

MODES = ["Comfort", "Standby", "Economy", "Frost protection"]
FAN = ["Off", "Low", "Medium", "High"]
# what the room unit's mode and fan keys choose between
SYSTEM = ["Auto", "Heat", "Cool", "Fan only", "Off"]
FAN_MODE = ["Auto", "Low", "Medium", "High"]

# How far each mode lets the room drift from the setpoint before heating or cooling starts, in kelvin.
BAND = {"Comfort": 0.5, "Standby": 2.0, "Economy": 4.0}
FROST = 8.0


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
    system: str = "Auto"  # the room unit's mode key
    fan_mode: str = "Auto"  # the room unit's fan key


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
        if inp.mode == "Frost protection" or inp.system == "Off":  # off still keeps the room from freezing
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
        # the mode key: heat or cool only locks out the other loop; fan only and off condition nothing (off still heats
        # against frost)
        if inp.system in ("Cool", "Fan only"):
            self.heat_loop, self._i_heat = 0.0, 0.0
        if inp.system in ("Heat", "Fan only", "Off"):
            self.cool_loop, self._i_cool = 0.0, 0.0
        if self.window_open:  # window interlock: no point conditioning the street
            self.heat_loop = self.cool_loop = 0.0
            self._i_heat = self._i_cool = 0.0

        self.heat = self.heat_loop if inp.heat_cmd is None else max(0.0, min(100.0, inp.heat_cmd))
        self.cool = self.cool_loop if inp.cool_cmd is None else max(0.0, min(100.0, inp.cool_cmd))

        demand = max(self.heat, self.cool)
        auto_fan = "Off" if demand < 1 else "Low" if demand < 40 else "Medium" if demand < 75 else "High"
        if (inp.mode == "Comfort" and inp.occupied and inp.system != "Off") or inp.system == "Fan only":
            auto_fan = "Low" if auto_fan == "Off" else auto_fan  # keep air moving while the room is in use
        # the fan key fixes the speed, unless the unit is off; a BMS command on the fan output beats both
        chosen = inp.fan_mode if inp.fan_mode in FAN[1:] and inp.system != "Off" else auto_fan
        self.fan = inp.fan_cmd if inp.fan_cmd in FAN else chosen
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
        """How many people the room has at time t, used for the history and Auto presence."""
        return office_people(t)


class FCU(Profile):
    type = "fcu"
    label = "Fan coil room controller"
    prefix = "RC"
    model = "RC-1 Room controller"
    location = "Level 2, Meeting room 2.04"
    description = "Simulated room controller: heating, cooling, fan coil, CO2"
    logs = [("trend-log", 1), ("trend-log", 2), ("trend-log", 3), ("trend-log", 4), ("trend-log-multiple", 1)]
    actions = {
        "offset": {"text": "The room unit's - and +: the setpoint offset, in half steps, written at priority 16", "value": {"type": "number", "min": -3, "max": 3, "step": 0.5, "units": "K"}},
        "system": {"text": "The room unit's mode key: Auto, Heat, Cool, Fan only or Off, written at priority 16", "value": {"type": "string", "enum": SYSTEM}},
        "fan": {"text": "The room unit's fan key: Auto, Low, Medium or High, written at priority 16", "value": {"type": "string", "enum": FAN_MODE}},
        "people": {"text": "How many people are in the room; null follows the office day", "value": {"type": "integer", "min": 0, "max": 20, "null": "follow the office day"}},
        "window": {"text": "Open or close the window: the contact alarms after 5 s, and heating and cooling stop", "value": {"type": "boolean"}},
        "outside": {"text": "Fix the outside air temperature; null for a normal day", "value": {"type": "number", "units": "°C", "null": "a normal day for the time"}},
        "temp": {"text": "Set the room temperature now, e.g. 27.5 to pass the 26 °C high limit", "value": {"type": "number", "units": "°C"}},
    }
    faults = {"sensor": {"text": "Room temperature reads -50 °C with reliability open-loop", "value": {"type": "boolean"}}}

    def __init__(self, dev):
        super().__init__(dev)
        self.room = Room()
        self.auto_people = True

    def history(self, now: float) -> None:
        room = self.room = Room(temp=19.0)
        t = now - 3 * 86400
        t -= t % 900
        while t <= now:
            occ = occupied_by_schedule(t)
            room.people = room.people_by_schedule(t)
            mode = "Comfort" if occ and room.people else "Standby" if occ else "Economy"
            room.step(t, 60, Inputs(mode=mode, occupied=occ))
            if t % 900 < 60:
                self.sample(t)
            t += 60
        room.people = room.people_by_schedule(now)

    def sample(self, t: float) -> None:
        room, logs = self.room, self.dev.logs
        logs[("trend-log", 1)].add(t, round(room.temp, 2))
        logs[("trend-log", 2)].add(t, room.effective_setpoint)
        logs[("trend-log", 3)].add(t, room.heat)
        logs[("trend-log", 4)].add(t, round(room.co2))
        logs[("trend-log-multiple", 1)].add(t, [round(room.temp, 2), room.effective_setpoint, room.heat, room.cool])

    def build(self) -> list:
        r = self.room
        c = "degrees-celsius"
        now = time.time()
        objs = [
            AIA(objectIdentifier=("analog-input", 1), objectName="Room temperature", presentValue=round(r.temp, 2),
                units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, description="Wall unit sensor",
                highLimit=26.0, lowLimit=16.0, deadband=0.5, limitEnable=LimitEnable([1, 1]), outOfService=False, **ir(1, 30)),
            AI(objectIdentifier=("analog-input", 2), objectName="Outside air temperature", presentValue=round(r.outside, 1),
               units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.5, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Shared from the roof weather station"),
            AI(objectIdentifier=("analog-input", 3), objectName="Room humidity", presentValue=round(r.humidity, 1),
               units=EngineeringUnits("percent-relative-humidity"), statusFlags=flags(), covIncrement=1.0, outOfService=False,
               reliability=Reliability("no-fault-detected")),
            AIA(objectIdentifier=("analog-input", 4), objectName="Room CO2", presentValue=round(r.co2),
                units=EngineeringUnits("parts-per-million"), statusFlags=flags(), covIncrement=25.0, outOfService=False,
                highLimit=1200.0, lowLimit=0.0, deadband=100.0, limitEnable=LimitEnable([0, 1]), **ir(2, 60, (1, 0, 1))),
            AVC(objectIdentifier=("analog-value", 1), objectName="Comfort setpoint", presentValue=21.0, relinquishDefault=21.0,
                units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, outOfService=False,
                minPresValue=12.0, maxPresValue=30.0, description="Base setpoint; the room unit dial adds the offset"),
            AVC(objectIdentifier=("analog-value", 2), objectName="Setpoint offset", presentValue=0.0, relinquishDefault=0.0,
                units=EngineeringUnits("delta-degrees-kelvin"), statusFlags=flags(), covIncrement=0.1, outOfService=False,
                minPresValue=-3.0, maxPresValue=3.0, description="Set from the room unit's + and -"),
            AV(objectIdentifier=("analog-value", 3), objectName="Effective setpoint", presentValue=21.0,
               units=EngineeringUnits(c), statusFlags=flags(), covIncrement=0.1, outOfService=False),
            AO(objectIdentifier=("analog-output", 1), objectName="Heating valve", presentValue=0.0, relinquishDefault=0.0,
               units=EngineeringUnits("percent"), statusFlags=flags(), covIncrement=1.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Fan coil heating valve, 0-10 V"),
            AO(objectIdentifier=("analog-output", 2), objectName="Cooling valve", presentValue=0.0, relinquishDefault=0.0,
               units=EngineeringUnits("percent"), statusFlags=flags(), covIncrement=1.0, outOfService=False,
               reliability=Reliability("no-fault-detected"), description="Fan coil chilled water valve, 0-10 V"),
            MSOC(objectIdentifier=("multi-state-output", 1), objectName="Fan speed", presentValue=1, relinquishDefault=1,
                 numberOfStates=4, stateText=ArrayOf(CharacterString)(FAN), statusFlags=flags(), outOfService=False,
                 reliability=Reliability("no-fault-detected")),
            BIA(objectIdentifier=("binary-input", 1), objectName="Window contact", presentValue="inactive",
                polarity=Polarity("normal"), statusFlags=flags(), activeText="Open", inactiveText="Closed", outOfService=False,
                alarmValue="active", **ir(2, 5, (1, 0, 1))),
            BI(objectIdentifier=("binary-input", 2), objectName="Presence detector", presentValue="inactive",
               polarity=Polarity("normal"), statusFlags=flags(), activeText="Present", inactiveText="Empty", outOfService=False,
               reliability=Reliability("no-fault-detected")),
            BVC(objectIdentifier=("binary-value", 1), objectName="Occupancy", presentValue="active", relinquishDefault="inactive",
                statusFlags=flags(), activeText="Occupied", inactiveText="Unoccupied", outOfService=False,
                description="Written by the occupancy schedule at priority 12"),
            MSVC(objectIdentifier=("multi-state-value", 2), objectName="System mode", presentValue=1, relinquishDefault=1,
                 numberOfStates=len(SYSTEM), stateText=ArrayOf(CharacterString)(SYSTEM), statusFlags=flags(), outOfService=False,
                 description="Set from the room unit's mode key: auto changeover, heat or cool only, fan only, or off"),
            MSVC(objectIdentifier=("multi-state-value", 3), objectName="Fan mode", presentValue=1, relinquishDefault=1,
                 numberOfStates=len(FAN_MODE), stateText=ArrayOf(CharacterString)(FAN_MODE), statusFlags=flags(), outOfService=False,
                 description="Set from the room unit's fan key; Auto lets the controller choose the speed"),
            MSVC(objectIdentifier=("multi-state-value", 1), objectName="Operating mode", presentValue=1, relinquishDefault=1,
                 numberOfStates=4, stateText=ArrayOf(CharacterString)(MODES), statusFlags=flags(), outOfService=False,
                 description="The controller sets this at priority 16 from occupancy and presence"),
            LoopObj(objectIdentifier=("loop", 1), objectName="Room temperature loop", presentValue=0.0, statusFlags=flags(),
                    eventState=EventState("normal"), outOfService=False, outputUnits=EngineeringUnits("percent"),
                    manipulatedVariableReference=ObjectPropertyReference(objectIdentifier=oid("analog-output", 1), propertyIdentifier="present-value"),
                    controlledVariableReference=ObjectPropertyReference(objectIdentifier=oid("analog-input", 1), propertyIdentifier="present-value"),
                    controlledVariableValue=21.0, controlledVariableUnits=EngineeringUnits(c),
                    setpointReference=SetpointReference(setpointReference=ObjectPropertyReference(objectIdentifier=oid("analog-value", 3), propertyIdentifier="present-value")),
                    setpoint=21.0, action=Action("reverse"), priorityForWriting=16, proportionalConstant=40.0,
                    proportionalConstantUnits=EngineeringUnits("percent"), integralConstant=900.0,
                    integralConstantUnits=EngineeringUnits("seconds"), maximumOutput=100.0, minimumOutput=0.0),
            NC(objectIdentifier=("notification-class", 1), objectName="Comfort alarms", notificationClass=1,
               priority=ArrayOf(Unsigned, _length=3)([64, 64, 200]), ackRequired=EventTransitionBits([1, 1, 0]),
               recipientList=ListOf(Destination)([])),
            NC(objectIdentifier=("notification-class", 2), objectName="Maintenance", notificationClass=2,
               priority=ArrayOf(Unsigned, _length=3)([120, 120, 200]), ackRequired=EventTransitionBits([0, 0, 0]),
               recipientList=ListOf(Destination)([])),
        ]

        objs.append(holidays(now))
        objs.append(occupancy_schedule())
        objs += trend_logs([
            ("Room temperature log", ref("analog-input", 1)),
            ("Effective setpoint log", ref("analog-value", 3)),
            ("Heating valve log", ref("analog-output", 1)),
            ("Room CO2 log", ref("analog-input", 4)),
        ], ("Room log", [ref("analog-input", 1), ref("analog-value", 3), ref("analog-output", 1), ref("analog-output", 2)]))
        return objs

    async def tick(self, now: float) -> None:
        d, o, room = self.dev, self.dev.obj, self.room
        occupied = str(o("binary-value,1").presentValue) == "active"
        if self.auto_people:
            room.people = room.people_by_schedule(now)

        # the controller's own choice of mode, at priority 16; anything higher wins
        mode_obj = o("multi-state-value,1")
        auto_mode = 1 if occupied and room.people else 2 if occupied else 3
        await mode_obj.write_property("presentValue", Unsigned(auto_mode), priority=16)
        mode = MODES[int(mode_obj.presentValue) - 1]

        heat_cmd = d.held(o("analog-output,1"))
        cool_cmd = d.held(o("analog-output,2"))
        fan_held = d.held(o("multi-state-output,1"))
        inp = Inputs(
            setpoint=float(o("analog-value,1").presentValue),
            offset=float(o("analog-value,2").presentValue),
            mode=mode,
            occupied=occupied,
            heat_cmd=float(heat_cmd) if heat_cmd is not None else None,
            cool_cmd=float(cool_cmd) if cool_cmd is not None else None,
            fan_cmd=FAN[int(fan_held) - 1] if fan_held is not None else None,
            system=self._state(o("multi-state-value,2"), SYSTEM),
            fan_mode=self._state(o("multi-state-value,3"), FAN_MODE),
        )
        room.step(now, d.speed, inp)

        # the loop's outputs go to the actuators at priority 16
        await o("analog-output,1").write_property("presentValue", Real(room.heat_loop), priority=16)
        await o("analog-output,2").write_property("presentValue", Real(room.cool_loop), priority=16)
        await o("multi-state-output,1").write_property("presentValue", Unsigned(FAN.index(room.fan if fan_held is None else room.fan) + 1), priority=16)

        sensor = o("analog-input,1")
        if not sensor.outOfService:
            if d.faults["sensor"]:
                sensor.reliability = Reliability("open-loop")
                sensor.presentValue = Real(-50.0)  # what a broken NTC usually reads
            else:
                if str(sensor.reliability) != "no-fault-detected":
                    sensor.reliability = Reliability("no-fault-detected")
                sensor.presentValue = Real(round(room.temp, 2))
        for key, value in (("analog-input,2", round(room.outside, 1)), ("analog-input,3", round(room.humidity, 1)), ("analog-input,4", round(room.co2))):
            if not o(key).outOfService:
                o(key).presentValue = Real(value)
        for key, active in (("binary-input,1", room.window_open), ("binary-input,2", room.people > 0)):
            if not o(key).outOfService:
                o(key).presentValue = Enumerated(1 if active else 0)
        o("analog-value,3").presentValue = Real(room.effective_setpoint)
        loop = o("loop,1")
        loop.presentValue = Real(room.heat_loop)
        loop.controlledVariableValue = Real(float(sensor.presentValue))
        loop.setpoint = Real(room.heat_sp)

    def offline(self, now: float) -> None:
        # no controller: the valves close and the fan stops, but the room carries on getting warmer or colder
        self.room.step(now, self.dev.speed, Inputs(heat_cmd=0, cool_cmd=0, fan_cmd="Off", mode="Comfort", occupied=False))

    @staticmethod
    def _state(obj, names: list[str]) -> str:
        i = int(obj.presentValue) - 1
        return names[i] if 0 <= i < len(names) else names[0]

    def state(self) -> dict:
        r = self.room
        o = self.dev.obj
        return {"room": {"temp": round(r.temp, 2), "humidity": round(r.humidity, 1), "co2": round(r.co2), "people": r.people,
                         "autoPeople": self.auto_people, "window": r.window_open, "outside": round(r.outside, 1),
                         "outsideOverride": r.outside_override, "heat": r.heat, "cool": r.cool, "heatLoop": r.heat_loop,
                         "coolLoop": r.cool_loop, "fan": r.fan, "heatSp": round(r.heat_sp, 2), "coolSp": round(r.cool_sp, 2),
                         "speed": self.dev.speed, "system": self._state(o("multi-state-value,2"), SYSTEM),
                         "fanMode": self._state(o("multi-state-value,3"), FAN_MODE)}}

    async def act(self, action: str, value) -> bool:
        r = self.room
        if action == "offset":  # the room unit's + and -
            v = max(-3.0, min(3.0, round(float(value) * 2) / 2))
            await self.dev.write("analog-value,2", v, None, "Room unit")
        elif action in ("system", "fan"):  # the room unit's mode and fan keys
            names, key = (SYSTEM, "multi-state-value,2") if action == "system" else (FAN_MODE, "multi-state-value,3")
            if isinstance(value, str):
                match = [n for n in names if n.lower() == value.strip().lower()]
                if not match:
                    raise ValueError(f"{action} is one of {', '.join(names)}")
                index = names.index(match[0]) + 1
            else:
                index = int(value)
                if not 1 <= index <= len(names):
                    raise ValueError(f"{action} is 1 to {len(names)}")
            await self.dev.write(key, index, None, "Room unit")
        elif action == "people":
            self.auto_people = value is None
            if value is not None:
                r.people = max(0, min(20, int(value)))
        elif action == "window":
            r.window_open = bool(value)
            self.dev.log("Room", "Window", "Opened" if r.window_open else "Closed", kind="local", obj="binary-input,1")
        elif action == "outside":
            r.outside_override = None if value is None else float(value)
        elif action == "temp":  # nudge the room, e.g. to test an alarm without waiting
            r.temp = float(value)
        else:
            return False
        return True

    def trend(self, since: float) -> dict:
        """The room log (trend-log-multiple 1) and the CO2 log, as the device itself holds them."""
        room = self.dev.logs[("trend-log-multiple", 1)].records
        co2 = self.dev.logs[("trend-log", 4)].records
        return {
            "room": [[t, *v] for _, t, v in room if t >= since],
            "co2": [[t, v] for _, t, v in co2 if t >= since],
        }
