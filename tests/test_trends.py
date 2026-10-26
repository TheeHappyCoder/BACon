"""Trend group tests: python -m unittest discover -s tests -v."""
import asyncio
import os
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from bacon.trends import TrendSession

DEVICES = {5101: SimpleNamespace(address='10.0.0.230', name='FCU-5101')}
ROWS = [
    {'device': 5101, 'typeId': 0, 'instance': 1, 'values': {'object-name': 'Room temperature', 'units': 'degrees-celsius'}},
    {'device': 5101, 'typeId': 3, 'instance': 1, 'values': {'object-name': 'Window contact'}},
]


class TrendGroups(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {'LOCALAPPDATA': tempfile.mkdtemp()})
        self.env.start()
        self.session = TrendSession(SimpleNamespace(app=None))

    def tearDown(self):
        self.session.db.close()
        self.env.stop()

    def record(self):
        s = self.session
        chiller = s.create_group('Chiller', 30, 'poll')
        ids = s.add_to_group(chiller.id, ROWS, DEVICES)
        t0 = time.time() - 100
        temp, window = s.points[ids[0]], s.points[ids[1]]
        for k, (v, w) in enumerate([('20', 'inactive'), ('22', 'active'), ('22', 'inactive'), ('24', 'active')]):
            s._record(temp, v, t0 + k * 25)
            s._record(window, w, t0 + k * 25)
        return chiller, ids, t0

    def test_a_point_in_two_groups_is_recorded_once(self):
        s = self.session
        chiller, ids, _ = self.record()
        room = s.create_group('Room', 10, 'auto')
        self.assertEqual(s.add_to_group(room.id, ROWS[:1], DEVICES), [ids[0]])
        self.assertEqual(len(s.points), 2)
        s.groups[chiller.id].running = s.groups[room.id].running = True
        wanted = s._wanted()
        # on change from Room, every 30 s from Chiller; the window contact only from Chiller
        self.assertEqual(wanted[ids[0]], {'cov': True, 'every': 30, 'fallback': 10})
        self.assertEqual(wanted[ids[1]], {'cov': False, 'every': 30, 'fallback': None})

    def test_stats_are_time_weighted_with_state_shares(self):
        _, ids, t0 = self.record()
        st = self.session.stats(ids, t0, t0 + 100)
        temp, window = st[str(ids[0])], st[str(ids[1])]
        self.assertEqual((temp['min'], temp['max']), (20, 24))
        self.assertAlmostEqual(temp['avg'], 22)
        self.assertEqual(window['changes'], 3)
        self.assertAlmostEqual(window['states']['active'], 50)
        # the value in force before the range counts from the range's start
        later = self.session.stats(ids[:1], t0 + 30, t0 + 100)[str(ids[0])]
        self.assertAlmostEqual(later['avg'], (22 * 45 + 24 * 25) / 70)

    def test_a_restart_keeps_groups_points_and_history(self):
        _, ids, _ = self.record()
        self.session.flush()
        self.session.db.close()
        self.session = TrendSession(SimpleNamespace(app=None))
        self.assertEqual([g.name for g in self.session.groups.values()], ['Chiller'])
        self.assertEqual(self.session.points[ids[0]].samples, 4)
        self.assertEqual(self.session.points[ids[0]].last, '24')

    def test_deleting_a_group_keeps_points_another_group_records(self):
        s = self.session
        chiller, ids, _ = self.record()
        room = s.create_group('Room', 10, 'auto')
        s.add_to_group(room.id, ROWS[:1], DEVICES)
        asyncio.run(s.delete_group(chiller.id))
        self.assertEqual(list(s.points), [ids[0]])
        self.assertEqual(s.db.execute('select count(*) from samples where point = ?', (ids[1],)).fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
