"""Trend log buffers and the ReadRange service over them.

Each log keeps (sequence number, time, value) records. The history is the room model's own past, so a controller
that has "been running for three days" shows believable nights, mornings and weekends the moment it starts.
"""

import time

from bacpypes3.apdu import ReadRangeACK
from bacpypes3.basetypes import (
    DateTime,
    LogData,
    LogDataLogData,
    LogMultipleRecord,
    LogRecord,
    LogRecordLogDatum,
    ResultFlags,
    StatusFlags,
)
from bacpypes3.constructeddata import Any, SequenceOf
from bacpypes3.errors import ExecutionError
from bacpypes3.primitivedata import Date, Enumerated, Real, Time

MAX_RECORDS = 5000
PER_RESPONSE = 60  # what fits in one unsegmented response


def stamp(t: float) -> DateTime:
    lt = time.localtime(t)
    return DateTime(
        date=Date((lt.tm_year - 1900, lt.tm_mon, lt.tm_mday, lt.tm_wday + 1)),
        time=Time((lt.tm_hour, lt.tm_min, lt.tm_sec, 0)),
    )


class Log:
    def __init__(self, key: tuple[str, int], multiple: bool = False):
        self.key = key
        self.multiple = multiple
        self.records: list[tuple[int, float, object]] = []
        self.next_seq = 1

    def add(self, t: float, value) -> None:
        self.records.append((self.next_seq, t, value))
        self.next_seq += 1
        del self.records[:-MAX_RECORDS]

    def clear(self) -> None:
        self.records.clear()  # sequence numbers keep counting, as on a real controller

    def encode(self, items) -> Any:
        if self.multiple:
            return Any(SequenceOf(LogMultipleRecord)([
                LogMultipleRecord(timestamp=stamp(t), logData=LogData(logData=[LogDataLogData(realValue=Real(x)) for x in v]))
                for _, t, v in items
            ]))
        return Any(SequenceOf(LogRecord)([
            LogRecord(
                timestamp=stamp(t),
                logDatum=LogRecordLogDatum(enumValue=Enumerated(v)) if isinstance(v, bool) else LogRecordLogDatum(realValue=Real(v)),
                statusFlags=StatusFlags([0, 0, 0, 0]),
            )
            for _, t, v in items
        ]))

    def select(self, r) -> list:
        """The records a ReadRange asks for: everything, by position, by sequence number or by time."""
        rec = self.records
        if r is None or (r.byPosition is None and r.bySequenceNumber is None and r.byTime is None):
            return rec
        if r.byPosition is not None:
            ref, count = int(r.byPosition.referenceIndex), int(r.byPosition.count)
            i = ref - 1
            return rec[i : i + count] if count > 0 else rec[max(0, i + count + 1) : i + 1]
        if r.bySequenceNumber is not None:
            ref, count = int(r.bySequenceNumber.referenceSequenceNumber), int(r.bySequenceNumber.count)
            if count > 0:
                return [x for x in rec if x[0] >= ref][:count]
            return [x for x in rec if x[0] <= ref][count:]
        d, t = tuple(r.byTime.referenceTime.date), tuple(r.byTime.referenceTime.time)
        when = time.mktime((d[0] + 1900, d[1], d[2], t[0], t[1], t[2], 0, 0, -1))
        count = int(r.byTime.count)
        return [x for x in rec if x[1] > when][:count] if count > 0 else [x for x in rec if x[1] < when][count:]

    def ack(self, apdu) -> ReadRangeACK:
        if int(apdu.propertyIdentifier) != 131:  # log-buffer
            raise ExecutionError(errorClass="property", errorCode="property-is-not-a-list")
        items = self.select(apdu.range)
        more = len(items) > PER_RESPONSE
        if apdu.range is not None and apdu.range.byPosition is not None and int(apdu.range.byPosition.count) < 0:
            items = items[-PER_RESPONSE:]  # reading backwards keeps the newest end
        else:
            items = items[:PER_RESPONSE]
        first = bool(items) and items[0] is self.records[0]
        last = bool(items) and items[-1] is self.records[-1]
        return ReadRangeACK(
            context=apdu,
            objectIdentifier=apdu.objectIdentifier,
            propertyIdentifier=apdu.propertyIdentifier,
            resultFlags=ResultFlags([1 if first else 0, 1 if last else 0, 1 if more else 0]),
            itemCount=len(items),
            itemData=self.encode(items),
            firstSequenceNumber=items[0][0] if items else None,
        )
