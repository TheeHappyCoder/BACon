/** The device's power switch: a rocker with a lit dot while it's on. Off cuts the device off the network. */
export function PowerSwitch({ on, onChange, booting }: { on: boolean; onChange: (on: boolean) => void; booting?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={on ? 'Switch the device off' : 'Switch the device on'}
      title={on ? 'Switch off: the device stops answering, as if its power was cut' : 'Switch on: the device boots and announces itself'}
      onClick={() => onChange(!on)}
      className="group inline-flex h-8 items-center gap-2 rounded-full border border-(--border-default) bg-(--surface-card) pr-3 pl-1 text-[12px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:border-(--border-strong)"
    >
      <span className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-200 ${on ? 'bg-(--ink)' : 'bg-(--surface-track)'}`}>
        <span
          className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] ${on ? 'left-[19px]' : 'left-[3px]'}`}
        />
        <span
          className={`absolute left-[9px] size-[5px] rounded-full transition-opacity ${booting ? 'bg-[#ffb02e]' : 'bg-[#6ed36b]'} ${on ? 'opacity-100' : 'opacity-0'}`}
          style={{ boxShadow: on ? `0 0 5px ${booting ? '#ffb02e' : '#6ed36b'}` : undefined }}
        />
      </span>
      <span className="w-6 text-left">{on ? 'On' : 'Off'}</span>
    </button>
  )
}
