import assert from 'node:assert/strict'
import { groupPoints } from '../web/src/control.ts'

const point = (key, kind, choices = []) => ({ key, kind, datatype: kind === 'analog' ? 'Real' : kind === 'binary' ? 'BinaryPV' : 'Unsigned', units: kind === 'analog' ? 'degrees-celsius' : '', commandable: true, labelsComplete: true, choices })
const states = [{ value: 1, label: 'Off' }, { value: 2, label: 'Auto' }]
const points = [
  ...Array.from({ length: 10 }, (_, i) => point(`a${i}`, 'analog')),
  point('b', 'binary', [{ value: 0, label: 'Stopped' }, { value: 1, label: 'Running' }]),
  ...Array.from({ length: 4 }, (_, i) => point(`m${i}`, 'multistate', states)),
  point('m4', 'multistate', [{ value: 1, label: 'Auto' }, { value: 2, label: 'Off' }]),
]
assert.deepEqual(groupPoints(points).map((g) => g.length), [10, 1, 4, 1])
assert.equal(groupPoints([points[0], { ...points[0], key: 'percent', units: 'percent' }]).length, 2)
assert.equal(groupPoints([points[0], { ...points[0], key: 'direct', commandable: false }]).length, 2)
assert.equal(groupPoints([{ ...points[11], labelsComplete: false }, { ...points[12], labelsComplete: false }]).length, 2)
assert.equal(groupPoints([{ ...points[0], error: 'offline' }]).length, 0)
console.log('PASS: 10 analog + 1 binary + 4 matching multistates + 1 different mapping; units, direct writes, missing metadata and exclusions')
