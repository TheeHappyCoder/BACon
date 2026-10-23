"use client";

import { useEffect, useState } from "react";
import { Hugeicons } from "./hugeicons";
const { Undo } = Hugeicons;

import {
  isAllowedShortcutBinding,
  shortcutFromKeyboardEvent,
  shortcutKeyLabels,
  useShortcutRegistry,
  type ResolvedShortcut,
} from "../shortcuts";
import { cn } from "../utils";
import { Button } from "./button";
import { Kbd, KbdGroup } from "./kbd";
import { SquircleSurface } from "./squircle-surface";

export function ShortcutRow({ command }: { command: ResolvedShortcut }) {
  const {
    recordingCommandId,
    resetBinding,
    setBinding,
    setRecordingCommandId,
  } = useShortcutRegistry();
  const [error, setError] = useState<string | null>(null);
  const recording = recordingCommandId === command.id;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    if (!recording) return;

    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingCommandId(null);
        setError(null);
        return;
      }

      const binding = shortcutFromKeyboardEvent(event);
      if (!binding) return;
      if (!isAllowedShortcutBinding(binding, command.allowUnmodified)) {
        setError(command.allowUnmodified
          ? "Choose a safe command key. Escape, Enter, and Tab stay reserved."
          : "Use a modifier with a safe key, or choose F1–F12.");
        return;
      }

      const result = setBinding(command.id, binding);
      if (!result.ok) {
        setError(`Already used by ${result.conflict.label}.`);
        return;
      }

      setError(null);
      setRecordingCommandId(null);
    };

    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [command.id, recording, setBinding, setRecordingCommandId]);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium text-title">{command.label}</p>
          <p className="mt-1 max-w-xl text-[0.75rem] leading-5 text-description">
            {command.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={recording ? `Recording ${command.label} shortcut` : `Change ${command.label} shortcut`}
            onClick={() => {
              setError(null);
              setRecordingCommandId(recording ? null : command.id);
            }}
            className={cn("min-w-28", recording && "border-ring ring-2 ring-ring/20")}
          >
            {recording ? (
              "Press keys…"
            ) : (
              <KbdGroup>
                {shortcutKeyLabels(command.binding, isMac).map((label) => (
                  <Kbd key={label}>{label}</Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!command.customized}
            aria-label={`Reset ${command.label} shortcut`}
            title="Reset shortcut"
            onClick={() => {
              resetBinding(command.id);
              setError(null);
            }}
          >
            <Undo aria-hidden="true" />
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[0.6875rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Commands in registry order, grouped by their group label ("Global" when none). */
export function groupShortcuts(commands: readonly ResolvedShortcut[]) {
  return commands.reduce<Array<{ label: string; commands: ResolvedShortcut[] }>>((result, command) => {
    const label = command.group ?? "Global";
    const current = result.at(-1);
    if (current?.label === label) current.commands.push(command);
    else result.push({ label, commands: [command] });
    return result;
  }, []);
}

export function ShortcutSettingsList({ className }: { className?: string }) {
  const { commands } = useShortcutRegistry();
  const groups = groupShortcuts(commands);

  return (
    <div className={cn("flex flex-col gap-9", className)}>
      {groups.map((group) => (
        <section
          key={group.label}
          aria-labelledby={`shortcut-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`}
          className="space-y-4"
        >
          <h2
            id={`shortcut-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`}
            className="text-[1.0625rem] font-normal leading-6 tracking-[-0.02em] text-title"
          >
            {group.label}
          </h2>
          <SquircleSurface className="border border-border p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <div className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background">
              {group.commands.map((command) => (
                <ShortcutRow key={command.id} command={command} />
              ))}
            </div>
          </SquircleSurface>
        </section>
      ))}
    </div>
  );
}
