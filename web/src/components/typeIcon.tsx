import { Hugeicons } from '../ui/components/hugeicons'

const { Activity, ToggleLeft, List, Box, Calendar, Bell, File, LineChart, Layers, Settings2, Workflow, Type, Hash, Network } = Hugeicons

/** An icon for a BACnet object type, by its name: analogs are a wave, binaries a switch, schedules a calendar… */
export function typeIcon(type: string) {
  if (type.startsWith('analog')) return <Activity />
  if (type.startsWith('binary')) return <ToggleLeft />
  if (type.startsWith('multi-state')) return <List />
  if (type.includes('schedule') || type.includes('calendar')) return <Calendar />
  if (type.includes('notification') || type.includes('event')) return <Bell />
  if (type === 'file') return <File />
  if (type.includes('trend') || type.includes('log')) return <LineChart />
  if (type.includes('loop') || type === 'program') return <Workflow />
  if (type.includes('characterstring') || type.includes('octetstring')) return <Type />
  if (type.includes('accumulator') || type.includes('integer')) return <Hash />
  if (type.includes('network')) return <Network />
  if (type.includes('view') || type.startsWith('type-')) return <Layers />
  if (type === 'device') return <Settings2 />
  return <Box />
}
