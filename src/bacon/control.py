"""Typed, live control of anything writable: a point's present value at a priority, or any other property (limits,
defaults, alarm settings, schedules). Display strings are never used as wire values.

Every write is reviewed (a token from prepare, holding what the property was), re-checked just before sending,
read back afterwards, and appended to the action log, so what BACon did can always be told apart from what the
controller did on its own.
"""
import asyncio
import hashlib
import json
import math
import os
import struct
import time
import uuid

from bacpypes3.apdu import AcknowledgeAlarmRequest, WritePropertyRequest, ErrorRejectAbortNack
from bacpypes3.constructeddata import Any
from bacpypes3.basetypes import DateTime, EventState, TimeStamp
from bacpypes3.primitivedata import CharacterString, Date, Null, ObjectIdentifier, PropertyIdentifier, Time, Unsigned
from bacpypes3.pdu import Address
from bacpypes3.vendor import get_vendor_info

from .client import BACnetError, error_text
from .paths import data_dir
from . import props

# inputs take a present value only while out of service (clause 12); the device refuses it otherwise
SUPPORTED = {0: 'analog', 1: 'analog', 2: 'analog', 3: 'binary', 4: 'binary', 5: 'binary', 13: 'multistate', 14: 'multistate', 19: 'multistate'}
OWN = 4194301  # BACon's own device instance, the acknowledging process


def signature(meta):
    fields = ('name', 'property', 'kind', 'datatype', 'units', 'choices', 'bits', 'labelsComplete', 'commandable', 'minimum', 'maximum')
    return hashlib.sha256(json.dumps({k: meta.get(k) for k in fields}, sort_keys=True).encode()).hexdigest()


def encode(meta, value, release=False):
    cls = get_vendor_info(0).get_object_class(meta['typeId'])
    datatype = cls.get_property_type('present-value')
    if release:
        if not meta['commandable']:
            raise ValueError('This point does not support priority release.')
        return Null(())
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Enter a finite numeric value.')
    if meta['kind'] != 'analog' and value not in [c['value'] for c in meta['choices']]:
        raise ValueError('Choose one of the available states.')
    for bound, compare in [('minimum', lambda a, b: a < b), ('maximum', lambda a, b: a > b)]:
        if meta.get(bound) is not None and compare(value, meta[bound]):
            raise ValueError(f"Value is outside the controller's {bound} ({meta[bound]}).")
    try:
        wire_value = struct.unpack('!f', struct.pack('!f', value))[0] if meta['kind'] == 'analog' else int(value)
    except (OverflowError, struct.error):
        raise ValueError('Value cannot be represented by the BACnet datatype.')
    result = datatype(wire_value)
    if not math.isfinite(float(result)):
        raise ValueError('Value cannot be represented by the BACnet datatype.')
    return result


class Control:
    def __init__(self, client, devices):
        self.client, self.devices = client, devices
        self.tokens = {}
        self.locks: dict[int, asyncio.Lock] = {}  # one write at a time per device; devices run side by side

    def lock(self, device):
        return self.locks.setdefault(device, asyncio.Lock())

    def device(self, target):
        device = self.devices.get(target['device'])
        if self.client.app is None:
            raise ValueError('Connect to a network first.')
        if device is None or device.saved_at:
            raise ValueError('Rediscover this device on the live network before writing.')
        return device

    async def identity(self, d):
        # Verify the live device identity, not just its remembered IP address.
        identity = await self.client.rp(d.address, ObjectIdentifier((8, d.instance)), 75)
        if tuple(identity.cast_out(ObjectIdentifier)) != (8, d.instance):
            raise ValueError('The device identity changed; rediscover it.')

    async def field(self, target):
        """Any other writable property: its kind, its current value as JSON, and the object's name."""
        d = self.device(target)
        prop = target['property']
        desc = props.describe(target['typeId'], prop)
        if desc is None:
            raise ValueError(f'BACon does not write {prop} on this kind of object.')
        oid = ObjectIdentifier((target['typeId'], target['instance']))
        await self.identity(d)
        raw = await self.client.rp(d.address, oid, int(PropertyIdentifier(prop)))
        name = await self.client.rp(d.address, oid, 77)
        meta = {**target, 'name': str(name.cast_out(CharacterString)), **desc, 'current': props.to_json(target['typeId'], prop, raw)}
        meta['signature'] = signature(meta)
        return meta

    async def metadata(self, target):
        d = self.device(target)
        kind = SUPPORTED.get(target['typeId'])
        if not kind:
            raise ValueError('Present value is commanded on analog, binary and multistate inputs, outputs and values.')
        cls = get_vendor_info(0).get_object_class(target['typeId'])
        oid = ObjectIdentifier((target['typeId'], target['instance']))

        async def read(prop, optional=False):
            from bacpypes3.primitivedata import PropertyIdentifier
            try:
                raw = await self.client.rp(d.address, oid, int(PropertyIdentifier(prop)))
                return raw.cast_out(cls.get_property_type(prop))
            except BACnetError as e:
                if optional and error_text(e) in ('unknown-property', 'unknownProperty'):
                    return None
                raise

        await self.identity(d)
        present = await read('present-value')
        priorities = await read('priority-array', True)
        slots = None
        if priorities is not None:
            slots = []
            for slot in priorities:
                if slot.null is not None:
                    slots.append(None)
                else:
                    values = [getattr(slot, name, None) for name in slot._elements]
                    actual = next((v for v in values if v is not None), None)
                    slots.append(float(actual) if kind == 'analog' else int(actual))
            if len(slots) != 16:
                raise ValueError('The controller returned an invalid priority array.')
        meta = {**target, 'property': 'present-value', 'name': str(await read('object-name')), 'kind': kind,
                'datatype': cls.get_property_type('present-value').__name__,
                'current': float(present) if kind == 'analog' else int(present),
                'units': '', 'choices': [], 'labelsComplete': True, 'commandable': slots is not None,
                'slots': slots, 'minimum': None, 'maximum': None}
        if not math.isfinite(meta['current']):
            raise ValueError('The controller returned a non-finite present value.')
        default = await read('relinquish-default', True) if slots is not None else None
        meta['relinquishDefault'] = float(default) if default is not None else None
        if meta['relinquishDefault'] is not None and not math.isfinite(meta['relinquishDefault']):
            raise ValueError('The controller returned an invalid relinquish default.')
        if kind == 'analog':
            units = await read('units', True)
            meta['units'] = str(units) if units is not None else 'unknown units'
            for key, prop in [('minimum', 'min-pres-value'), ('maximum', 'max-pres-value')]:
                val = await read(prop, True)
                if val is not None and not math.isfinite(float(val)):
                    raise ValueError('The controller returned an invalid numeric limit.')
                meta[key] = float(val) if val is not None else None
        elif kind == 'binary':
            for value, prop, fallback in [(0, 'inactive-text', 'Inactive'), (1, 'active-text', 'Active')]:
                label = await read(prop, True)
                meta['labelsComplete'] &= bool(label)
                meta['choices'].append({'value': value, 'label': str(label) if label else fallback})
        else:
            count = int(await read('number-of-states'))
            if not 1 <= count <= 4096:
                raise ValueError('Unsupported number of states.')
            labels = await read('state-text', True)
            labels = list(labels) if labels is not None else []
            meta['labelsComplete'] = len(labels) == count and all(bool(v) for v in labels)
            meta['choices'] = [{'value': i + 1, 'label': str(labels[i]) if i < len(labels) and labels[i] else f'State {i + 1}'} for i in range(count)]
        meta['signature'] = signature(meta)
        return meta

    async def prepare(self, targets):
        output = []
        # Bounded traffic; metadata reads are deliberately sequential per point.
        seen = set()
        for target in targets:
            prop = target.get('property') or 'present-value'
            identity = (target['device'], target['typeId'], target['instance'], prop)
            if identity in seen:
                continue
            seen.add(identity)
            try:
                meta = await (self.metadata(target) if prop == 'present-value' else self.field({**target, 'property': prop}))
                token = uuid.uuid4().hex
                self.tokens[token] = (time.time(), self.client.app, self.devices[target['device']].address, meta)
                output.append({**meta, 'token': token})
            except BACnetError as e:
                output.append({**target, 'error': error_text(e)})
            except ValueError as e:
                output.append({**target, 'error': str(e)})
        self.tokens = {k: v for k, v in self.tokens.items() if time.time() - v[0] < 1800}
        return output

    def audit(self, record):
        with open(os.path.join(data_dir('control'), 'actions.jsonl'), 'a', encoding='utf-8') as file:
            file.write(json.dumps({'at': time.time(), **record}, allow_nan=False) + '\n')
            file.flush()
            os.fsync(file.fileno())

    async def execute(self, token, value, priority=None, release=False):
        saved = self.tokens.pop(token, None)  # never replay an ambiguous command
        if not saved or time.time() - saved[0] > 1800 or saved[1] is not self.client.app:
            raise ValueError('This review expired. Reload the selection before writing.')
        async with self.lock(saved[3]['device']):
            if saved[3].get('property', 'present-value') != 'present-value':
                return await self.execute_field(saved, value)
            old = saved[3]
            target = {k: old[k] for k in ('device', 'typeId', 'instance', 'key')}
            d = self.device(target)
            if d.address != saved[2]:
                raise ValueError('Device address changed. Reload the selection.')
            meta = await self.metadata(target)
            if meta['signature'] != old['signature']:
                raise ValueError('Point configuration changed. Reload and review this group.')
            if meta['commandable']:
                if priority not in range(1, 17) or priority == 6:
                    raise ValueError('Choose priority 1–16, excluding reserved priority 6.')
                if meta['slots'][priority - 1] != old['slots'][priority - 1]:
                    raise ValueError('This priority slot changed since review. Reload before replacing it.')
            elif priority is not None:
                raise ValueError('Direct writes must not include a priority.')
            elif meta['current'] != old['current']:
                raise ValueError('The value changed since review. Reload before replacing it.')
            encoded = encode(meta, value, release)
            if saved[1] is not self.client.app:
                raise ValueError('The connection changed during verification. Reload the selection.')
            action = {'id': uuid.uuid4().hex, **target, 'property': 'present-value', 'name': meta['name'], 'kind': meta['kind'],
                      'units': meta['units'], 'choices': meta['choices'], 'before': meta['current'],
                      'slotBefore': meta['slots'][priority - 1] if priority else None,
                      'value': None if release else value, 'priority': priority, 'release': release}
            self.audit({**action, 'state': 'sending'})
            request = WritePropertyRequest(objectIdentifier=ObjectIdentifier((target['typeId'], target['instance'])),
                propertyIdentifier='present-value', propertyValue=Any(encoded), destination=Address(d.address))
            if priority is not None:
                request.priority = priority
            failure = None
            rejected = False
            try:
                await self.client._require().request(request)
            except BACnetError as e:
                failure = error_text(e)
                rejected = isinstance(e, ErrorRejectAbortNack)
            result = {**action, 'state': 'unknown', 'message': failure or 'Accepted; read-back unavailable.'}
            try:
                after = await self.metadata(target)
                result['current'] = after['current']
                result['slotAfter'] = after['slots'][priority - 1] if priority and after['slots'] else None
                desired = None if release else float(encoded)
                actual = after['slots'][priority - 1] if priority else after['current']
                match = actual == desired
                if rejected:
                    result.update(state='rejected', message=failure)
                elif match:
                    winner = next((i + 1 for i, v in enumerate(after['slots'] or []) if v is not None), None)
                    held = not release and priority and winner and winner < priority
                    result.update(state='verified', message='Released and verified.' if release else f'Command stored; priority {winner} is controlling.' if held else 'Applied and verified.')
                else:
                    result.update(message='Read-back does not match the request; inspect the point before retrying.')
            except BACnetError:
                if rejected:
                    result.update(state='rejected', message=failure)
            try:
                self.audit(result)
            except OSError:
                result['message'] += ' Result could not be saved to the action log.'
            return result

    async def execute_field(self, saved, value):
        """Write any other property: compare-and-set against the reviewed value, then read it back."""
        old = saved[3]
        target = {k: old[k] for k in ('device', 'typeId', 'instance', 'key', 'property')}
        d = self.device(target)
        if d.address != saved[2]:
            raise ValueError('Device address changed. Reload the selection.')
        meta = await self.field(target)
        if meta['signature'] != old['signature']:
            raise ValueError('Property configuration changed. Reload and review it.')
        if meta['current'] != old['current']:
            raise ValueError('The value changed since review. Reload before replacing it.')
        encoded = props.encode(target['typeId'], target['property'], meta, value)
        desired = props.normal(target['typeId'], target['property'], meta, value)
        if saved[1] is not self.client.app:
            raise ValueError('The connection changed during verification. Reload the selection.')
        action = {'id': uuid.uuid4().hex, **target, 'name': meta['name'], 'kind': meta['kind'], 'choices': meta.get('choices'),
                  'bits': meta.get('bits'), 'before': meta['current'], 'value': desired, 'priority': None, 'release': False}
        self.audit({**action, 'state': 'sending'})
        request = WritePropertyRequest(objectIdentifier=ObjectIdentifier((target['typeId'], target['instance'])),
            propertyIdentifier=target['property'], propertyValue=Any(encoded), destination=Address(d.address))
        failure, rejected = None, False
        try:
            await self.client._require().request(request)
        except BACnetError as e:
            failure = error_text(e)
            rejected = isinstance(e, ErrorRejectAbortNack)
        result = {**action, 'state': 'unknown', 'message': failure or 'Accepted; read-back unavailable.'}
        try:
            after = (await self.field(target))['current']
            result['current'] = after
            if rejected and after != desired:
                result.update(state='rejected', message=failure)
            elif after == desired:
                result.update(state='verified', message='Applied and verified.')
            else:
                result.update(message='Read-back does not match the request; inspect the property before retrying.')
        except BACnetError:
            if rejected:
                result.update(state='rejected', message=failure)
        try:
            self.audit(result)
        except OSError:
            result['message'] += ' Result could not be saved to the action log.'
        return result

    async def acknowledge(self, target, transition):
        """AcknowledgeAlarm for one transition of an object (0 to-offnormal, 1 to-fault, 2 to-normal), with the event
        time stamp the device itself reports for it, as the standard requires."""
        d = self.device(target)
        if transition not in (0, 1, 2):
            raise ValueError('Choose the transition to acknowledge.')
        oid = ObjectIdentifier((target['typeId'], target['instance']))
        cls = get_vendor_info(0).get_object_class(target['typeId'])
        async with self.lock(target['device']):
            await self.identity(d)
            raw = await self.client.rp(d.address, oid, int(PropertyIdentifier('event-time-stamps')))
            stamps = list(raw.cast_out(cls.get_property_type('event-time-stamps')))
            name = str((await self.client.rp(d.address, oid, 77)).cast_out(CharacterString))
            state = {0: 'offnormal', 1: 'fault', 2: 'normal'}[transition]
            if transition == 0:
                # to-offnormal covers every off-normal state: acknowledge the one the object is in
                raw = await self.client.rp(d.address, oid, int(PropertyIdentifier('event-state')))
                current = str(raw.cast_out(EventState))
                if current not in ('normal', 'fault'):
                    state = current
            lt = time.localtime()
            now = TimeStamp(dateTime=DateTime(date=Date((lt.tm_year - 1900, lt.tm_mon, lt.tm_mday, lt.tm_wday + 1)),
                                              time=Time((lt.tm_hour, lt.tm_min, lt.tm_sec, 0))))
            action = {'id': uuid.uuid4().hex, **target, 'property': 'acknowledge', 'name': name, 'kind': 'acknowledge',
                      'before': None, 'value': state, 'priority': None, 'release': False, 'transition': transition}
            self.audit({**action, 'state': 'sending'})
            request = AcknowledgeAlarmRequest(acknowledgingProcessIdentifier=Unsigned(OWN), eventObjectIdentifier=oid,
                eventStateAcknowledged=EventState(state), timeStamp=stamps[transition],
                acknowledgmentSource=CharacterString('BACon'), timeOfAcknowledgment=now, destination=Address(d.address))
            try:
                await self.client._require().request(request)
                result = {**action, 'state': 'verified', 'message': 'Acknowledged.'}
            except BACnetError as e:
                result = {**action, 'state': 'rejected' if isinstance(e, ErrorRejectAbortNack) else 'unknown', 'message': error_text(e)}
            self.audit(result)
            return result

    def actions(self, limit=500):
        """The action log, newest first (one entry per action, its final state), and the priority slots BACon still
        holds: commanded by BACon and not released by it since. The controller may have moved on; the UI compares."""
        path = os.path.join(data_dir('control'), 'actions.jsonl')
        merged: dict[str, dict] = {}
        try:
            with open(path, encoding='utf-8') as file:
                for line in file:
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    if 'id' in record:
                        merged[record['id']] = {**merged.get(record['id'], {}), **record}
        except FileNotFoundError:
            pass
        # records from before property writes name no property: they were all present-value commands
        ordered = sorted(({'property': 'present-value', **r} for r in merged.values()), key=lambda r: r.get('at', 0))
        slots: dict[tuple, dict] = {}
        for r in ordered:
            if r['property'] == 'present-value' and r.get('priority') and r.get('state') != 'sending':
                slot = (r['device'], r['typeId'], r['instance'], r['priority'])
                if r.get('release') and r.get('state') == 'verified':
                    slots.pop(slot, None)
                elif not r.get('release') and r.get('state') in ('verified', 'unknown'):
                    slots[slot] = r
        return {'actions': list(reversed(ordered))[:limit], 'held': list(slots.values())}
