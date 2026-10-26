"""Control regression tests: python -m unittest discover -s tests -v."""
import asyncio
import copy
import unittest
from unittest.mock import AsyncMock
from types import SimpleNamespace

from bacpypes3.primitivedata import Enumerated, Unsigned, Null, Real
from bacpypes3.constructeddata import Any
from bacpypes3.primitivedata import ObjectIdentifier, CharacterString
from bacpypes3.vendor import get_vendor_info
from bacon.control import Control, encode, signature


def point(type_id=19):
    return dict(key=f'1:{type_id},1', device=1, typeId=type_id, instance=1, name='Mode',
        kind='multistate' if type_id == 19 else 'binary' if type_id == 5 else 'analog',
        choices=[{'value': 1, 'label': 'Off'}, {'value': 2, 'label': 'Auto'}] if type_id == 19 else [{'value': 0, 'label': 'Stopped'}, {'value': 1, 'label': 'Running'}] if type_id == 5 else [],
        current=1, slots=[None] * 16, commandable=True, units='', datatype='Unsigned',
        labelsComplete=True, minimum=None, maximum=None)


class Encoding(unittest.TestCase):
    def test_wire_types_and_indices(self):
        self.assertIsInstance(encode(point(), 2.0), Unsigned)
        self.assertIsInstance(encode(point(5), 1.0), Enumerated)
        self.assertIsInstance(encode(point(2), 21.5), Real)
        self.assertIsInstance(encode(point(), None, True), Null)
        for value in (0, 3, 1.5, True, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                encode(point(), value)

    def test_limits_and_direct_release(self):
        meta = point(2)
        meta.update(minimum=10, maximum=30)
        with self.assertRaises(ValueError): encode(meta, 31)
        meta['commandable'] = False
        with self.assertRaises(ValueError): encode(meta, None, True)
        meta.update(minimum=None, maximum=None)
        with self.assertRaises(ValueError): encode(meta, 1e40)
        self.assertEqual(float(encode(meta, 21.1)), 21.100000381469727)

    def test_mapping_signature(self):
        a, b = point(), point()
        b['choices'].reverse()
        self.assertNotEqual(signature(a), signature(b))


class Execution(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.meta = point()
        self.meta['signature'] = signature(self.meta)
        self.app = SimpleNamespace(request=AsyncMock())
        self.client = SimpleNamespace(app=self.app, _require=lambda: self.app)
        self.control = Control(self.client, {1: SimpleNamespace(saved_at='', address='127.0.0.1:47830')})
        self.control.metadata = AsyncMock(side_effect=lambda target: copy.deepcopy(self.meta))
        self.control.audit = lambda record: None
        self.target = {k: self.meta[k] for k in ('key', 'device', 'typeId', 'instance')}

    async def token(self):
        return (await self.control.prepare([self.target]))[0]['token']

    async def test_write_and_release(self):
        async def request(apdu):
            self.assertEqual(str(apdu.propertyIdentifier), 'present-value')
            self.assertEqual(apdu.priority, 8)
            tag = next(t for t in apdu.propertyValue.tagList if t.tag_class == 0)
            self.assertIn(tag.tag_number, (0, 2))
            value = None if tag.tag_number == 0 else int(apdu.propertyValue.cast_out(Unsigned))
            self.meta['slots'][7] = value
            self.meta['current'] = value or 1
        self.app.request.side_effect = request
        result = await self.control.execute(await self.token(), 2.0, 8, False)
        self.assertEqual(result['state'], 'verified')

        result = await self.control.execute(await self.token(), None, 8, True)
        self.assertEqual(result['message'], 'Released and verified.')

    async def test_higher_priority(self):
        self.meta['slots'][4] = 1
        async def request(apdu): self.meta['slots'][7] = 2
        self.app.request.side_effect = request
        result = await self.control.execute(await self.token(), 2, 8, False)
        self.assertIn('priority 5 is controlling', result['message'])

    async def test_stale_slot_and_mapping(self):
        token = await self.token()
        self.meta['slots'][7] = 1
        with self.assertRaisesRegex(ValueError, 'slot changed'): await self.control.execute(token, 2, 8, False)
        token = await self.token()
        self.meta['choices'][1]['label'] = 'Heat'
        self.meta['signature'] = signature(self.meta)
        with self.assertRaisesRegex(ValueError, 'configuration changed'): await self.control.execute(token, 2, 8, False)
        self.app.request.assert_not_called()

    async def test_timeout_replay_and_reserved_priority(self):
        token = await self.token()
        self.app.request.side_effect = asyncio.TimeoutError()
        result = await self.control.execute(token, 2, 8, False)
        self.assertEqual(result['state'], 'unknown')
        with self.assertRaisesRegex(ValueError, 'expired'): await self.control.execute(token, 2, 8, False)
        with self.assertRaisesRegex(ValueError, 'priority'): await self.control.execute(await self.token(), 2, 6, False)

    async def test_saved_site_and_reconnection(self):
        token = await self.token()
        self.client.app = object()
        with self.assertRaisesRegex(ValueError, 'expired'): await self.control.execute(token, 2, 8, False)
        self.control.devices[1].saved_at = 'yesterday'
        with self.assertRaisesRegex(ValueError, 'Rediscover'): self.control.device(self.target)

    async def test_direct_write_and_audit_failure(self):
        self.meta.update(commandable=False, slots=None)
        self.meta['signature'] = signature(self.meta)
        async def request(apdu):
            self.assertIsNone(apdu.priority)
            self.meta['current'] = 2
        self.app.request.side_effect = request
        result = await self.control.execute(await self.token(), 2, None, False)
        self.assertEqual(result['state'], 'verified')
        self.app.request.reset_mock()
        def failed_audit(record): raise OSError('disk full')
        self.control.audit = failed_audit
        with self.assertRaises(OSError): await self.control.execute(await self.token(), 1, None, False)
        self.app.request.assert_not_called()

    async def test_timeout_after_applied_write(self):
        async def request(apdu):
            self.meta['slots'][7] = 2
            self.meta['current'] = 2
            raise asyncio.TimeoutError()
        self.app.request.side_effect = request
        result = await self.control.execute(await self.token(), 2, 8, False)
        self.assertEqual(result['state'], 'verified')


class Metadata(unittest.IsolatedAsyncioTestCase):
    async def test_missing_and_duplicate_state_labels(self):
        cls = get_vendor_info(0).get_object_class(19)
        labels = ['Auto', 'Auto', '']
        async def rp(address, oid, pid):
            values = {75: ObjectIdentifier((8, 1)), 77: CharacterString('Mode'), 85: Unsigned(2),
                      74: Unsigned(3), 110: cls.get_property_type('state-text')(labels)}
            if pid not in values: raise ValueError('unknown-property')
            return Any(values[pid])
        client = SimpleNamespace(app=object(), rp=rp)
        control = Control(client, {1: SimpleNamespace(instance=1, saved_at='', address='127.0.0.1')})
        meta = await control.metadata(dict(device=1, typeId=19, instance=1, key='1:19,1'))
        self.assertFalse(meta['labelsComplete'])
        self.assertFalse(meta['commandable'])
        self.assertEqual(meta['choices'], [{'value': 1, 'label': 'Auto'}, {'value': 2, 'label': 'Auto'}, {'value': 3, 'label': 'State 3'}])


class FieldCodec(unittest.TestCase):
    """Any other property: JSON from the UI to the property's own datatype and back, refusing what does not fit."""
    def test_kinds(self):
        from bacon import props
        self.assertEqual(props.describe(2, 'relinquish-default')['kind'], 'real')
        self.assertEqual(props.describe(0, 'limit-enable')['bits'], ['low-limit-enable', 'high-limit-enable'])
        self.assertIn({'value': 1, 'label': 'reverse'}, props.describe(3, 'polarity')['choices'])
        self.assertEqual(props.describe(17, 'weekly-schedule')['kind'], 'weekly')
        self.assertIsNone(props.describe(2, 'present-value'))  # commanded through the priority path
        self.assertIsNone(props.describe(2, 'status-flags'))   # read-only

    def test_round_trips(self):
        from bacon import props
        week = [[{'time': '07:00:00', 'value': {'type': 'enumerated', 'value': 1}}, {'time': '18:00:00', 'value': {'type': 'null', 'value': None}}]] * 7
        cases = [(2, 'relinquish-default', 21.1, 21.1), (0, 'limit-enable', [True, False], [True, False]), (0, 'out-of-service', True, True),
                 (17, 'weekly-schedule', week, week), (17, 'schedule-default', {'type': 'real', 'value': 3.5}, {'type': 'real', 'value': 3.5}),
                 (17, 'effective-period', [[None, None, None, None], [2026, 12, 31, None]], [[None, None, None, None], [2026, 12, 31, None]]),
                 (6, 'date-list', [{'range': [[2026, 4, 3, None], [2026, 4, 6, None]]}], [{'range': [[2026, 4, 3, None], [2026, 4, 6, None]]}]),
                 (17, 'exception-schedule', [{'period': {'calendar': [6, 1]}, 'times': [], 'priority': 1}], [{'period': {'calendar': [6, 1]}, 'times': [], 'priority': 1}])]
        for type_id, prop, value, expected in cases:
            self.assertEqual(props.normal(type_id, prop, props.describe(type_id, prop), value), expected, prop)

    def test_refusals(self):
        from bacon import props
        for type_id, prop, value in [(2, 'relinquish-default', 'warm'), (2, 'relinquish-default', float('nan')), (0, 'time-delay', -1),
                                     (0, 'time-delay', 1.5), (0, 'limit-enable', [True]), (0, 'out-of-service', 'yes'), (3, 'polarity', 7),
                                     (17, 'weekly-schedule', [[]] * 6), (17, 'weekly-schedule', [[{'time': '25:00', 'value': {'type': 'real', 'value': 1}}]] + [[]] * 6),
                                     (17, 'exception-schedule', [{'period': {'date': [2026, 2, 1, None]}, 'times': [], 'priority': 17}])]:
            with self.assertRaises(ValueError, msg=(prop, value)):
                props.encode(type_id, prop, props.describe(type_id, prop), value)


if __name__ == '__main__': unittest.main()
