import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { applyThemeMode } from '@/lib/theme';
import {
  onServiceLog,
  onServiceStatus,
  onServiceExit,
  onServicePorts,
  onScriptLog,
  onScriptStatus,
  onScriptExit,
  onGlobalScriptLog,
  onGlobalScriptStatus,
  onGlobalScriptExit,
  onDataChanged,
  getRunningServices,
  onShellExit,
  onTerminalState,
  sendOsNotification,
  onTerminalLayout,
} from '@/lib/tauri';
import { formatDuration, terminalDisplayName } from '@/lib/terminalNames';
import type { LogEntry } from '@/types';

/**
 * Everything a CortX window needs at boot, shared by the main window and the
 * Terminal window: initial data loads, backend event listeners (services,
 * scripts, shells, shell integration, shared terminal layout, file watcher),
 * "seen" tracking on focus, and the light / dark mode.
 */
export function useAppBootstrap() {
  const { loadProjects, loadSettings, loadGlobalScripts, loadTagDefinitions, loadScriptsConfig, loadTools, loadAliases, loadStatusDefinitions, loadApps } = useAppStore();

  // Keep track of whether listeners are set up
  const listenersSetUp = useRef(false);

  // Load initial data
  useEffect(() => {
    loadProjects();
    loadSettings();
    loadGlobalScripts();
    loadTagDefinitions();
    loadScriptsConfig();
    loadTools();
    loadAliases();
    loadStatusDefinitions();
    loadApps();

    // Shared terminal layout first (it decides which shells belong to this
    // window's dock), then the shells still alive in the backend.
    useTerminalLayoutStore
      .getState()
      .load()
      .finally(() => useAppStore.getState().loadShells());
    useAppStore.getState().loadTerminalStates();

    // Check for running services on startup
    getRunningServices().then((serviceIds) => {
      const { updateServiceStatus } = useAppStore.getState();
      serviceIds.forEach((serviceId) => {
        updateServiceStatus(serviceId, 'running');
      });
    });
  }, [loadProjects, loadSettings, loadGlobalScripts, loadTagDefinitions, loadScriptsConfig, loadTools, loadAliases, loadStatusDefinitions, loadApps]);

  // Set up event listeners - only once
  useEffect(() => {
    // Prevent duplicate listener setup
    if (listenersSetUp.current) return;
    listenersSetUp.current = true;

    // Service listeners
    let unlistenServiceLog: (() => void) | undefined;
    let unlistenServiceStatus: (() => void) | undefined;
    let unlistenServiceExit: (() => void) | undefined;
    let unlistenServicePorts: (() => void) | undefined;
    // Script listeners
    let unlistenScriptLog: (() => void) | undefined;
    let unlistenScriptStatus: (() => void) | undefined;
    let unlistenScriptExit: (() => void) | undefined;
    // Global script listeners
    let unlistenGlobalScriptLog: (() => void) | undefined;
    let unlistenGlobalScriptStatus: (() => void) | undefined;
    let unlistenGlobalScriptExit: (() => void) | undefined;
    // Shell (integrated terminal tab) listener
    let unlistenShellExit: (() => void) | undefined;
    let unlistenTerminalState: (() => void) | undefined;
    let unlistenTerminalLayout: (() => void) | undefined;
    // Data change listener (file watcher)
    let unlistenDataChanged: (() => void) | undefined;
    let isCancelled = false;

    const setupListeners = async () => {
      // Service event listeners
      unlistenServiceLog = await onServiceLog((payload) => {
        if (isCancelled) return;
        const { appendServiceLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendServiceLog(payload.serviceId, logEntry);
      });

      unlistenServiceStatus = await onServiceStatus((payload) => {
        if (isCancelled) return;
        const { updateServiceStatus } = useAppStore.getState();
        updateServiceStatus(payload.serviceId, payload.status, payload.pid, payload.activeMode, payload.activeArgPreset);
      });

      unlistenServiceExit = await onServiceExit((payload) => {
        if (isCancelled) return;
        console.log(`Service ${payload.serviceId} exited with code ${payload.exitCode}`);
      });

      unlistenServicePorts = await onServicePorts((payload) => {
        if (isCancelled) return;
        const { updateServiceDetectedPorts } = useAppStore.getState();
        updateServiceDetectedPorts(payload.serviceId, payload.ports);
      });

      // Script event listeners
      unlistenScriptLog = await onScriptLog((payload) => {
        if (isCancelled) return;
        const { appendScriptLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendScriptLog(payload.scriptId, logEntry);
      });

      unlistenScriptStatus = await onScriptStatus((payload) => {
        if (isCancelled) return;
        const { updateScriptStatus } = useAppStore.getState();
        updateScriptStatus(payload.scriptId, payload.status, payload.pid);
      });

      unlistenScriptExit = await onScriptExit((payload) => {
        if (isCancelled) return;
        console.log(`Script ${payload.scriptId} exited with code ${payload.exitCode}, success: ${payload.success}`);
        const { setScriptExitResult } = useAppStore.getState();
        setScriptExitResult(payload.scriptId, payload.exitCode, payload.success);
      });

      // Global script event listeners
      unlistenGlobalScriptLog = await onGlobalScriptLog((payload) => {
        if (isCancelled) return;
        const { appendGlobalScriptLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendGlobalScriptLog(payload.scriptId, logEntry);
      });

      unlistenGlobalScriptStatus = await onGlobalScriptStatus((payload) => {
        if (isCancelled) return;
        const { updateGlobalScriptStatus } = useAppStore.getState();
        updateGlobalScriptStatus(payload.scriptId, payload.status, payload.pid);
      });

      unlistenGlobalScriptExit = await onGlobalScriptExit((payload) => {
        if (isCancelled) return;
        console.log(`Global script ${payload.scriptId} exited with code ${payload.exitCode}, success: ${payload.success}`);
        const { setGlobalScriptExitResult, updateExecutionRecordOnExit } = useAppStore.getState();
        setGlobalScriptExitResult(payload.scriptId, payload.exitCode, payload.success);
        updateExecutionRecordOnExit(payload.scriptId, payload.exitCode ?? null, payload.success);
      });

      unlistenShellExit = await onShellExit((payload) => {
        if (isCancelled) return;
        const { markShellExited } = useAppStore.getState();
        markShellExited(payload.shellId, payload.exitCode);
      });

      // Shell integration: cwd / running command / exit codes. A long command
      // that ends in a tab you are not looking at gets a toast, plus an OS
      // notification when the window is in the background.
      unlistenTerminalState = await onTerminalState((payload) => {
        if (isCancelled) return;
        const store = useAppStore.getState();
        const finished = store.applyTerminalState(payload);
        if (!finished || finished.inView) return;
        const cfg = store.settings?.terminal;
        if (cfg?.notifyOnLongCommand === false) return;
        const threshold = (cfg?.longCommandSeconds ?? 10) * 1000;
        if (finished.durationMs < threshold) return;
        const { name, projectName } = terminalDisplayName(payload.terminalId, store);
        const ok = finished.exitCode == null || finished.exitCode === 0;
        const title = projectName ? `${name} · ${projectName}` : name;
        const body = `${finished.command ?? 'Command'} ${ok ? 'finished' : `failed (exit ${finished.exitCode})`} in ${formatDuration(finished.durationMs)}`;
        (ok ? toast.success : toast.error)(title, { description: body });
        if (!document.hasFocus()) sendOsNotification(title, body).catch(() => {});
      });

      // Shared terminal layout written by the other window.
      unlistenTerminalLayout = await onTerminalLayout((event) => {
        if (isCancelled) return;
        useTerminalLayoutStore.getState().applyRemote(event);
      });

      // File watcher: reload all data when external changes detected
      unlistenDataChanged = await onDataChanged(() => {
        if (isCancelled) return;
        const store = useAppStore.getState();
        store.loadProjects();
        store.loadGlobalScripts();
        store.loadTagDefinitions();
        store.loadSettings();
        store.loadTools();
        store.loadAliases();
        store.loadStatusDefinitions();
        store.loadApps();
      });
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenServiceLog?.();
      unlistenServiceStatus?.();
      unlistenServiceExit?.();
      unlistenServicePorts?.();
      unlistenScriptLog?.();
      unlistenScriptStatus?.();
      unlistenScriptExit?.();
      unlistenGlobalScriptLog?.();
      unlistenGlobalScriptStatus?.();
      unlistenGlobalScriptExit?.();
      unlistenShellExit?.();
      unlistenTerminalState?.();
      unlistenTerminalLayout?.();
      unlistenDataChanged?.();
      listenersSetUp.current = false;
    };
  }, []);

  // Coming back to the window counts as "seen" for the tabs on screen.
  useEffect(() => {
    const onFocus = () => useAppStore.getState().markVisibleTerminalsSeen();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Light / dark mode follows the app settings (and the OS when "system").
  const themeMode = useAppStore((state) => state.settings?.appearance.theme);
  useEffect(() => {
    // Default to dark while settings load.
    if (!themeMode) {
      document.documentElement.classList.add('dark');
      return;
    }
    applyThemeMode(themeMode);
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeMode('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode]);
}
