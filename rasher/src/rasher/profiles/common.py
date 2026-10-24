"""What more than one profile uses: the weather and the office day, and the objects most building controllers have
(a holiday calendar, an occupancy schedule, trend logs)."""

import math
import time

from bacpypes3.basetypes import (
    CalendarEntry,
    DailySchedule,
    DateRange,
    DeviceObjectPropertyReference,
    EventState,
    EventTransitionBits,
    NotifyType,
    Reliability,
    SpecialEvent,
    SpecialEventPeriod,
    TimeStamp,
)
from bacpypes3.constructeddata import ArrayOf, ListOf
from bacpypes3.primitivedata import Date, Enumerated

from ..device import TL, TLM, Cal, Sched, flags, oid, ref, ts, tv


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


def office_people(t: float) -> int:
    """How many people a typical office meeting room has at time t: two to four through the day, one at lunch."""
    if not occupied_by_schedule(t):
        return 0
    lt = time.localtime(t)
    if lt.tm_hour == 12:
        return 1  # lunch
    return 2 + (lt.tm_yday + lt.tm_hour) % 3


def holidays(now: float) -> Cal:
    """calendar 1: New Year, Christmas, Boxing Day and the week after."""
    year = time.localtime(now).tm_year - 1900
    return Cal(
        objectIdentifier=("calendar", 1), objectName="Public holidays", presentValue=False,
        dateList=ListOf(CalendarEntry)([
            CalendarEntry(date=Date((255, 1, 1, 255))),
            CalendarEntry(date=Date((255, 12, 25, 255))),
            CalendarEntry(date=Date((255, 12, 26, 255))),
            CalendarEntry(dateRange=DateRange(startDate=Date((year, 12, 27, 255)), endDate=Date((year, 12, 31, 255)))),
        ]),
    )


def occupancy_schedule() -> Sched:
    """schedule 1: office hours and Saturday morning, off on the holidays in calendar 1, written to binary-value 1 at
    priority 12."""
    on, off = Enumerated(1), Enumerated(0)
    week = [DailySchedule(daySchedule=[tv(7, 0, on), tv(18, 0, off)]) for _ in range(5)] + [
        DailySchedule(daySchedule=[tv(8, 0, on), tv(12, 0, off)]),
        DailySchedule(daySchedule=[]),
    ]
    return Sched(
        objectIdentifier=("schedule", 1), objectName="Occupancy schedule", presentValue=on,
        description="Office hours, Saturday morning",
        effectivePeriod=DateRange(startDate=Date((255, 255, 255, 255)), endDate=Date((255, 255, 255, 255))),
        weeklySchedule=ArrayOf(DailySchedule, _length=7)(week),
        exceptionSchedule=ArrayOf(SpecialEvent)([
            SpecialEvent(period=SpecialEventPeriod(calendarReference=oid("calendar", 1)), listOfTimeValues=[tv(0, 0, off)], eventPriority=1),
        ]),
        scheduleDefault=off, priorityForWriting=12, statusFlags=flags(), reliability=Reliability("no-fault-detected"),
        outOfService=False, listOfObjectPropertyReferences=ListOf(DeviceObjectPropertyReference)([ref("binary-value", 1)]),
    )


def trend_logs(logs: list[tuple[str, DeviceObjectPropertyReference]], multiple: tuple[str, list[DeviceObjectPropertyReference]], nc: int = 2) -> list:
    """trend-log 1.. for each (name, source), then trend-log-multiple 1 over several: polled once a minute, 5000 records."""
    tl = dict(
        enable=True, stopWhenFull=False, bufferSize=5000, logInterval=6000, statusFlags=flags(),
        eventState=EventState("normal"), loggingType="polled", alignIntervals=True, intervalOffset=0,
        notificationThreshold=1000, recordsSinceNotification=0, lastNotifyRecord=0, eventEnable=EventTransitionBits([0, 0, 0]),
        ackedTransitions=EventTransitionBits([1, 1, 1]), notifyType=NotifyType("event"),
        eventTimeStamps=ArrayOf(TimeStamp, _length=3)([ts(None), ts(None), ts(None)]), notificationClass=nc,
        recordCount=0, totalRecordCount=0,
    )
    objs = [TL(objectIdentifier=("trend-log", n), objectName=name, logDeviceObjectProperty=src, trigger=False, **tl) for n, (name, src) in enumerate(logs, start=1)]
    name, srcs = multiple
    objs.append(TLM(objectIdentifier=("trend-log-multiple", 1), objectName=name, logDeviceObjectProperty=ArrayOf(DeviceObjectPropertyReference)(srcs), **tl))
    return objs
