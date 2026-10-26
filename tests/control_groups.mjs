import assert from 'node:assert/strict'
import { convert, convertDelta, groupPoints, meaningOf, stateFor } from '../web/src/control.ts'

const point = (key, kind, choices = [], extra = {}) => ({
  key, name: extra.name ?? '', kind, datatype: kind === 'analog' ? 'Real' : kind === 'binary' ? 'BinaryPV' : 'Unsigned',
  units: kind === 'analog' ? 'degrees-celsius' : '', commandable: true, labelsComplete: true, choices, current: 0, minimum: null, maximum: null, ...extra,
})
const states = [{ value: 1, label: 'Off' }, { value: 2, label: 'Auto' }]
const sizes = (gs) => gs.map((g) => g.points.length)

// the same state labels group together whatever each controller numbers them, and each point keeps its own numbers
const points = [
  ...Array.from({ length: 10 }, (_, i) => point(`a${i}`, 'analog')),
  point('b', 'binary', [{ value: 0, label: 'Stopped' }, { value: 1, label: 'Running' }]),
  ...Array.from({ length: 4 }, (_, i) => point(`m${i}`, 'multistate', states)),
  point('m4', 'multistate', [{ value: 1, label: 'Auto' }, { value: 2, label: 'Off' }]),
]
assert.deepEqual(sizes(groupPoints(points)), [10, 1, 5])
assert.equal(stateFor(points[15], 'auto'), 1)
assert.equal(stateFor(points[11], 'Auto'), 2)
assert.equal(groupPoints([points[11], point('m5', 'multistate', [{ value: 1, label: 'Off' }, { value: 2, label: 'Hand' }])]).length, 2)

// °C and °F take one value, converted; a percentage does not; priority and direct writes share a group
assert.equal(groupPoints([points[0], { ...points[0], key: 'f', units: 'degrees-fahrenheit' }]).length, 1)
assert.equal(groupPoints([points[0], { ...points[0], key: 'percent', units: 'percent' }]).length, 2)
assert.equal(groupPoints([points[0], { ...points[0], key: 'direct', commandable: false }]).length, 1)
assert.equal(groupPoints([points[0], { ...points[0], key: 'k', units: 'delta-degrees-kelvin' }]).length, 2)
assert.equal(convert(21, 'degrees-celsius', 'degrees-fahrenheit'), 69.8)
assert.equal(convertDelta(1, 'degrees-celsius', 'degrees-fahrenheit'), 1.8)
assert.equal(convertDelta(1.8, 'delta-degrees-fahrenheit', 'delta-degrees-kelvin'), 1)

// by meaning: the same name on every AHU groups; a different name does not
assert.equal(meaningOf('AHU-1 Supply air setpoint'), meaningOf('ahu_2 supply air setpoint'))
assert.equal(groupPoints([point('s1', 'analog', [], { name: 'AHU-1 Supply air setpoint' }), point('s2', 'analog', [], { name: 'AHU-2 Supply air setpoint' })]).length, 1)
assert.equal(groupPoints([point('s1', 'analog', [], { name: 'Supply air setpoint' }), point('r1', 'analog', [], { name: 'Room setpoint' })]).length, 2)

// missing metadata stays apart; points that failed to prepare are left out
assert.equal(groupPoints([{ ...points[11], labelsComplete: false }, { ...points[12], labelsComplete: false }]).length, 2)
assert.equal(groupPoints([{ ...points[0], units: 'unknown units' }, { ...points[1], units: 'unknown units' }]).length, 2)
assert.equal(groupPoints([{ ...points[0], error: 'offline' }]).length, 0)
console.log('PASS: labels across numberings, °C/°F conversion, mixed priority/direct, grouping by meaning, missing metadata and exclusions')
