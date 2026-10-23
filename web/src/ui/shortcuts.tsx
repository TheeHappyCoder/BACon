"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ShortcutModifier = "mod" | "shift" | "alt";

export type ShortcutBinding = {
  key: string;
  modifiers: ShortcutModifier[];
};

export type ShortcutDefinition = {
  id: string;
  label: string;
  description: string;
  defaultBinding: ShortcutBinding;
  group?: string;
  scope?: string;
  allowInEditable?: boolean;
  allowUnmodified?: boolean;
};

export type ResolvedShortcut = ShortcutDefinition & {
  binding: ShortcutBinding;
  customized: boolean;
};

type SetBindingResult =
  | { ok: true }
  | { ok: false; conflict: ResolvedShortcut };

type ShortcutRegistryContextValue = {
  commands: ResolvedShortcut[];
  recordingCommandId: string | null;
  setRecordingCommandId: (commandId: string | null) => void;
  setBinding: (commandId: string, binding: ShortcutBinding) => SetBindingResult;
  resetBinding: (commandId: string) => void;
  resetAllBindings: () => void;
  registerHandler: (commandId: string, handler: () => void) => () => void;
  executeCommand: (commandId: string) => boolean;
};

const ShortcutRegistryContext = createContext<ShortcutRegistryContextValue | null>(null);

const MODIFIER_ORDER: ShortcutModifier[] = ["mod", "shift", "alt"];
const RESERVED_MOD_KEYS = new Set(["l", "r", "t", "w", "n", "q"]);

function normalizeKey(key: unknown) {
  return typeof key === "string" ? key.toLowerCase() : "";
}

export function normalizeShortcutBinding(binding: ShortcutBinding): ShortcutBinding {
  const modifiers = Array.isArray(binding?.modifiers) ? binding.modifiers : [];
  return {
    key: normalizeKey(binding?.key),
    modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)),
  };
}

export function shortcutBindingId(binding: ShortcutBinding) {
  const normalized = normalizeShortcutBinding(binding);
  return [...normalized.modifiers, normalized.key].join("+");
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (!key || ["control", "meta", "shift", "alt"].includes(key)) return null;

  const modifiers: ShortcutModifier[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("mod");
  if (event.shiftKey) modifiers.push("shift");
  if (event.altKey) modifiers.push("alt");

  return normalizeShortcutBinding({ key, modifiers });
}

export function isAllowedShortcutBinding(binding: ShortcutBinding, allowUnmodified = false) {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized.key) return false;
  const hasModifier = normalized.modifiers.length > 0;
  const isFunctionKey = /^f(?:[1-9]|1[0-2])$/.test(normalized.key);

  if (!hasModifier && !isFunctionKey && !allowUnmodified) return false;
  if (
    normalized.modifiers.length === 1 &&
    normalized.modifiers[0] === "mod" &&
    RESERVED_MOD_KEYS.has(normalized.key)
  ) {
    return false;
  }

  if (["escape", "tab", " "].includes(normalized.key)) return false;
  return normalized.key !== "enter" || hasModifier;
}

export function shortcutScopesOverlap(left: ShortcutDefinition, right: ShortcutDefinition) {
  const leftScope = left.scope ?? "global";
  const rightScope = right.scope ?? "global";
  return leftScope === "global" || rightScope === "global" || leftScope === rightScope;
}

export function shortcutMatchesEvent(binding: ShortcutBinding, event: KeyboardEvent) {
  const normalized = normalizeShortcutBinding(binding);
  const eventKey = normalizeKey(event.key);
  if (!normalized.key || !eventKey) return false;
  return (
    eventKey === normalized.key &&
    (event.metaKey || event.ctrlKey) === normalized.modifiers.includes("mod") &&
    event.shiftKey === normalized.modifiers.includes("shift") &&
    event.altKey === normalized.modifiers.includes("alt")
  );
}

export function shortcutKeyLabels(binding: ShortcutBinding, isMac: boolean) {
  const normalized = normalizeShortcutBinding(binding);
  const labels: string[] = [];
  if (normalized.modifiers.includes("mod")) labels.push(isMac ? "⌘" : "Ctrl");
  if (normalized.modifiers.includes("shift")) labels.push(isMac ? "⇧" : "Shift");
  if (normalized.modifiers.includes("alt")) labels.push(isMac ? "⌥" : "Alt");
  const namedKeys: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    delete: isMac ? "⌫" : "Delete",
    enter: isMac ? "↵" : "Enter",
  };
  labels.push(namedKeys[normalized.key]
    ?? (normalized.key.length === 1
      ? normalized.key.toUpperCase()
      : normalized.key.replace(/^./, (value) => value.toUpperCase())));
  return labels;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function readOverrides(storageKey: string) {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ShortcutBinding] => {
        const value = entry[1] as Partial<ShortcutBinding> | null;
        return Boolean(value && typeof value.key === "string" && Array.isArray(value.modifiers));
      }),
    );
  } catch {
    return {};
  }
}

export function ShortcutRegistryProvider({
  definitions,
  storageKey,
  children,
}: {
  definitions: ShortcutDefinition[];
  storageKey: string;
  children: ReactNode;
}) {
  const [overrides, setOverrides] = useState<Record<string, ShortcutBinding>>({});
  const [loaded, setLoaded] = useState(false);
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(null);
  const handlersRef = useRef(new Map<string, Map<symbol, () => void>>());

  useEffect(() => {
    setOverrides(readOverrides(storageKey));
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(overrides));
    } catch {
      // Shortcuts continue working in memory when browser storage is unavailable.
    }
  }, [loaded, overrides, storageKey]);

  const commands = useMemo<ResolvedShortcut[]>(
    () => definitions.map((definition) => ({
      ...definition,
      binding: normalizeShortcutBinding(overrides[definition.id] ?? definition.defaultBinding),
      customized: Boolean(overrides[definition.id]),
    })),
    [definitions, overrides],
  );

  const registerHandler = useCallback((commandId: string, handler: () => void) => {
    const token = Symbol(commandId);
    const commandHandlers = handlersRef.current.get(commandId) ?? new Map<symbol, () => void>();
    commandHandlers.set(token, handler);
    handlersRef.current.set(commandId, commandHandlers);

    return () => {
      const current = handlersRef.current.get(commandId);
      current?.delete(token);
      if (current?.size === 0) handlersRef.current.delete(commandId);
    };
  }, []);

  const executeCommand = useCallback((commandId: string) => {
    const handlers = handlersRef.current.get(commandId);
    const handler = handlers ? Array.from(handlers.values()).at(-1) : undefined;
    if (!handler) return false;
    handler();
    return true;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (recordingCommandId) return;

      for (const command of commands) {
        if (!shortcutMatchesEvent(command.binding, event)) continue;
        if (!command.allowInEditable && isEditableTarget(event.target)) return;

        const handlers = handlersRef.current.get(command.id);
        const handler = handlers ? Array.from(handlers.values()).at(-1) : undefined;
        if (!handler) continue;

        event.preventDefault();
        handler();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commands, recordingCommandId]);

  const setBinding = useCallback((commandId: string, binding: ShortcutBinding): SetBindingResult => {
    const normalized = normalizeShortcutBinding(binding);
    const conflict = commands.find(
      (command) => command.id !== commandId
        && shortcutBindingId(command.binding) === shortcutBindingId(normalized)
        && shortcutScopesOverlap(command, definitions.find((item) => item.id === commandId) ?? command),
    );
    if (conflict) return { ok: false, conflict };

    const definition = definitions.find((item) => item.id === commandId);
    if (!definition) return { ok: true };

    setOverrides((current) => {
      const next = { ...current };
      if (shortcutBindingId(definition.defaultBinding) === shortcutBindingId(normalized)) {
        delete next[commandId];
      } else {
        next[commandId] = normalized;
      }
      return next;
    });
    return { ok: true };
  }, [commands, definitions]);

  const resetBinding = useCallback((commandId: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
  }, []);

  const resetAllBindings = useCallback(() => setOverrides({}), []);

  const value = useMemo<ShortcutRegistryContextValue>(() => ({
    commands,
    recordingCommandId,
    setRecordingCommandId,
    setBinding,
    resetBinding,
    resetAllBindings,
    registerHandler,
    executeCommand,
  }), [commands, executeCommand, recordingCommandId, registerHandler, resetAllBindings, resetBinding, setBinding]);

  return (
    <ShortcutRegistryContext.Provider value={value}>
      {children}
    </ShortcutRegistryContext.Provider>
  );
}

export function useShortcutRegistry() {
  const context = useContext(ShortcutRegistryContext);
  if (!context) throw new Error("useShortcutRegistry must be used inside ShortcutRegistryProvider.");
  return context;
}

export function useShortcutLabel(commandId: string, separator = "+") {
  const { commands } = useShortcutRegistry();
  const command = commands.find((item) => item.id === commandId);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return command ? shortcutKeyLabels(command.binding, isMac).join(separator) : "";
}

export function useShortcutCommand(commandId: string, handler: () => void, enabled = true) {
  const { registerHandler } = useShortcutRegistry();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return registerHandler(commandId, () => handlerRef.current());
  }, [commandId, enabled, registerHandler]);
}
