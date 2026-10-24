"""A simulated BACnet/IP controller for developing BACon without a site.

    python scripts/simdevice.py 10.0.0.122 [--port 47809] [--instance 1001]

It serves points with live values, alarm setups in every state, schedules, a calendar, notification classes and trend
logs with a few days of history (ReadRange), plus GetEventInformation. In BACon, connect on 47808 as usual, then use
"Add a device by IP" with <ip>:47809.
"""

import argparse
import asyncio
import math
import random
import time

from bacpypes3.apdu import (
    GetAlarmSummaryACK,
    GetEventInformationACK,
    ReadRangeACK,
)
from bacpypes3.app import Application
from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.basetypes import (
    CalendarEntry,
    DailySchedule,
    DateRange,
    DateTime,
    Destination,
    DeviceObjectPropertyReference,
    EngineeringUnits,
    EventState,
    EventTransitionBits,
    EventType,
    GetAlarmSummaryAlarmSummary,
    GetEventInformationEventSummary,
    LimitEnable,
    LogMultipleRecord,
    LogData,
    LogDataLogData,
    LogRecord,
    LogRecordLogDatum,
    LogStatus,
    NotifyType,
    ObjectPropertyReference,
    Polarity,
    Recipient,
    Reliability,
    ResultFlags,
    SpecialEvent,
    SpecialEventPeriod,
    StatusFlags,
    TimeStamp,
    TimeValue,
    WeekNDay,
)
from bacpypes3.constructeddata import Any, ArrayOf, ListOf, SequenceOf
from bacpypes3.local.object import Object as _Local
from bacpypes3.object import (
    AnalogInputObject,
    AnalogValueObject,
    BinaryInputObject,
    BinaryValueObject,
    CalendarObject,
    EventEnrollmentObject,
    MultiStateValueObject,
    NotificationClassObject,
    ScheduleObject,
    TrendLogMultipleObject,
    TrendLogObject,
)
from bacpypes3.primitivedata import (
    Boolean,
    CharacterString,
    Date,

    Enumerated,
    Null,
    ObjectIdentifier,
    Real,
    Time,
    Unsigned,
)


class _Sim(_Local):
    async def _post_init(self):
        pass  # no notification-class linking: the simulator never sends notifications


class AI(_Sim, AnalogInputObject): pass
class AV(_Sim, AnalogValueObject): pass
class BI(_Sim, BinaryInputObject): pass
class BV(_Sim, BinaryValueObject): pass
class MSV(_Sim, MultiStateValueObject): pass
class Sched(_Sim, ScheduleObject): pass
class Cal(_Sim, CalendarObject): pass
class NC(_Sim, NotificationClassObject): pass
class EE(_Sim, EventEnrollmentObject): pass
class TL(_Sim, TrendLogObject): pass
class TLM(_Sim, TrendLogMultipleObject): pass


def stamp(t: float) -> DateTime:
    lt = time.localtime(t)
    return DateTime(
        date=Date((lt.tm_year - 1900, lt.tm_mon, lt.tm_mday, lt.tm_wday + 1)),
        time=Time((lt.tm_hour, lt.tm_min, lt.tm_sec, 0)),
    )


def ts(t: float | None) -> TimeStamp:
    if t is None:  # "never happened": all-wildcard date and time
        return TimeStamp(dateTime=DateTime(date=Date((255, 255, 255, 255)), time=Time((255, 255, 255, 255))))
    return TimeStamp(dateTime=stamp(t))


def tv(h: int, m: int, value) -> TimeValue:
    return TimeValue(time=Time((h, m, 0, 0)), value=value)


def alarm_props(state="normal", acked=(1, 1, 1), stamps=(None, None, None), nc=1, enable=(1, 1, 1), delay=30):
    return dict(
        eventState=EventState(state),
        eventEnable=EventTransitionBits(list(enable)),
        ackedTransitions=EventTransitionBits(list(acked)),
        notificationClass=nc,
        notifyType=NotifyType("alarm"),
        timeDelay=delay,
        eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(t) for t in stamps]),
        eventDetectionEnable=True,
    )


def sat(t: float) -> float:
    """Supply air temperature: a daily swing plus a little noise."""
    hour = time.localtime(t).tm_hour + time.localtime(t).tm_min / 60
    return 16.5 + 3.2 * math.sin((hour - 9) / 24 * 2 * math.pi) + 0.6 * math.sin(t / 1700) + random.uniform(-0.15, 0.15)


def fan_on(t: float) -> bool:
    lt = time.localtime(t)
    return lt.tm_wday < 5 and (6 * 60 + 30) <= lt.tm_hour * 60 + lt.tm_min < 18 * 60


def build(instance: int):
    now = time.time()
    objs = []

    sat_ai = AI(
        objectIdentifier=("analog-input", 1), objectName="Supply air temp", presentValue=sat(now),
        units=EngineeringUnits("degrees-celsius"), statusFlags=StatusFlags([0, 0, 0, 0]), covIncrement=0.2,
        description="AHU-1 supply air", highLimit=28.0, lowLimit=10.0, deadband=1.0, limitEnable=LimitEnable([1, 1]),
        **alarm_props(stamps=(now - 86400 * 2, None, now - 86400 * 2 + 1800)),
    )
    zone = AI(
        objectIdentifier=("analog-input", 2), objectName="Zone temp level 2", presentValue=27.8,
        units=EngineeringUnits("degrees-celsius"), statusFlags=StatusFlags([1, 0, 0, 0]), covIncrement=0.2,
        highLimit=26.0, lowLimit=16.0, deadband=0.5, limitEnable=LimitEnable([1, 1]),
        **alarm_props("high-limit", acked=(0, 1, 1), stamps=(now - 2400, None, now - 86400)),
    )
    oat = AI(
        objectIdentifier=("analog-input", 3), objectName="Outside air temp", presentValue=-40.0,
        units=EngineeringUnits("degrees-celsius"), statusFlags=StatusFlags([1, 1, 0, 0]),
        reliability=Reliability("open-loop"), covIncrement=0.5, highLimit=45.0, lowLimit=-20.0, deadband=1.0,
        limitEnable=LimitEnable([1, 1]),
        **alarm_props("fault", acked=(1, 1, 1), stamps=(None, now - 5 * 3600, now - 86400 * 3), nc=2),
    )
    rh = AI(
        objectIdentifier=("analog-input", 4), objectName="Return air humidity", presentValue=48.0,
        units=EngineeringUnits("percent-relative-humidity"), statusFlags=StatusFlags([0, 0, 0, 0]), covIncrement=1.0,
    )
    filt = BI(
        objectIdentifier=("binary-input", 1), objectName="Filter dirty", presentValue="active",
        polarity=Polarity("normal"), statusFlags=StatusFlags([1, 0, 0, 0]), alarmValue="active",
        activeText="Dirty", inactiveText="Clean",
        **alarm_props("offnormal", acked=(1, 1, 1), stamps=(now - 3 * 86400 - 7200, None, None), nc=2, delay=300),
    )
    fan = BI(
        objectIdentifier=("binary-input", 2), objectName="Supply fan status", presentValue="active" if fan_on(now) else "inactive",
        polarity=Polarity("normal"), statusFlags=StatusFlags([0, 0, 0, 0]), activeText="Running", inactiveText="Stopped",
    )
    occ = BV(
        objectIdentifier=("binary-value", 1), objectName="AHU-1 occupied", presentValue="active",
        statusFlags=StatusFlags([0, 0, 0, 0]), activeText="Occupied", inactiveText="Unoccupied",
    )
    mode = MSV(
        objectIdentifier=("multi-state-value", 1), objectName="Zone mode", presentValue=2, numberOfStates=4,
        stateText=ArrayOf(CharacterString)(["Off", "Comfort", "Economy", "Frost protect"]),
        statusFlags=StatusFlags([0, 0, 0, 0]),
    )
    sp = AV(
        objectIdentifier=("analog-value", 1), objectName="Zone setpoint", presentValue=21.0,
        units=EngineeringUnits("degrees-celsius"), statusFlags=StatusFlags([0, 0, 0, 0]),
    )
    objs += [sat_ai, zone, oat, rh, filt, fan, occ, mode, sp]

    # more zones, so filters have something to find: one warm, one with a failed sensor
    zones = [("Zone temp level 1", 22.4, None), ("Zone temp level 3", 26.9, None), ("Zone temp level 4", 21.7, None),
             ("Zone temp level 5", 0.0, "over-range"), ("Zone temp level 6", 23.1, None)]
    for n, (name, pv, fault) in enumerate(zones, start=5):
        objs.append(AI(
            objectIdentifier=("analog-input", n), objectName=name, presentValue=pv,
            units=EngineeringUnits("degrees-celsius"), covIncrement=0.2, description=f"VAV {n - 4} room sensor",
            statusFlags=StatusFlags([0, 1, 0, 0] if fault else [0, 0, 0, 0]),
            reliability=Reliability(fault or "no-fault-detected"),
        ))

    objs.append(NC(
        objectIdentifier=("notification-class", 1), objectName="Critical alarms", notificationClass=1,
        priority=ArrayOf(Unsigned, _length=3)([3, 3, 200]), ackRequired=EventTransitionBits([1, 1, 0]),
        recipientList=ListOf(Destination)([
            Destination(
                validDays=[1, 1, 1, 1, 1, 1, 1], fromTime=Time((0, 0, 0, 0)), toTime=Time((23, 59, 59, 99)),
                recipient=Recipient(device=ObjectIdentifier(("device", 90001))), processIdentifier=1,
                issueConfirmedNotifications=True, transitions=EventTransitionBits([1, 1, 1]),
            )
        ]),
    ))
    objs.append(NC(
        objectIdentifier=("notification-class", 2), objectName="Maintenance", notificationClass=2,
        priority=ArrayOf(Unsigned, _length=3)([120, 120, 200]), ackRequired=EventTransitionBits([0, 0, 0]),
        recipientList=ListOf(Destination)([]),
    ))
    objs.append(EE(
        objectIdentifier=("event-enrollment", 1), objectName="Duct static watch", eventType=EventType("out-of-range"),
        notifyType=NotifyType("alarm"), eventEnable=EventTransitionBits([1, 1, 1]),
        ackedTransitions=EventTransitionBits([1, 1, 1]), notificationClass=1, eventState=EventState("normal"),
        eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(None), ts(None), ts(None)]), eventDetectionEnable=True,
        objectPropertyReference=DeviceObjectPropertyReference(
            objectIdentifier=ObjectIdentifier(("analog-value", 1)), propertyIdentifier="present-value"
        ),
        statusFlags=StatusFlags([0, 0, 0, 0]), reliability=Reliability("no-fault-detected"),
    ))

    on, off = Enumerated(1), Enumerated(0)
    week = [
        DailySchedule(daySchedule=[tv(6, 30, on), tv(18, 0, off)]) for _ in range(4)
    ] + [
        DailySchedule(daySchedule=[tv(6, 30, on), tv(16, 0, off)]),
        DailySchedule(daySchedule=[tv(8, 0, on), tv(13, 0, off)]),
        DailySchedule(daySchedule=[]),
    ]
    year = time.localtime(now).tm_year - 1900
    objs.append(Cal(
        objectIdentifier=("calendar", 1), objectName="Public holidays", presentValue=False,
        dateList=ListOf(CalendarEntry)([
            CalendarEntry(date=Date((year, 12, 25, 255))),
            CalendarEntry(date=Date((year, 12, 26, 255))),
            CalendarEntry(date=Date((year + 1, 1, 1, 255))),
            CalendarEntry(dateRange=DateRange(startDate=Date((year, 12, 27, 255)), endDate=Date((year, 12, 31, 255)))),
            CalendarEntry(weekNDay=WeekNDay(bytes([11, 255, 4]))),  # every Thursday in November
        ]),
    ))
    today = time.localtime(now)
    soon = time.localtime(now + 2 * 86400)
    objs.append(Sched(
        objectIdentifier=("schedule", 1), objectName="AHU-1 occupancy", presentValue=Enumerated(1),
        description="Office hours, early finish Friday",
        effectivePeriod=DateRange(startDate=Date((255, 255, 255, 255)), endDate=Date((255, 255, 255, 255))),
        weeklySchedule=ArrayOf(DailySchedule, _length=7)(week),
        exceptionSchedule=ArrayOf(SpecialEvent)([
            SpecialEvent(
                period=SpecialEventPeriod(calendarReference=ObjectIdentifier(("calendar", 1))),
                listOfTimeValues=[tv(0, 0, off)], eventPriority=1,
            ),
            SpecialEvent(
                period=SpecialEventPeriod(calendarEntry=CalendarEntry(date=Date((soon.tm_year - 1900, soon.tm_mon, soon.tm_mday, 255)))),
                listOfTimeValues=[tv(9, 0, on), tv(14, 0, off)], eventPriority=10,
            ),
        ]),
        scheduleDefault=off, priorityForWriting=12, statusFlags=StatusFlags([0, 0, 0, 0]),
        reliability=Reliability("no-fault-detected"), outOfService=False,
        listOfObjectPropertyReferences=ListOf(DeviceObjectPropertyReference)([
            DeviceObjectPropertyReference(objectIdentifier=ObjectIdentifier(("binary-value", 1)), propertyIdentifier="present-value"),
        ]),
    ))
    objs.append(Sched(
        objectIdentifier=("schedule", 2), objectName="Zone setpoint schedule", presentValue=Real(21.0),
        effectivePeriod=DateRange(startDate=Date((year, 1, 1, 255)), endDate=Date((year, 12, 31, 255))),
        weeklySchedule=ArrayOf(DailySchedule, _length=7)(
            [DailySchedule(daySchedule=[tv(7, 0, Real(21.0)), tv(12, 0, Real(20.5)), tv(13, 0, Real(21.0)), tv(19, 0, Real(18.0)), tv(22, 0, Null(()))]) for _ in range(5)]
            + [DailySchedule(daySchedule=[tv(9, 0, Real(19.0)), tv(17, 0, Null(()))]) for _ in range(2)]
        ),
        exceptionSchedule=ArrayOf(SpecialEvent)([
            SpecialEvent(
                period=SpecialEventPeriod(calendarEntry=CalendarEntry(dateRange=DateRange(
                    startDate=Date((today.tm_year - 1900, today.tm_mon, today.tm_mday, 255)),
                    endDate=Date((soon.tm_year - 1900, soon.tm_mon, soon.tm_mday, 255)),
                ))),
                listOfTimeValues=[tv(6, 0, Real(22.5)), tv(20, 0, Null(()))], eventPriority=8,
            ),
        ]),
        scheduleDefault=Real(16.0), priorityForWriting=14, statusFlags=StatusFlags([0, 0, 0, 0]),
        reliability=Reliability("no-fault-detected"), outOfService=False,
        listOfObjectPropertyReferences=ListOf(DeviceObjectPropertyReference)([
            DeviceObjectPropertyReference(objectIdentifier=ObjectIdentifier(("analog-value", 1)), propertyIdentifier="present-value"),
        ]),
    ))
    objs.append(Sched(
        objectIdentifier=("schedule", 3), objectName="Zone mode schedule", presentValue=Unsigned(2),
        effectivePeriod=DateRange(startDate=Date((255, 255, 255, 255)), endDate=Date((255, 255, 255, 255))),
        weeklySchedule=ArrayOf(DailySchedule, _length=7)(
            [DailySchedule(daySchedule=[tv(5, 0, Unsigned(2)), tv(7, 30, Unsigned(2)), tv(17, 0, Unsigned(3)), tv(23, 0, Unsigned(4))]) for _ in range(5)]
            + [DailySchedule(daySchedule=[tv(0, 0, Unsigned(4))]) for _ in range(2)]
        ),
        exceptionSchedule=ArrayOf(SpecialEvent)([]),
        scheduleDefault=Unsigned(1), priorityForWriting=16, statusFlags=StatusFlags([0, 0, 0, 0]),
        reliability=Reliability("no-fault-detected"), outOfService=False,
        listOfObjectPropertyReferences=ListOf(DeviceObjectPropertyReference)([
            DeviceObjectPropertyReference(objectIdentifier=ObjectIdentifier(("multi-state-value", 1)), propertyIdentifier="present-value"),
        ]),
    ))

    tl_common = dict(
        enable=True, stopWhenFull=False, bufferSize=5000, logInterval=90000, statusFlags=StatusFlags([0, 0, 0, 0]),
        eventState=EventState("normal"), loggingType="polled", alignIntervals=True, intervalOffset=0, trigger=False,
        notificationThreshold=1000, recordsSinceNotification=0, lastNotifyRecord=0, eventEnable=EventTransitionBits([0, 0, 0]),
        ackedTransitions=EventTransitionBits([1, 1, 1]), notifyType=NotifyType("event"),
        eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(None), ts(None), ts(None)]), notificationClass=2,
    )
    objs.append(TL(
        objectIdentifier=("trend-log", 1), objectName="Supply air temp log", recordCount=0, totalRecordCount=0,
        logDeviceObjectProperty=DeviceObjectPropertyReference(
            objectIdentifier=ObjectIdentifier(("analog-input", 1)), propertyIdentifier="present-value",
            deviceIdentifier=ObjectIdentifier(("device", instance)),
        ),
        **tl_common,
    ))
    objs.append(TL(
        objectIdentifier=("trend-log", 2), objectName="Supply fan status log", recordCount=0, totalRecordCount=0,
        logDeviceObjectProperty=DeviceObjectPropertyReference(
            objectIdentifier=ObjectIdentifier(("binary-input", 2)), propertyIdentifier="present-value",
        ),
        **tl_common,
    ))
    objs.append(TLM(
        objectIdentifier=("trend-log-multiple", 1), objectName="Zone log", recordCount=0, totalRecordCount=0,
        logDeviceObjectProperty=ArrayOf(DeviceObjectPropertyReference)([
            DeviceObjectPropertyReference(objectIdentifier=ObjectIdentifier(("analog-input", 2)), propertyIdentifier="present-value"),
            DeviceObjectPropertyReference(objectIdentifier=ObjectIdentifier(("analog-value", 1)), propertyIdentifier="present-value"),
        ]),
        **{k: v for k, v in tl_common.items() if k not in ("trigger",)},
    ))
    return objs


class Logs:
    """Each trend log's records: (sequence number, time, value). Three days of 15-minute history, then live."""

    def __init__(self):
        now = time.time()
        start = now - 3 * 86400
        start -= start % 900
        self.records: dict[tuple[int, int], list[tuple[int, float, object]]] = {(20, 1): [], (20, 2): [], (27, 1): []}
        t = start
        while t <= now:
            self.add(t)
            t += 900

    def add(self, t: float):
        zone = 22 + 3 * math.sin(t / 7000) + random.uniform(-0.2, 0.2)
        values = {
            (20, 1): Real(sat(t)),
            (20, 2): Enumerated(1 if fan_on(t) else 0),
            (27, 1): [Real(zone), Real(21.0 if fan_on(t) else 18.0)],
        }
        for key, v in values.items():
            rec = self.records[key]
            rec.append(((rec[-1][0] + 1) if rec else 1, t, v))
            del rec[:-5000]

    def encode(self, key, items) -> Any:
        if key[0] == 20:
            seq = SequenceOf(LogRecord)([
                LogRecord(
                    timestamp=stamp(t),
                    logDatum=LogRecordLogDatum(realValue=v) if isinstance(v, Real) else LogRecordLogDatum(enumValue=v),
                    statusFlags=StatusFlags([0, 0, 0, 0]),
                )
                for _, t, v in items
            ])
        else:
            seq = SequenceOf(LogMultipleRecord)([
                LogMultipleRecord(timestamp=stamp(t), logData=LogData(logData=[LogDataLogData(realValue=x) for x in v]))
                for _, t, v in items
            ])
        return Any(seq)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ip")
    ap.add_argument("--port", type=int, default=47809)
    ap.add_argument("--prefix", type=int, default=24)
    ap.add_argument("--instance", type=int, default=1001)
    ap.add_argument("--no-seq", action="store_true", help="act like a controller that does not number log records")
    ap.add_argument("--max-items", type=int, default=1000, help="abort ReadRange asking for more records than this")
    opts = ap.parse_args()

    args = SimpleArgumentParser().parse_args([
        "--address", f"{opts.ip}/{opts.prefix}:{opts.port}", "--instance", str(opts.instance),
        "--name", "SIM-AHU-1", "--vendoridentifier", "999",
    ])
    app = Application.from_args(args)
    objs = build(opts.instance)
    for o in objs:
        app.add_object(o)
    by_id = {(int(o.objectIdentifier[0]), o.objectIdentifier[1]): o for o in objs}
    logs = Logs()

    def sync_counts():
        for key, rec in logs.records.items():
            o = by_id[key]
            o.recordCount = len(rec)
            o.totalRecordCount = rec[-1][0] if rec else 0

    sync_counts()

    async def do_ReadRangeRequest(apdu):
        key = (int(apdu.objectIdentifier[0]), int(apdu.objectIdentifier[1]))
        rec = logs.records.get(key)
        if rec is None or int(apdu.propertyIdentifier) != 131:
            from bacpypes3.errors import ExecutionError

            raise ExecutionError(errorClass="property", errorCode="property-is-not-a-list")
        r = apdu.range
        asked = abs(int((r.byPosition or r.bySequenceNumber or r.byTime).count)) if r else 0
        if asked > opts.max_items:
            from bacpypes3.errors import SegmentationNotSupported

            raise SegmentationNotSupported()  # the answer would not fit in one packet
        if opts.no_seq and r is not None and r.bySequenceNumber is not None:
            from bacpypes3.errors import ExecutionError

            raise ExecutionError(errorClass="services", errorCode="other")
        items: list = []
        if r is None or (r.byPosition is None and r.bySequenceNumber is None and r.byTime is None):
            items = rec
        elif r.byPosition is not None:
            ref, count = int(r.byPosition.referenceIndex), int(r.byPosition.count)
            i = ref - 1
            items = rec[i : i + count] if count > 0 else rec[max(0, i + count + 1) : i + 1]
        elif r.bySequenceNumber is not None:
            ref, count = int(r.bySequenceNumber.referenceSequenceNumber), int(r.bySequenceNumber.count)
            idx = next((i for i, x in enumerate(rec) if x[0] == ref), None)
            if idx is None:
                items = [x for x in rec if x[0] >= ref][:count] if count > 0 else []
            else:
                items = rec[idx : idx + count] if count > 0 else rec[max(0, idx + count + 1) : idx + 1]
        else:
            d, t = tuple(r.byTime.referenceTime.date), tuple(r.byTime.referenceTime.time)
            when = time.mktime((d[0] + 1900, d[1], d[2], t[0], t[1], t[2], 0, 0, -1))
            count = int(r.byTime.count)
            items = [x for x in rec if x[1] > when][:count] if count > 0 else [x for x in rec if x[1] < when][count:]
        items = items[:60]  # keep within one unsegmented response
        first = items and rec.index(items[0]) == 0
        last = items and rec.index(items[-1]) == len(rec) - 1
        ack = ReadRangeACK(
            context=apdu,
            objectIdentifier=apdu.objectIdentifier,
            propertyIdentifier=apdu.propertyIdentifier,
            resultFlags=ResultFlags([1 if first else 0, 1 if last else 0, 0]),
            itemCount=len(items),
            itemData=logs.encode(key, items),
            firstSequenceNumber=items[0][0] if items and not opts.no_seq else None,
        )
        await app.response(ack)

    async def do_GetEventInformationRequest(apdu):
        summaries = []
        for o in objs:
            state = getattr(o, "eventState", None)
            acked = getattr(o, "ackedTransitions", None)
            if state is None or o.objectIdentifier[0] in ("trend-log", "trend-log-multiple"):
                continue
            if int(state) == 0 and all(acked or [1]):
                continue
            summaries.append(GetEventInformationEventSummary(
                objectIdentifier=o.objectIdentifier, eventState=state, acknowledgedTransitions=acked,
                eventTimeStamps=list(o.eventTimeStamps), notifyType=o.notifyType, eventEnable=o.eventEnable,
                eventPriorities=[3, 3, 200],
            ))
        await app.response(GetEventInformationACK(context=apdu, listOfEventSummaries=summaries, moreEvents=False))

    app.do_ReadRangeRequest = do_ReadRangeRequest
    app.do_GetEventInformationRequest = do_GetEventInformationRequest

    print(f"SIM-AHU-1 (device {opts.instance}) on {opts.ip}:{opts.port} with {len(objs)} objects")
    tick = 0
    while True:
        await asyncio.sleep(5)
        tick += 1
        now = time.time()
        objs[0].presentValue = sat(now)
        objs[1].presentValue = 27.6 + 0.4 * math.sin(now / 300)
        objs[3].presentValue = 48 + 3 * math.sin(now / 900)
        objs[5].presentValue = "active" if fan_on(now) else "inactive"
        if tick % 12 == 0:  # a new log record every minute, so live reads find something
            logs.add(now)
            sync_counts()


if __name__ == "__main__":
    asyncio.run(main())
