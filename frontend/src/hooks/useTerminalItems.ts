import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { shellTabName } from '@/lib/terminalNames';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';

/**
 * Every known terminal (services, project scripts, global scripts, shells)
 * as display items, with live shell-integration state. Shared by the dock and
 * the Terminal window.
 */
export function useTerminalItems(): TerminalItem[] {
  const { serviceRuntimes, scriptRuntimes, globalScriptRuntimes, shellRuntimes, globalScripts, projects, terminalStates, terminalAttention } = useAppStore();

  // Get service info helper
  const getServiceInfo = useCallback(
    (serviceId: string) => {
      let serviceName = serviceId;
      let projectName = '';
      let projectId = '';
      for (const project of projects) {
        const service = project.services.find((s) => s.id === serviceId);
        if (service) {
          serviceName = service.name;
          projectName = project.name;
          projectId = project.id;
          break;
        }
      }
      return { serviceName, projectName, projectId };
    },
    [projects]
  );

  // Get script info helper
  const getScriptInfo = useCallback(
    (scriptId: string) => {
      let scriptName = scriptId;
      let projectName = '';
      let projectId = '';
      for (const project of projects) {
        const script = project.scripts?.find((s) => s.id === scriptId);
        if (script) {
          scriptName = script.name;
          projectName = project.name;
          projectId = project.id;
          break;
        }
      }
      return { scriptName, projectName, projectId };
    },
    [projects]
  );

  // Build unified list of all terminal items (services + scripts)
  const allTerminals = useMemo(() => {
    const items: TerminalItem[] = [];

    // Add services
    for (const [serviceId, runtime] of serviceRuntimes.entries()) {
      const { serviceName, projectName, projectId } = getServiceInfo(serviceId);
      items.push({
        id: `service:${serviceId}`,
        type: 'service',
        name: serviceName,
        projectName,
        projectId,
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: runtime.detectedPorts,
        activeMode: runtime.activeMode,
        shell: terminalStates.get(`service:${serviceId}`),
        attention: terminalAttention.get(`service:${serviceId}`),
      });
    }

    // Add scripts
    for (const [scriptId, runtime] of scriptRuntimes.entries()) {
      const { scriptName, projectName, projectId } = getScriptInfo(scriptId);
      items.push({
        id: `script:${scriptId}`,
        type: 'script',
        name: scriptName,
        projectName,
        projectId,
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: [],
        lastExitCode: runtime.lastExitCode,
        lastSuccess: runtime.lastSuccess,
        shell: terminalStates.get(`script:${scriptId}`),
        attention: terminalAttention.get(`script:${scriptId}`),
      });
    }

    // Add global scripts
    for (const [scriptId, runtime] of globalScriptRuntimes.entries()) {
      const script = globalScripts.find(s => s.id === scriptId);
      items.push({
        id: `global-script:${scriptId}`,
        type: 'global-script',
        name: script?.name || 'Unknown Script',
        projectName: 'Global',
        projectId: '',
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: [],
        lastExitCode: runtime.lastExitCode,
        lastSuccess: runtime.lastSuccess,
        shell: terminalStates.get(`global-script:${scriptId}`),
        attention: terminalAttention.get(`global-script:${scriptId}`),
      });
    }

    // Add interactive shells
    for (const [shellId, runtime] of shellRuntimes.entries()) {
      const project = runtime.projectId ? projects.find((p) => p.id === runtime.projectId) : undefined;
      const live = terminalStates.get(`shell:${shellId}`);
      items.push({
        id: `shell:${shellId}`,
        type: 'shell',
        name: shellTabName(runtime, live),
        projectName: project?.name ?? '',
        projectId: project?.id ?? '',
        status:
          runtime.status === 'running'
            ? 'running'
            : runtime.exitCode === 0 || runtime.exitCode == null
              ? 'completed'
              : 'failed',
        logs: [],
        detectedPorts: [],
        lastExitCode: runtime.exitCode ?? undefined,
        cwd: live?.cwd || runtime.cwd,
        shell: live,
        attention: terminalAttention.get(`shell:${shellId}`),
      });
    }

    return items;
  }, [serviceRuntimes, scriptRuntimes, globalScriptRuntimes, shellRuntimes, globalScripts, projects, getServiceInfo, getScriptInfo, terminalStates, terminalAttention]);

  return allTerminals;
}
