"""The simulated room controller: its BACnet objects, the services a real controller answers, and the loop that ties
the room model to the objects.

Everything a BMS or a scanner does to the device lands in the activity log, and every write is remembered per object
(who, when, at what priority), so the UI can show the device being worked on.
"""

import asyncio
import ctypes
import ipaddress
import os
import random
import time
from collections import deque

from bacpypes3.apdu import (
    AcknowledgeAlarmRequest,
    DeviceCommunicationControlRequest,
    GetAlarmSummaryACK,
    GetAlarmSummaryRequest,
    GetEventInformationACK,
    GetEventInformationRequest,
    ReadPropertyMultipleRequest,
    ReadPropertyRequest,
    ReadRangeRequest,
    ReinitializeDeviceRequest,
    SimpleAckPDU,
    SubscribeCOVRequest,
    ConfirmedServiceChoice,
    TimeSynchronizationRequest,
    UnconfirmedServiceChoice,
    UTCTimeSynchronizationRequest,
    WhoHasRequest,
    WhoIsRequest,
    WritePropertyMultipleRequest,
    WritePropertyRequest,
    confirmed_request_types,
    unconfirmed_request_types,
)
from bacpypes3.app import Application
from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.basetypes import (
    Action,
    CalendarEntry,
    DailySchedule,
    DateRange,
    DateTime,
    Destination,
    DeviceObjectPropertyReference,
    EngineeringUnits,
    EventState,
    EventTransitionBits,
    GetAlarmSummaryAlarmSummary,
    GetEventInformationEventSummary,
    LimitEnable,
    NotifyType,
    ObjectPropertyReference,
    ObjectTypesSupported,
    Polarity,
    PriorityValue,
    Reliability,
    ServicesSupported,
    SetpointReference,
    SpecialEvent,
    SpecialEventPeriod,
    StatusFlags,
    TimeStamp,
    TimeValue,
)
from bacpypes3.constructeddata import ArrayOf, ListOf
from bacpypes3.errors import ExecutionError
from bacpypes3.local.analog import AnalogInputObject, AnalogInputObjectIR, AnalogOutputObject, AnalogValueObject
from bacpypes3.local.binary import BinaryInputObject, BinaryInputObjectIR, BinaryValueObject
from bacpypes3.local.cmd import Commandable
from bacpypes3.local.cov import COVIncrementCriteria, GenericCriteria
from bacpypes3.local.multistate import MultiStateOutputObject, MultiStateValueObject
from bacpypes3.local.object import Object as _Local
from bacpypes3.object import (
    CalendarObject,
    LoopObject,
    NotificationClassObject,
    ScheduleObject,
    TrendLogMultipleObject,
    TrendLogObject,
)
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import (
    CharacterString,
    Date,
    Enumerated,
    Null,
    ObjectIdentifier,
    Real,
    Time,
    Unsigned,
)

from .model import FAN, MODES, Inputs, Room, occupied_by_schedule
from .trendlogs import Log, stamp

VENDOR_ID = 999

# Properties anyone may write on any object, as on most controllers. Everything else needs the object's own list.
ALWAYS_WRITABLE = {"description", "outOfService"}


class Guard:
    """Refuse writes a real controller would refuse: read-only properties, and inputs that are not out of service."""

    _writable: tuple[str, ...] = ()

    async def write_property(self, attr, value, index=None, priority=None):
        name = attr if isinstance(attr, str) else self._property_identifier_class(attr).attr
        allowed = name in ALWAYS_WRITABLE or name in self._writable
        if name == "presentValue" and getattr(self, "outOfService", False):
            allowed = True  # clause 12: an out-of-service input takes its value from whoever writes it
        if not allowed:
            raise ExecutionError(errorClass="property", errorCode="write-access-denied")
        if index is None and not (name == "presentValue" and isinstance(self, Commandable)):
            # bacpypes3's write path skips the property monitors, so COV and alarm detection would never see the
            # change; a plain assignment goes through them
            setattr(self, name, value)
            return
        await super().write_property(attr, value, index, priority)


class _LiveFlags:
    """bacpypes3 works status-flags out from event-state, reliability and out-of-service on every read, so nothing ever
    changes the statusFlags the COV detection watches: it would report the flags as they were when it was made. Read
    them live instead, and watch the three properties they come from so a change in any of them is notified."""

    @property
    def statusFlags(self):
        return self.obj.statusFlags

    @statusFlags.setter
    def statusFlags(self, value):
        pass


class IncrementCOV(_LiveFlags, COVIncrementCriteria):
    properties_tracked = COVIncrementCriteria.properties_tracked + ("eventState", "reliability", "outOfService")


class ChangeCOV(_LiveFlags, GenericCriteria):
    properties_tracked = GenericCriteria.properties_tracked + ("eventState", "reliability", "outOfService")


ALARM = ("highLimit", "lowLimit", "deadband", "limitEnable", "timeDelay", "notificationClass", "eventEnable", "covIncrement")


class AI(Guard, AnalogInputObject):
    _cov_criteria = IncrementCOV
    _writable = ("covIncrement",)


class AIA(Guard, AnalogInputObjectIR):
    _cov_criteria = IncrementCOV
    _writable = ALARM


class AO(Guard, AnalogOutputObject):
    _cov_criteria = IncrementCOV
    _writable = ("presentValue", "relinquishDefault", "covIncrement")


class AVC(Guard, Commandable, AnalogValueObject):
    _cov_criteria = IncrementCOV
    _writable = ("presentValue", "relinquishDefault", "covIncrement")


class AV(Guard, AnalogValueObject):
    _cov_criteria = IncrementCOV
    _writable = ()


class BI(Guard, BinaryInputObject):
    _cov_criteria = ChangeCOV


class BIA(Guard, BinaryInputObjectIR):
    _cov_criteria = ChangeCOV
    _writable = ("timeDelay", "notificationClass", "eventEnable", "alarmValue")


class BVC(Guard, Commandable, BinaryValueObject):
    _cov_criteria = ChangeCOV
    _writable = ("presentValue", "relinquishDefault")


class MSVC(Guard, Commandable, MultiStateValueObject):
    # bacpypes3 gives multistate objects COVIncrementCriteria, which needs a covIncrement they don't have: the
    # subscription fails half made, and the monitor it leaves behind breaks every later present-value change
    _cov_criteria = ChangeCOV
    _writable = ("presentValue", "relinquishDefault")


class MSOC(Guard, MultiStateOutputObject):
    _cov_criteria = ChangeCOV
    _writable = ("presentValue", "relinquishDefault")


class _Plain(Guard, _Local):
    async def _post_init(self):
        pass  # no notification-class link: these objects don't report events themselves


class NC(_Plain, NotificationClassObject):
    _writable = ("priority", "ackRequired", "recipientList")


class Cal(_Plain, CalendarObject):
    _writable = ("dateList",)


class Sched(_Plain, ScheduleObject):
    _writable = ("weeklySchedule", "exceptionSchedule", "scheduleDefault", "effectivePeriod")


class TL(_Plain, TrendLogObject):
    _writable = ("enable", "recordCount", "logInterval", "stopWhenFull")


class TLM(_Plain, TrendLogMultipleObject):
    _writable = ("enable", "recordCount", "logInterval", "stopWhenFull")


class LoopObj(_Plain, LoopObject):
    _writable = ("proportionalConstant", "integralConstant")


def ts(t: float | None) -> TimeStamp:
    if t is None:
        return TimeStamp(dateTime=DateTime(date=Date((255, 255, 255, 255)), time=Time((255, 255, 255, 255))))
    return TimeStamp(dateTime=stamp(t))


def tv(h: int, m: int, value) -> TimeValue:
    return TimeValue(time=Time((h, m, 0, 0)), value=value)


def flags(*bits) -> StatusFlags:
    return StatusFlags(list(bits) + [0] * (4 - len(bits)))


def oid(kind: str, n: int) -> ObjectIdentifier:
    return ObjectIdentifier((kind, n))


def ref(kind: str, n: int, prop: str = "present-value") -> DeviceObjectPropertyReference:
    return DeviceObjectPropertyReference(objectIdentifier=oid(kind, n), propertyIdentifier=prop)


def ir(nc: int, delay: int = 10, enable=(1, 1, 1)) -> dict:
    """The properties intrinsic reporting needs, starting in normal with nothing to acknowledge."""
    return dict(
        eventState=EventState("normal"),
        eventEnable=EventTransitionBits(list(enable)),
        ackedTransitions=EventTransitionBits([1, 1, 1]),
        notificationClass=nc,
        notifyType=NotifyType("alarm"),
        timeDelay=delay,
        eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(None), ts(None), ts(None)]),
        eventDetectionEnable=True,
        reliability=Reliability("no-fault-detected"),
    )


def date_matches(d, day: time.struct_time) -> bool:
    """A BACnet date with wildcards (255), odd/even months (13/14) and last day of month (32)."""
    year, month, dom, dow = tuple(d)
    if year != 255 and year + 1900 != day.tm_year:
        return False
    if month == 13 and day.tm_mon % 2 == 0 or month == 14 and day.tm_mon % 2 == 1:
        return False
    if month not in (255, 13, 14) and month != day.tm_mon:
        return False
    if dom == 32:
        nxt = time.localtime(time.mktime(day) + 86400)
        if nxt.tm_mon == day.tm_mon:
            return False
    elif dom != 255 and dom != day.tm_mday:
        return False
    if dow != 255 and dow != day.tm_wday + 1:
        return False
    return True


def entry_matches(e: CalendarEntry, day: time.struct_time) -> bool:
    if e.date is not None:
        return date_matches(e.date, day)
    if e.dateRange is not None:
        lo, hi = tuple(e.dateRange.startDate), tuple(e.dateRange.endDate)
        key = (day.tm_year - 1900, day.tm_mon, day.tm_mday)
        return (lo[0] == 255 or key >= lo[:3]) and (hi[0] == 255 or key <= hi[:3])
    if e.weekNDay is not None:
        month, week, dow = bytes(e.weekNDay)
        if month != 255 and month != day.tm_mon:
            return False
        if week != 255 and week != (day.tm_mday - 1) // 7 + 1:
            return False
        return dow == 255 or dow == day.tm_wday + 1
    return False


def to_py(v):
    """A BACnet primitive as plain JSON-friendly Python."""
    if v is None:
        return None
    if isinstance(v, Null):
        return None
    if isinstance(v, Enumerated):
        return str(v)
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return round(float(v), 3)
    if isinstance(v, int):
        return int(v)
    return str(v)


def kind_of(objid) -> str:
    return str(objid[0])


SERVICE = {
    "ReadPropertyRequest": ("Read", "read"),
    "ReadPropertyMultipleRequest": ("Read multiple", "read"),
    "WritePropertyRequest": ("Write", "write"),
    "WritePropertyMultipleRequest": ("Write multiple", "write"),
    "SubscribeCOVRequest": ("Subscribe COV", "cov"),
    "SubscribeCOVPropertyRequest": ("Subscribe COV property", "cov"),
    "ReadRangeRequest": ("Read range", "read"),
    "WhoIsRequest": ("Who-Is", "discovery"),
    "WhoHasRequest": ("Who-Has", "discovery"),
    "AcknowledgeAlarmRequest": ("Acknowledge alarm", "alarm"),
    "GetEventInformationRequest": ("Get event information", "alarm"),
    "GetAlarmSummaryRequest": ("Get alarm summary", "alarm"),
    "GetEnrollmentSummaryRequest": ("Get enrollment summary", "alarm"),
    "DeviceCommunicationControlRequest": ("Communication control", "device"),
    "ReinitializeDeviceRequest": ("Reinitialize", "device"),
    "TimeSynchronizationRequest": ("Time sync", "device"),
    "UTCTimeSynchronizationRequest": ("UTC time sync", "device"),
}


class RasherApp(Application):
    owner: "RoomController"

    async def indication(self, apdu) -> None:
        o = self.owner
        name = apdu.__class__.__name__
        if name == "IAmRequest":
            await super().indication(apdu)  # other devices announcing themselves: not worth a log line
            return
        source = str(apdu.pduSource)
        if o.offline_reason():
            o.log(source, name, "Ignored: the device is " + o.offline_reason(), kind="dropped")
            return
        if o.dcc != "enable" and name not in ("DeviceCommunicationControlRequest", "ReinitializeDeviceRequest"):
            o.log(source, name, "Ignored: communication disabled by Device Communication Control", kind="dropped")
            return
        if o.faults["flaky"] and random.random() < 0.3:
            o.log(source, name, "Dropped (flaky link)", kind="dropped")
            return
        if o.faults["slow"]:
            await asyncio.sleep(o.faults["slow"] / 1000)
        o.record(source, apdu)
        try:
            await super().indication(apdu)
        finally:
            if isinstance(apdu, (WritePropertyRequest, WritePropertyMultipleRequest)):
                o.after_write(apdu)

    def get_services_supported(self) -> ServicesSupported:
        """bacpypes3's own version names the unconfirmed services through the confirmed enumeration, so Who-Is shows up
        as add-list-element and Time Sync as atomic-read-file; this is the same introspection with the right names."""
        ss = ServicesSupported([])
        for choices, types in ((ConfirmedServiceChoice, confirmed_request_types), (UnconfirmedServiceChoice, unconfirmed_request_types)):
            for choice, cls in types.items():
                if hasattr(self, "do_" + cls.__name__):
                    ss[getattr(ss, choices(choice).attr)] = 1
        return ss

    # ---- services bacpypes3 leaves to the application ----------------------

    async def do_ReadRangeRequest(self, apdu: ReadRangeRequest) -> None:
        log = self.owner.logs.get((kind_of(apdu.objectIdentifier), apdu.objectIdentifier[1]))
        if log is None:
            raise ExecutionError(errorClass="property", errorCode="property-is-not-a-list")
        await self.response(log.ack(apdu))

    async def do_GetEventInformationRequest(self, apdu: GetEventInformationRequest) -> None:
        summaries = []
        for obj in self.owner.event_objects():
            state, acked = obj.eventState, obj.ackedTransitions
            if int(state) == 0 and all(acked):
                continue
            summaries.append(GetEventInformationEventSummary(
                objectIdentifier=obj.objectIdentifier, eventState=state, acknowledgedTransitions=acked,
                eventTimeStamps=list(obj.eventTimeStamps), notifyType=obj.notifyType, eventEnable=obj.eventEnable,
                eventPriorities=self.owner.priorities(obj),
            ))
        await self.response(GetEventInformationACK(context=apdu, listOfEventSummaries=summaries, moreEvents=False))

    async def do_GetAlarmSummaryRequest(self, apdu: GetAlarmSummaryRequest) -> None:
        items = [
            GetAlarmSummaryAlarmSummary(objectIdentifier=o.objectIdentifier, alarmState=o.eventState, acknowledgedTransitions=o.ackedTransitions)
            for o in self.owner.event_objects()
            if int(o.eventState) != 0 and str(o.notifyType) == "alarm"
        ]
        await self.response(GetAlarmSummaryACK(context=apdu, listOfAlarmSummaries=items))

    async def do_AcknowledgeAlarmRequest(self, apdu: AcknowledgeAlarmRequest) -> None:
        obj = self.get_object_id(apdu.eventObjectIdentifier)
        if obj is None or getattr(obj, "ackedTransitions", None) is None:
            raise ExecutionError(errorClass="object", errorCode="unknown-object")
        self.owner.acknowledge(obj, str(apdu.eventStateAcknowledged), str(apdu.acknowledgmentSource or apdu.pduSource))
        await self.response(SimpleAckPDU(context=apdu))

    async def do_DeviceCommunicationControlRequest(self, apdu: DeviceCommunicationControlRequest) -> None:
        self.owner.set_dcc(str(apdu.enableDisable), int(apdu.timeDuration) if apdu.timeDuration is not None else None)
        await self.response(SimpleAckPDU(context=apdu))

    async def do_ReinitializeDeviceRequest(self, apdu: ReinitializeDeviceRequest) -> None:
        state = str(apdu.reinitializedStateOfDevice)
        await self.response(SimpleAckPDU(context=apdu))
        if state in ("coldstart", "warmstart"):
            self.owner.restart(state)

    async def do_TimeSynchronizationRequest(self, apdu: TimeSynchronizationRequest) -> None:
        self.owner.time_sync(apdu.time, utc=False)

    async def do_UTCTimeSynchronizationRequest(self, apdu: UTCTimeSynchronizationRequest) -> None:
        self.owner.time_sync(apdu.time, utc=True)


def _object_types(dev) -> ObjectTypesSupported:
    """Bacpypes3's device object reports no object types at all; these are the ones the device actually has."""
    bits = ObjectTypesSupported([])
    for objid in (dev._app.objectIdentifier if dev._app else [dev.objectIdentifier]):
        bits[int(objid[0])] = 1
    return bits


class RoomController:
    def __init__(self, ip: str, prefix: int, port: int, instance: int, name: str, iam_to: str = "peers"):
        self.ip, self.prefix, self.port, self.instance, self.name = ip, prefix, port, instance, name
        self.iam_to = iam_to  # who else hears each I-Am, beyond the broadcast: "peers", "none", or addresses
        self.app: RasherApp | None = None
        self.room = Room()
        self.speed = 1
        self.auto_people = True
        self.faults = {"slow": 0, "flaky": False, "sensor": False}
        self.powered = True
        self.dcc = "enable"
        self.dcc_until: float | None = None
        self.restart_until = 0.0
        self.clock_offset = 0.0
        self.last_sync: dict | None = None
        self.activity: deque[dict] = deque(maxlen=10000)
        self.next_id = 1
        self.writes: dict[str, dict] = {}
        self.reads: dict[str, dict] = {}
        self.peers: dict[str, dict] = {}
        self.logs: dict[tuple[str, int], Log] = {}
        self.objs: dict[str, object] = {}
        self.started = 0.0
        self._task: asyncio.Task | None = None
        self._storm: asyncio.Task | None = None
        self._last_log = 0.0

    # ---- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        args = SimpleArgumentParser().parse_args([
            "--address", f"{self.ip}/{self.prefix}:{self.port}", "--instance", str(self.instance),
            "--name", self.name, "--vendoridentifier", str(VENDOR_ID),
        ])
        self.history()
        app = RasherApp.from_args(args)
        app.owner = self
        dev = app.device_object
        dev.__class__ = type("RasherDevice", (type(dev),), {"protocolObjectTypesSupported": property(_object_types, lambda self, v: None)})
        dev.vendorName = "Rasher"
        dev.modelName = "RC-1 Room controller"
        dev.firmwareRevision = "1.0"
        dev.applicationSoftwareVersion = "Rasher 0.1"
        dev.location = "Level 2, Meeting room 2.04"
        dev.description = "Simulated room controller: heating, cooling, fan coil, CO2"
        for obj in self.build():
            app.add_object(obj)
            self.objs[str(obj.objectIdentifier)] = obj
        self.app = app
        await self.ignore_port_unreachable()
        self.started = time.time()
        self.sync_logs()
        self._task = asyncio.create_task(self.run())
        self.log("Rasher", "Start", f"Online at {self.ip}:{self.port} as device {self.instance}", kind="local")
        self.i_am()  # announce, like a controller that just booted

    async def ignore_port_unreachable(self) -> None:
        """On Windows a datagram to a port nobody is listening on (a BMS that has gone, still subscribed or still a
        peer) comes back as an error on the next receive, and asyncio then stops reading the socket for good: the
        device goes deaf. Turn that report off (SIO_UDP_CONNRESET, which Python's socket.ioctl doesn't offer)."""
        if os.name != "nt":
            return
        wsa_ioctl = ctypes.windll.ws2_32.WSAIoctl
        wsa_ioctl.argtypes = [ctypes.c_size_t, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p,
                              ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p, ctypes.c_void_p]
        for link in self.app.link_layers.values():
            server = getattr(link, "server", None)
            for _ in range(50):  # bacpypes3 opens the socket in a task of its own
                if server is None or server.local_transport is not None:
                    break
                await asyncio.sleep(0.02)
            transport = getattr(server, "local_transport", None)
            if transport is not None:
                off, done = ctypes.c_uint32(0), ctypes.c_uint32()
                wsa_ioctl(transport.get_extra_info("socket").fileno(), 0x9800000C, ctypes.byref(off), 4, None, 0, ctypes.byref(done), None, None)

    async def stop(self) -> None:
        for task in (self._task, self._storm):
            if task:
                task.cancel()
        if self.app:
            self.app.close()
        self.app = None

    # ---- objects -----------------------------------------------------------

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

        year = time.localtime(now).tm_year - 1900
        objs.append(Cal(
            objectIdentifier=("calendar", 1), objectName="Public holidays", presentValue=False,
            dateList=ListOf(CalendarEntry)([
                CalendarEntry(date=Date((255, 1, 1, 255))),
                CalendarEntry(date=Date((255, 12, 25, 255))),
                CalendarEntry(date=Date((255, 12, 26, 255))),
                CalendarEntry(dateRange=DateRange(startDate=Date((year, 12, 27, 255)), endDate=Date((year, 12, 31, 255)))),
            ]),
        ))
        on, off = Enumerated(1), Enumerated(0)
        week = [DailySchedule(daySchedule=[tv(7, 0, on), tv(18, 0, off)]) for _ in range(5)] + [
            DailySchedule(daySchedule=[tv(8, 0, on), tv(12, 0, off)]),
            DailySchedule(daySchedule=[]),
        ]
        objs.append(Sched(
            objectIdentifier=("schedule", 1), objectName="Occupancy schedule", presentValue=on,
            description="Office hours, Saturday morning",
            effectivePeriod=DateRange(startDate=Date((255, 255, 255, 255)), endDate=Date((255, 255, 255, 255))),
            weeklySchedule=ArrayOf(DailySchedule, _length=7)(week),
            exceptionSchedule=ArrayOf(SpecialEvent)([
                SpecialEvent(period=SpecialEventPeriod(calendarReference=oid("calendar", 1)), listOfTimeValues=[tv(0, 0, off)], eventPriority=1),
            ]),
            scheduleDefault=off, priorityForWriting=12, statusFlags=flags(), reliability=Reliability("no-fault-detected"),
            outOfService=False, listOfObjectPropertyReferences=ListOf(DeviceObjectPropertyReference)([ref("binary-value", 1)]),
        ))

        tl = dict(
            enable=True, stopWhenFull=False, bufferSize=5000, logInterval=6000, statusFlags=flags(),
            eventState=EventState("normal"), loggingType="polled", alignIntervals=True, intervalOffset=0,
            notificationThreshold=1000, recordsSinceNotification=0, lastNotifyRecord=0, eventEnable=EventTransitionBits([0, 0, 0]),
            ackedTransitions=EventTransitionBits([1, 1, 1]), notifyType=NotifyType("event"),
            eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(None), ts(None), ts(None)]), notificationClass=2,
            recordCount=0, totalRecordCount=0,
        )
        for n, (name, src) in enumerate([
            ("Room temperature log", ref("analog-input", 1)),
            ("Effective setpoint log", ref("analog-value", 3)),
            ("Heating valve log", ref("analog-output", 1)),
            ("Room CO2 log", ref("analog-input", 4)),
        ], start=1):
            objs.append(TL(objectIdentifier=("trend-log", n), objectName=name, logDeviceObjectProperty=src, trigger=False, **tl))
        objs.append(TLM(
            objectIdentifier=("trend-log-multiple", 1), objectName="Room log",
            logDeviceObjectProperty=ArrayOf(DeviceObjectPropertyReference)([
                ref("analog-input", 1), ref("analog-value", 3), ref("analog-output", 1), ref("analog-output", 2),
            ]),
            **tl,
        ))
        return objs

    def obj(self, key: str):
        return self.objs.get(key)

    def event_objects(self) -> list:
        return [o for o in self.objs.values() if getattr(o, "ackedTransitions", None) is not None and kind_of(o.objectIdentifier) not in ("trend-log", "trend-log-multiple")]

    def priorities(self, obj) -> list[int]:
        nc = next((o for o in self.objs.values() if isinstance(o, NC) and o.notificationClass == obj.notificationClass), None)
        return [int(x) for x in nc.priority] if nc else [0, 0, 0]

    # ---- history -----------------------------------------------------------

    def history(self) -> None:
        """Run the room through the last three days so the trend logs open with history, then carry on from there."""
        room = Room(temp=19.0)
        self.logs = {(k, n): Log((k, n), multiple=k == "trend-log-multiple") for k, n in [
            ("trend-log", 1), ("trend-log", 2), ("trend-log", 3), ("trend-log", 4), ("trend-log-multiple", 1)]}
        now = time.time()
        t = now - 3 * 86400
        t -= t % 900
        while t <= now:
            occ = occupied_by_schedule(t)
            room.people = room.people_by_schedule(t)
            mode = "Comfort" if occ and room.people else "Standby" if occ else "Economy"
            room.step(t, 60, Inputs(mode=mode, occupied=occ))
            if t % 900 < 60:
                self.sample(room, t)
            t += 60
        room.people = room.people_by_schedule(now)
        self.room = room

    def sample(self, room: Room, t: float) -> None:
        self.logs[("trend-log", 1)].add(t, round(room.temp, 2))
        self.logs[("trend-log", 2)].add(t, room.effective_setpoint)
        self.logs[("trend-log", 3)].add(t, room.heat)
        self.logs[("trend-log", 4)].add(t, round(room.co2))
        self.logs[("trend-log-multiple", 1)].add(t, [round(room.temp, 2), room.effective_setpoint, room.heat, room.cool])

    def sync_logs(self) -> None:
        for key, log in self.logs.items():
            o = self.obj(f"{key[0]},{key[1]}")
            if o is not None:
                o.recordCount = len(log.records)
                o.totalRecordCount = log.next_seq - 1

    # ---- the control loop --------------------------------------------------

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as err:  # keep the device alive whatever one tick does
                self.log("Rasher", "Error", f"Tick failed: {err!r}", kind="dropped")
            await asyncio.sleep(1)

    def held(self, obj, below: int = 16):
        """The present value when something above the controller's own priority holds the point, else None."""
        ccp = obj.currentCommandPriority
        p = getattr(ccp, "unsigned", None) if ccp is not None else None
        return obj.presentValue if p is not None and p < below else None

    async def tick(self) -> None:
        now = time.time()
        if self.dcc_until and now >= self.dcc_until:
            self.set_dcc("enable", None)
        o = self.obj
        room = self.room
        if self.offline_reason():
            # no controller: the valves close and the fan stops, but the room carries on getting warmer or colder
            room.step(now, self.speed, Inputs(heat_cmd=0, cool_cmd=0, fan_cmd="Off", mode="Comfort", occupied=False))
            return

        await self.run_schedule(now)
        occupied = str(o("binary-value,1").presentValue) == "active"
        if self.auto_people:
            room.people = room.people_by_schedule(now)

        # the controller's own choice of mode, at priority 16; anything higher wins
        mode_obj = o("multi-state-value,1")
        auto_mode = 1 if occupied and room.people else 2 if occupied else 3
        await mode_obj.write_property("presentValue", Unsigned(auto_mode), priority=16)
        mode = MODES[int(mode_obj.presentValue) - 1]

        heat_cmd = self.held(o("analog-output,1"))
        cool_cmd = self.held(o("analog-output,2"))
        fan_held = self.held(o("multi-state-output,1"))
        inp = Inputs(
            setpoint=float(o("analog-value,1").presentValue),
            offset=float(o("analog-value,2").presentValue),
            mode=mode,
            occupied=occupied,
            heat_cmd=float(heat_cmd) if heat_cmd is not None else None,
            cool_cmd=float(cool_cmd) if cool_cmd is not None else None,
            fan_cmd=FAN[int(fan_held) - 1] if fan_held is not None else None,
        )
        room.step(now, self.speed, inp)

        # the loop's outputs go to the actuators at priority 16
        await o("analog-output,1").write_property("presentValue", Real(room.heat_loop), priority=16)
        await o("analog-output,2").write_property("presentValue", Real(room.cool_loop), priority=16)
        await o("multi-state-output,1").write_property("presentValue", Unsigned(FAN.index(room.fan if fan_held is None else room.fan) + 1), priority=16)

        sensor = o("analog-input,1")
        if not sensor.outOfService:
            if self.faults["sensor"]:
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

        self.track_transitions()
        if now - self._last_log >= 60:
            self._last_log = now
            self.sample(room, now)
            self.sync_logs()
        cal = o("calendar,1")
        cal.presentValue = any(entry_matches(e, time.localtime(now)) for e in cal.dateList)

    async def run_schedule(self, now: float) -> None:
        sched = self.obj("schedule,1")
        if sched.outOfService:
            return
        day = time.localtime(now)
        minute = (day.tm_hour, day.tm_min, day.tm_sec)
        value = None
        best = None
        for ev in sched.exceptionSchedule or []:
            period = ev.period
            hit = False
            if period.calendarReference is not None:
                cal = self.obj(str(period.calendarReference))
                hit = cal is not None and any(entry_matches(e, day) for e in cal.dateList)
            elif period.calendarEntry is not None:
                hit = entry_matches(period.calendarEntry, day)
            if not hit:
                continue
            current = None
            for item in ev.listOfTimeValues:
                if tuple(item.time)[:3] <= minute:
                    current = item.value
            if current is not None and not isinstance(current, Null) and (best is None or ev.eventPriority < best):
                best, value = ev.eventPriority, current
        if value is None:
            daily = sched.weeklySchedule[day.tm_wday] if sched.weeklySchedule else None
            for item in (daily.daySchedule if daily else []):
                if tuple(item.time)[:3] <= minute:
                    value = item.value
            if value is None or isinstance(value, Null):
                value = sched.scheduleDefault
        raw = value.get_value() if hasattr(value, "get_value") else value
        target = self.obj("binary-value,1")
        want = Enumerated(1 if int(raw) else 0)
        if sched.presentValue != want:
            sched.presentValue = want
        pa = target.priorityArray[int(sched.priorityForWriting) - 1]
        if pa.null is not None or int(getattr(pa, pa._choice)) != int(want):
            await target.write_property("presentValue", Enumerated(int(want)), priority=int(sched.priorityForWriting))

    # ---- alarms ------------------------------------------------------------

    def track_transitions(self) -> None:
        """bacpypes3 moves event-state and stamps the transition; a transition its notification class says needs an
        acknowledgement must also clear its acked-transitions bit, until someone acknowledges it."""
        last = self.__dict__.setdefault("_states", {})
        for obj in self.event_objects():
            key = str(obj.objectIdentifier)
            state = str(obj.eventState)
            before = last.get(key)
            last[key] = state
            if before is None or before == state:
                continue
            idx = 1 if state == "fault" else 2 if state == "normal" else 0
            nc = next((o for o in self.objs.values() if isinstance(o, NC) and o.notificationClass == obj.notificationClass), None)
            need = list(nc.ackRequired)[idx] if nc else 0
            if need:
                bits = list(obj.ackedTransitions)
                bits[idx] = 0
                obj.ackedTransitions = EventTransitionBits(bits)
            name = {"normal": "back to normal", "fault": "in fault"}.get(state, f"in alarm ({state})")
            self.log("Rasher", "Alarm", f"{obj.objectName} is {name}", kind="alarm", obj=key)

    def acknowledge(self, obj, state: str, by: str) -> None:
        idx = 1 if state == "fault" else 2 if state == "normal" else 0
        bits = list(obj.ackedTransitions)
        bits[idx] = 1
        obj.ackedTransitions = EventTransitionBits(bits)
        self.log(by, "Acknowledge", f"{obj.objectName}: {state} acknowledged", kind="alarm", obj=str(obj.objectIdentifier))

    # ---- device management -------------------------------------------------

    def set_dcc(self, state: str, minutes: int | None) -> None:
        self.dcc = state
        self.dcc_until = time.time() + minutes * 60 if minutes and state != "enable" else None
        text = {"enable": "Communication enabled", "disable": "Communication disabled", "disable-initiation": "Initiation disabled"}.get(state, state)
        self.log("Rasher", "Communication control", text + (f" for {minutes} min" if self.dcc_until else ""), kind="device")

    def restart(self, how: str) -> None:
        if how == "coldstart":
            for obj in self.objs.values():
                if isinstance(obj, Commandable):
                    for i in range(15):
                        obj.priorityArray[i] = PriorityValue(null=())
        self.boot(f"Restarting ({how})", 6)

    def power(self, on: bool) -> None:
        """The power switch. Off: the device answers nothing, as if its supply was cut. On: it boots, forgets its COV
        subscriptions like most controllers do, and announces itself with an I-Am."""
        if on == self.powered:
            return
        self.powered = on
        if on:
            self.boot("Switched on")
        else:
            self.drop_subscriptions()
            self.log("Rasher", "Power", "Switched off: the device answers nothing", kind="device")

    def boot(self, why: str, seconds: float = 4) -> None:
        self.restart_until = time.time() + seconds
        self.drop_subscriptions()
        self.log("Rasher", "Power", f"{why}; back in about {seconds:g} s", kind="device")
        asyncio.get_running_loop().call_later(seconds + 0.2, self._announce)

    def _announce(self) -> None:
        if self.app and not self.offline_reason():
            self.i_am()
            self.log("Rasher", "I-Am", "Started up and announced on the network", kind="discovery")

    def iam_targets(self) -> list[str]:
        """Where each I-Am goes besides the broadcast. The broadcast only reaches this device's own port, so in "own" mode
        a BMS on 47808 never hears it; "peers" sends it to every address that has spoken to the device as well."""
        out = []
        for item in self.iam_to.split(","):
            item = item.strip()
            out += list(self.peers) if item == "peers" else [item] if item and item != "none" else []
        targets = []
        for a in out:
            host, _, port = a.partition(":")
            try:
                ipaddress.IPv4Address(host)  # peers holds local sources too, like "Room unit"
                port = int(port or 47808)
            except ValueError:
                continue
            if port != self.port and f"{host}:{port}" not in targets:  # the same port already hears the broadcast
                targets.append(f"{host}:{port}")
        return targets

    def i_am(self) -> None:
        self.app.i_am()
        for a in self.iam_targets():
            self.app.i_am(Address(a))

    def drop_subscriptions(self) -> None:
        if not self.app:
            return
        for det in list(getattr(self.app, "_cov_detections", {}).values()):
            for sub in list(det.cov_subscriptions):
                try:
                    self.app.cancel_subscription(sub)
                    sub.cancel_subscription()
                except Exception:
                    pass

    def time_sync(self, dt, utc: bool) -> None:
        d, t = tuple(dt.date), tuple(dt.time)
        when = time.mktime((d[0] + 1900, d[1], d[2], t[0], t[1], t[2], 0, 0, -1))
        if utc:
            when -= time.timezone if not time.localtime().tm_isdst else time.altzone
        self.clock_offset = when - time.time()
        self.last_sync = {"at": time.time(), "offset": round(self.clock_offset, 1), "utc": utc}

    def offline_reason(self) -> str:
        if not self.powered:
            return "switched off"
        if time.time() < self.restart_until:
            return "starting up"
        return ""

    def storm(self, seconds: int = 10) -> None:
        async def run():
            end = time.time() + seconds
            while time.time() < end and self.app:
                self.i_am()
                await asyncio.sleep(0.1)
            self.log("Rasher", "I-Am storm", "Storm over", kind="device")

        if self._storm and not self._storm.done():
            return
        self.log("Rasher", "I-Am storm", f"Broadcasting I-Am ten times a second for {seconds} s", kind="device")
        self._storm = asyncio.create_task(run())

    # ---- activity ----------------------------------------------------------

    def log(self, source: str, service: str, detail: str, kind: str = "read", obj: str | None = None) -> None:
        self.activity.append({"id": self.next_id, "t": time.time(), "source": source, "service": service, "detail": detail, "kind": kind, "object": obj})
        self.next_id += 1
        if source not in ("Rasher",) and not source.startswith("Rasher"):
            peer = self.peers.setdefault(source, {"address": source, "first": time.time(), "requests": 0})
            peer["last"] = time.time()
            peer["requests"] += 1

    def label(self, objid) -> str:
        obj = self.app.get_object_id(objid) if self.app else None
        return str(obj.objectName) if obj is not None else str(objid)

    def record(self, source: str, apdu) -> None:
        name = apdu.__class__.__name__
        service, kind = SERVICE.get(name, (name.replace("Request", ""), "read"))
        detail, key = "", None
        try:
            if isinstance(apdu, ReadPropertyRequest):
                key = str(apdu.objectIdentifier)
                detail = f"{self.label(apdu.objectIdentifier)} · {apdu.propertyIdentifier}" + (f"[{apdu.propertyArrayIndex}]" if apdu.propertyArrayIndex is not None else "")
                self.reads[key] = {"by": source, "at": time.time()}
            elif isinstance(apdu, ReadPropertyMultipleRequest):
                specs = apdu.listOfReadAccessSpecs
                names = [self.label(s.objectIdentifier) for s in specs]
                for s in specs:
                    self.reads[str(s.objectIdentifier)] = {"by": source, "at": time.time()}
                props = {str(p.propertyIdentifier) for s in specs for p in s.listOfPropertyReferences}
                detail = (names[0] if len(names) == 1 else f"{len(names)} objects") + " · " + (", ".join(sorted(props)) if len(props) <= 3 else f"{len(props)} properties")
                key = str(specs[0].objectIdentifier) if len(specs) == 1 else None
            elif isinstance(apdu, WritePropertyRequest):
                key = str(apdu.objectIdentifier)
                obj = self.app.get_object_id(apdu.objectIdentifier)
                value = "?"
                if obj is not None:
                    try:
                        ptype = obj.get_property_type(apdu.propertyIdentifier)
                        v = apdu.propertyValue.cast_out(ptype, null=apdu.priority is not None)
                        value = "relinquish" if isinstance(v, Null) else self.show(obj, str(apdu.propertyIdentifier), v)
                    except Exception:
                        pass
                prio = f" at priority {apdu.priority}" if apdu.priority is not None else ""
                detail = f"{self.label(apdu.objectIdentifier)} · {apdu.propertyIdentifier} → {value}{prio}"
                self._pending_write = {"by": source, "at": time.time(), "property": str(apdu.propertyIdentifier), "value": value, "priority": apdu.priority}
            elif isinstance(apdu, WritePropertyMultipleRequest):
                specs = apdu.listOfWriteAccessSpecs
                detail = ", ".join(self.label(s.objectIdentifier) for s in specs)
            elif isinstance(apdu, SubscribeCOVRequest):
                key = str(apdu.monitoredObjectIdentifier)
                cancel = apdu.issueConfirmedNotifications is None and apdu.lifetime is None
                detail = f"{self.label(apdu.monitoredObjectIdentifier)} · " + ("cancel" if cancel else f"{'confirmed' if apdu.issueConfirmedNotifications else 'unconfirmed'}, " + (f"{apdu.lifetime} s" if apdu.lifetime else "no expiry"))
            elif isinstance(apdu, ReadRangeRequest):
                key = str(apdu.objectIdentifier)
                r = apdu.range
                how = "all" if r is None else "by position" if r.byPosition is not None else "by sequence" if r.bySequenceNumber is not None else "by time"
                detail = f"{self.label(apdu.objectIdentifier)} · {how}"
            elif isinstance(apdu, WhoIsRequest):
                lo, hi = apdu.deviceInstanceRangeLowLimit, apdu.deviceInstanceRangeHighLimit
                detail = "all devices" if lo is None else f"devices {lo}–{hi}"
            elif isinstance(apdu, WhoHasRequest):
                detail = str(apdu.object.objectName or apdu.object.objectIdentifier)
            elif isinstance(apdu, AcknowledgeAlarmRequest):
                key = str(apdu.eventObjectIdentifier)
                detail = f"{self.label(apdu.eventObjectIdentifier)} · {apdu.eventStateAcknowledged}"
            elif isinstance(apdu, DeviceCommunicationControlRequest):
                detail = f"{apdu.enableDisable}" + (f" for {apdu.timeDuration} min" if apdu.timeDuration is not None else "")
            elif isinstance(apdu, ReinitializeDeviceRequest):
                detail = str(apdu.reinitializedStateOfDevice)
            elif isinstance(apdu, (TimeSynchronizationRequest, UTCTimeSynchronizationRequest)):
                d, t = tuple(apdu.time.date), tuple(apdu.time.time)
                detail = f"{d[0] + 1900}-{d[1]:02}-{d[2]:02} {t[0]:02}:{t[1]:02}:{t[2]:02}"
        except Exception:
            pass
        self.log(source, service, detail, kind=kind, obj=key)

    def after_write(self, apdu) -> None:
        pending = getattr(self, "_pending_write", None)
        self._pending_write = None
        if isinstance(apdu, WritePropertyRequest) and pending:
            key = str(apdu.objectIdentifier)
            self.writes[key] = pending
            if kind_of(apdu.objectIdentifier) in ("trend-log", "trend-log-multiple") and str(apdu.propertyIdentifier) == "record-count":
                log = self.logs.get((kind_of(apdu.objectIdentifier), apdu.objectIdentifier[1]))
                if log:
                    log.clear()
                    self.sync_logs()

    # ---- local control (the UI) --------------------------------------------

    async def write(self, key: str, value, priority: int | None, by: str) -> None:
        obj = self.obj(key)
        vt = obj._elements["presentValue"]
        if value is None:
            v = Null(())
        elif vt.__name__ in ("BinaryPV",):
            v = vt(value)
        else:
            v = vt(vt.cast(value))
        if isinstance(obj, Commandable):
            await obj.write_property("presentValue", v, priority=priority or 16)
        else:
            obj.presentValue = v
        shown = "relinquish" if value is None else self.show(obj, "presentValue", v)
        self.writes[key] = {"by": by, "at": time.time(), "property": "present-value", "value": shown, "priority": priority}
        self.log(by, "Write", f"{obj.objectName} · present-value → {shown}" + (f" at priority {priority}" if priority else ""), kind="local", obj=key)

    def show(self, obj, prop: str, v) -> str:
        if prop in ("presentValue", "present-value", "relinquishDefault", "relinquish-default"):
            texts = getattr(obj, "stateText", None)
            if texts and isinstance(v, int) and not isinstance(v, bool):
                i = int(v) - 1
                return str(texts[i]) if 0 <= i < len(texts) else str(int(v))
            if str(v) in ("active", "inactive"):
                return str(getattr(obj, "activeText" if str(v) == "active" else "inactiveText", v))
            if isinstance(v, float):
                units = getattr(obj, "units", None)
                return f"{float(v):g}" + (f" {UNIT.get(str(units), '')}" if units is not None else "")
        return str(v)

    # ---- the state the UI shows -------------------------------------------

    def snapshot(self, since: int = 0) -> dict:
        points = [self.point(k, o) for k, o in self.objs.items()]
        subs = []
        if self.app:
            for objid, det in getattr(self.app, "_cov_detections", {}).items():
                for s in det.cov_subscriptions:
                    subs.append({
                        "object": str(objid), "name": self.label(objid), "subscriber": str(s.client_addr),
                        "process": int(s.proc_id), "confirmed": bool(s.confirmed), "lifetime": int(s.lifetime or 0),
                    })
        r = self.room
        return {
            "device": {"instance": self.instance, "name": self.name, "ip": self.ip, "port": self.port, "prefix": self.prefix,
                       "started": self.started, "powered": self.powered, "dcc": self.dcc, "dccUntil": self.dcc_until, "restarting": time.time() < self.restart_until,
                       "lastSync": self.last_sync},
            "room": {"temp": round(r.temp, 2), "humidity": round(r.humidity, 1), "co2": round(r.co2), "people": r.people,
                     "autoPeople": self.auto_people, "window": r.window_open, "outside": round(r.outside, 1),
                     "outsideOverride": r.outside_override, "heat": r.heat, "cool": r.cool, "heatLoop": r.heat_loop,
                     "coolLoop": r.cool_loop, "fan": r.fan, "heatSp": round(r.heat_sp, 2), "coolSp": round(r.cool_sp, 2),
                     "speed": self.speed},
            "faults": self.faults,
            "points": points,
            "subscriptions": subs,
            "peers": sorted(self.peers.values(), key=lambda p: -p["last"]),
            # with since, everything after it: a poller that falls behind still gets the lot, and is told if the log
            # itself no longer reaches back that far
            "activity": [a for a in self.activity if a["id"] > since][-200 if since <= 0 else None:],
            "activityTruncated": since > 0 and bool(self.activity) and self.activity[0]["id"] > since + 1,
        }

    def point(self, key: str, obj) -> dict:
        kind = kind_of(obj.objectIdentifier)
        pv = getattr(obj, "presentValue", None)
        out = {
            "key": key, "type": kind, "instance": int(obj.objectIdentifier[1]), "name": str(obj.objectName),
            "description": str(obj.description) if getattr(obj, "description", None) else "",
            "value": None, "display": "", "units": UNIT.get(str(getattr(obj, "units", "")), "") if getattr(obj, "units", None) is not None else "",
            "statusFlags": list(obj.statusFlags) if getattr(obj, "statusFlags", None) is not None else None,
            "reliability": str(obj.reliability) if getattr(obj, "reliability", None) is not None else None,
            "outOfService": bool(getattr(obj, "outOfService", False)),
            "commandable": isinstance(obj, Commandable),
            "writable": isinstance(obj, Commandable) or kind in ("analog-value",) and "presentValue" in obj._writable,
            "lastWrite": self.writes.get(key), "lastRead": self.reads.get(key),
        }
        if kind in ("trend-log", "trend-log-multiple"):
            log = self.logs.get((kind, int(obj.objectIdentifier[1])))
            out["display"] = f"{len(log.records) if log else 0} records"
            out["records"] = len(log.records) if log else 0
        elif kind == "notification-class":
            out["display"] = f"Class {obj.notificationClass}"
        elif kind == "calendar":
            out["value"] = bool(pv)
            out["display"] = "Holiday today" if pv else "Not today"
        elif pv is not None:
            raw = pv.get_value() if hasattr(pv, "get_value") else pv
            out["value"] = to_py(pv) if not isinstance(pv, Enumerated) else (int(pv) if kind not in ("binary-input", "binary-value", "binary-output") else str(pv))
            out["display"] = self.show(obj, "presentValue", pv) if kind != "loop" else f"{float(raw):g} %"
            if kind == "schedule":
                out["display"] = "On" if int(raw) else "Off"
        if getattr(obj, "stateText", None):
            out["states"] = [str(s) for s in obj.stateText]
        if kind.startswith("binary"):
            out["states"] = [str(getattr(obj, "inactiveText", "") or "Inactive"), str(getattr(obj, "activeText", "") or "Active")]
        if isinstance(obj, Commandable):
            slots = []
            for i, pvx in enumerate(obj.priorityArray):
                if pvx.null is None:
                    v = getattr(pvx, pvx._choice)
                    slots.append({"priority": i + 1, "value": to_py(v), "display": self.show(obj, "presentValue", v)})
            out["priorityArray"] = slots
            ccp = obj.currentCommandPriority
            out["activePriority"] = getattr(ccp, "unsigned", None) if ccp is not None else None
            out["relinquishDefault"] = self.show(obj, "presentValue", obj.relinquishDefault)
        if getattr(obj, "ackedTransitions", None) is not None and kind not in ("trend-log", "trend-log-multiple"):
            stamps = []
            for s in obj.eventTimeStamps:
                d = s.dateTime
                if d is None and s.time is not None and tuple(s.time)[0] != 255:
                    # bacpypes3 stamps its own transitions with a time of day only: today, at that time
                    tt = tuple(s.time)
                    lt = time.localtime()
                    stamps.append(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, tt[0], tt[1], tt[2], 0, 0, -1)))
                elif d is None or tuple(d.date)[0] == 255:
                    stamps.append(None)
                else:
                    dd, tt = tuple(d.date), tuple(d.time)
                    stamps.append(time.mktime((dd[0] + 1900, dd[1], dd[2], tt[0], tt[1], tt[2], 0, 0, -1)))
            out["alarm"] = {
                "state": str(obj.eventState), "acked": list(obj.ackedTransitions), "stamps": stamps,
                "enable": list(obj.eventEnable), "nc": int(obj.notificationClass),
                "limits": {"high": float(obj.highLimit), "low": float(obj.lowLimit), "enable": list(obj.limitEnable)} if getattr(obj, "highLimit", None) is not None else None,
                "alarmValue": str(obj.alarmValue) if getattr(obj, "alarmValue", None) is not None else None,
            }
        return out


UNIT = {
    "degrees-celsius": "°C", "percent-relative-humidity": "%RH", "parts-per-million": "ppm", "percent": "%",
    "delta-degrees-kelvin": "K", "no-units": "",
}
