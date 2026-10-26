"""Any writable property, typed by the standard: what kind of value it takes, its current value as JSON, and how a
JSON value from the UI becomes the BACnet datatype on the wire. Display strings are never used as wire values.

JSON shapes match decode.structured(), so what the UI reads is what it writes back:
  real / unsigned / integer      a number
  boolean                        true / false
  string                         text
  enumerated                     the number, one of `choices`
  bits                           [bool, ...], one per name in `bits`
  string-array / unsigned-array  [text, ...] / [number, ...]
  atomic                         {"type", "value"}, as a schedule entry
  weekly                         seven days of [{"time": "hh:mm:ss", "value": atomic}]
  exceptions                     [{"period", "times", "priority"}]
  date-range                     [date, date], a date being [year, month, day, weekday] with null for any
  date-list                      [{"date"} | {"range"} | {"weekNDay"}]
"""
import math
import struct

from bacpypes3.basetypes import CalendarEntry, DailySchedule, DateRange, SpecialEvent, SpecialEventPeriod, TimeValue, WeekNDay
from bacpypes3.constructeddata import AnyAtomic
from bacpypes3.primitivedata import (
    BitString,
    Boolean,
    CharacterString,
    Date,
    Double,
    Enumerated,
    Integer,
    Null,
    ObjectIdentifier,
    Real,
    Time,
    Unsigned,
)
from bacpypes3.vendor import get_vendor_info

from .decode import _calendar_entry_json, _date_json, _times_json, value_json

# Properties the standard (or common practice) lets a workstation write. The device has the last word: a property it
# refuses comes back as write-access-denied and is reported as rejected. present-value goes through the command path.
WRITABLE = {
    'description', 'object-name', 'location', 'out-of-service', 'reliability', 'cov-increment', 'relinquish-default',
    'units', 'polarity', 'inactive-text', 'active-text', 'state-text', 'min-pres-value', 'max-pres-value',
    'minimum-on-time', 'minimum-off-time',
    # intrinsic alarming
    'high-limit', 'low-limit', 'deadband', 'limit-enable', 'event-enable', 'notification-class', 'time-delay',
    'time-delay-normal', 'alarm-value', 'notify-type', 'event-detection-enable', 'fault-high-limit', 'fault-low-limit',
    # schedules and calendars
    'weekly-schedule', 'exception-schedule', 'schedule-default', 'effective-period', 'priority-for-writing', 'date-list',
    # notification classes
    'priority', 'ack-required',
    # trend logs and loops
    'enable', 'log-interval', 'stop-when-full', 'setpoint', 'proportional-constant', 'integral-constant',
    'derivative-constant', 'update-interval',
}

# What an alarm on a point is made of, in the order a person sets it up.
ALARM_PROPS = ['event-enable', 'notification-class', 'high-limit', 'low-limit', 'deadband', 'limit-enable', 'alarm-value',
               'time-delay', 'time-delay-normal', 'notify-type']


def _type(type_id, prop):
    cls = get_vendor_info(0).get_object_class(type_id)
    return cls.get_property_type(prop) if cls is not None else None


def kind_of(datatype, prop):
    """The UI's kind for a datatype, or None when BACon cannot write it safely."""
    if datatype is None:
        return None
    name = datatype.__name__
    if prop == 'weekly-schedule':
        return 'weekly'
    if prop == 'exception-schedule':
        return 'exceptions'
    if prop == 'date-list':
        return 'date-list'
    if datatype is AnyAtomic:
        return 'atomic'
    if datatype is DateRange or issubclass(datatype, DateRange):
        return 'date-range'
    if name == 'ArrayOfCharacterString':
        return 'string-array'
    if name == 'ArrayOfUnsigned':
        return 'unsigned-array'
    if not isinstance(datatype, type):
        return None
    if issubclass(datatype, (Real, Double)):
        return 'real'
    if issubclass(datatype, Boolean):
        return 'boolean'
    if issubclass(datatype, Unsigned):
        return 'unsigned'
    if issubclass(datatype, Integer):
        return 'integer'
    if issubclass(datatype, CharacterString):
        return 'string'
    if issubclass(datatype, BitString) and getattr(datatype, '_bitstring_names', None):
        return 'bits'
    if issubclass(datatype, Enumerated) and getattr(datatype, '_enum_map', None):
        return 'enumerated'
    return None


def describe(type_id, prop):
    """{kind, choices?, bits?} for a property of an object type, or None when it is not writable here."""
    if prop not in WRITABLE:
        return None
    datatype = _type(type_id, prop)
    kind = kind_of(datatype, prop)
    if kind is None:
        return None
    out = {'kind': kind}
    if kind == 'enumerated':
        out['enum'] = datatype.__name__
        out['choices'] = [{'value': v, 'label': k} for k, v in sorted(datatype._enum_map.items(), key=lambda kv: kv[1])]
    if kind == 'bits':
        names = sorted(datatype._bitstring_names.items(), key=lambda kv: kv[1])
        out['bits'] = [k for k, _ in names][: datatype._bitstring_length]
    return out


def _f32(x):
    return float(f'{struct.unpack("!f", struct.pack("!f", float(x)))[0]:.7g}')


def to_json(type_id, prop, anyval):
    """A property value read from the device, as the JSON the UI edits."""
    datatype = _type(type_id, prop)
    kind = kind_of(datatype, prop)
    v = anyval.cast_out(datatype)
    if kind == 'real':
        return float(f'{float(v):.7g}')
    if kind in ('unsigned', 'integer', 'enumerated'):
        return int(v)
    if kind == 'boolean':
        return bool(int(v))
    if kind == 'string':
        return str(v)
    if kind == 'bits':
        return [bool(b) for b in list(v)][: datatype._bitstring_length]
    if kind == 'string-array':
        return [str(x) for x in v]
    if kind == 'unsigned-array':
        return [int(x) for x in v]
    if kind == 'atomic':
        return value_json(v)
    if kind == 'weekly':
        return [_times_json(day.daySchedule) for day in v]
    if kind == 'exceptions':
        out = []
        for ev in v:
            p = ev.period
            period = {'calendar': [int(p.calendarReference[0]), int(p.calendarReference[1])]} if p.calendarReference is not None else _calendar_entry_json(p.calendarEntry)
            out.append({'period': period, 'times': _times_json(ev.listOfTimeValues), 'priority': int(ev.eventPriority)})
        return out
    if kind == 'date-range':
        return [_date_json(v.startDate), _date_json(v.endDate)]
    if kind == 'date-list':
        return [x for x in (_calendar_entry_json(e) for e in v) if x is not None]
    raise ValueError('This property cannot be read as a value BACon can edit.')


# ---- JSON -> BACnet ---------------------------------------------------------------------------------------------------

def _num(value, what='a number'):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'Enter {what}.')
    return value


def _int(value, low=None, high=None):
    _num(value, 'a whole number')
    if int(value) != value:
        raise ValueError('Enter a whole number.')
    if (low is not None and value < low) or (high is not None and value > high):
        raise ValueError(f'Enter a whole number from {low} to {high}.' if high is not None else f'Enter a whole number of at least {low}.')
    return int(value)


def _date(d):
    if not isinstance(d, (list, tuple)) or len(d) != 4:
        raise ValueError('A date is [year, month, day, weekday].')
    y, m, day, dow = d
    y = 255 if y is None else _int(y, 1900, 2154) - 1900
    m = 255 if m is None else _int(m, 1, 14)
    day = 255 if day is None else _int(day, 1, 34)
    dow = 255 if dow is None else _int(dow, 1, 7)
    return Date((y, m, day, dow))


def _time(t):
    if t is None:
        return Time((255, 255, 255, 255))
    try:
        parts = [int(x) for x in str(t).split(':')]
    except ValueError:
        raise ValueError(f'"{t}" is not a time.')
    h, m, s = (parts + [0, 0])[:3]
    if not (0 <= h <= 23 and 0 <= m <= 59 and 0 <= s <= 59):
        raise ValueError(f'"{t}" is not a time.')
    return Time((h, m, s, 0))


def atomic(v):
    """A schedule value {type, value} as a primitive."""
    if not isinstance(v, dict) or 'type' not in v:
        raise ValueError('A schedule value needs a type.')
    t, x = v['type'], v.get('value')
    if t == 'null':
        return Null(())
    if t == 'boolean':
        if not isinstance(x, bool):
            raise ValueError('Choose true or false.')
        return Boolean(x)
    if t == 'enumerated':
        return Enumerated(_int(x, 0))
    if t == 'unsigned':
        return Unsigned(_int(x, 0))
    if t == 'integer':
        return Integer(_int(x))
    if t == 'real':
        return Real(_f32(_num(x)))
    if t == 'string':
        return CharacterString(str(x))
    raise ValueError(f'BACon cannot write a {t} schedule value.')


def _times(items):
    if not isinstance(items, list):
        raise ValueError('A day is a list of times and values.')
    out = []
    for it in items:
        if not isinstance(it, dict):
            raise ValueError('Each entry needs a time and a value.')
        out.append(TimeValue(time=_time(it.get('time')), value=atomic(it.get('value'))))
    return out


def _entry(e):
    if not isinstance(e, dict):
        raise ValueError('A calendar entry is a date, a range or a week-n-day.')
    if 'date' in e:
        return CalendarEntry(date=_date(e['date']))
    if 'range' in e:
        a, b = e['range']
        return CalendarEntry(dateRange=DateRange(startDate=_date(a), endDate=_date(b)))
    if 'weekNDay' in e:
        m, w, d = e['weekNDay']
        return CalendarEntry(weekNDay=WeekNDay(bytes([255 if m is None else _int(m, 1, 14), 255 if w is None else _int(w, 1, 9), 255 if d is None else _int(d, 1, 7)])))
    raise ValueError('A calendar entry is a date, a range or a week-n-day.')


def encode(type_id, prop, field, value):
    """The UI's JSON value as the property's BACnet datatype, refusing anything that does not fit it."""
    datatype = _type(type_id, prop)
    kind = field['kind']
    if kind == 'real':
        x = _f32(_num(value))
        if not math.isfinite(x):
            raise ValueError('Value cannot be represented by the BACnet datatype.')
        return datatype(x)
    if kind == 'unsigned':
        return datatype(_int(value, 0, 2**32 - 1))
    if kind == 'integer':
        return datatype(_int(value, -(2**31), 2**31 - 1))
    if kind == 'boolean':
        if not isinstance(value, bool):
            raise ValueError('Choose true or false.')
        return datatype(value)
    if kind == 'string':
        if not isinstance(value, str) or len(value) > 255:
            raise ValueError('Enter text of up to 255 characters.')
        return datatype(value)
    if kind == 'enumerated':
        if _int(value, 0) not in [c['value'] for c in field['choices']]:
            raise ValueError('Choose one of the listed options.')
        return datatype(int(value))
    if kind == 'bits':
        if not isinstance(value, list) or len(value) != len(field['bits']) or not all(isinstance(b, bool) for b in value):
            raise ValueError(f'Set each of: {", ".join(field["bits"])}.')
        return datatype([int(b) for b in value])
    if kind == 'string-array':
        if not isinstance(value, list) or not all(isinstance(s, str) and len(s) <= 255 for s in value):
            raise ValueError('Enter a list of texts.')
        return datatype(value)
    if kind == 'unsigned-array':
        if not isinstance(value, list):
            raise ValueError('Enter a list of numbers.')
        return datatype([_int(x, 0, 255) for x in value])
    if kind == 'atomic':
        return atomic(value)
    if kind == 'weekly':
        if not isinstance(value, list) or len(value) != 7:
            raise ValueError('A weekly schedule has seven days, Monday first.')
        return datatype([DailySchedule(daySchedule=_times(day)) for day in value])
    if kind == 'exceptions':
        if not isinstance(value, list):
            raise ValueError('Exceptions are a list.')
        events = []
        for ev in value:
            p = ev.get('period') if isinstance(ev, dict) else None
            if not isinstance(p, dict):
                raise ValueError('Each exception needs a date, a range, a week-n-day or a calendar.')
            period = (SpecialEventPeriod(calendarReference=ObjectIdentifier((_int(p['calendar'][0], 0, 1023), _int(p['calendar'][1], 0, 4194303))))
                      if 'calendar' in p else SpecialEventPeriod(calendarEntry=_entry(p)))
            events.append(SpecialEvent(period=period, listOfTimeValues=_times(ev.get('times', [])), eventPriority=Unsigned(_int(ev.get('priority', 16), 1, 16))))
        return datatype(events)
    if kind == 'date-range':
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError('An effective period is a start and an end date.')
        return DateRange(startDate=_date(value[0]), endDate=_date(value[1]))
    if kind == 'date-list':
        if not isinstance(value, list):
            raise ValueError('A date list is a list of entries.')
        return datatype([_entry(e) for e in value])
    raise ValueError('BACon cannot write this property.')


def normal(type_id, prop, field, value):
    """The value as the device will hold it (float32 reals, full times), so a read-back can be compared exactly."""
    from bacpypes3.constructeddata import Any
    return to_json(type_id, prop, Any(encode(type_id, prop, field, value)))
