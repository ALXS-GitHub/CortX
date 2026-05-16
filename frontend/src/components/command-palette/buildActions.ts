import {
  AppWindow,
  FileCode,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Play,
  Settings as SettingsIcon,
  Square,
  SquareTerminal,
  Terminal,
  Wrench,
  Code,
  ScrollText,
} from 'lucide-react';
import { createElement } from 'react';

import { openInExplorer, openInVscode } from '@/lib/tauri';
import type { useAppStore } from '@/stores/appStore';
import type { CommandAction } from './types';

type Store = ReturnType<typeof useAppStore.getState>;

/**
 * Build the list of actions surfaced by the command palette from the current
 * store snapshot. Called on every palette open (cheap — pure data).
 */
export function buildActions(store: Store): CommandAction[] {
  const actions: CommandAction[] = [];

  // -- Navigation ----------------------------------------------------------
  const navItems: { view: Parameters<Store['setCurrentView']>[0]; label: string; icon: typeof FolderKanban }[] = [
    { view: 'dashboard', label: 'Go to Projects', icon: FolderKanban },
    { view: 'scripts', label: 'Go to Scripts', icon: FileCode },
    { view: 'tools', label: 'Go to Tools', icon: Wrench },
    { view: 'aliases', label: 'Go to Shell Config', icon: SquareTerminal },
    { view: 'apps', label: 'Go to Apps', icon: AppWindow },
    { view: 'settings', label: 'Go to Settings', icon: SettingsIcon },
  ];
  for (const { view, label, icon } of navItems) {
    actions.push({
      id: `nav:${view}`,
      category: 'Navigation',
      label,
      icon: createElement(icon, { className: 'size-4' }),
      keywords: `view tab navigate ${view}`,
      run: () => {
        store.setCurrentView(view);
        if (view === 'dashboard') store.selectProject(null);
      },
    });
  }

  // -- Apps: launch --------------------------------------------------------
  for (const app of store.apps) {
    actions.push({
      id: `app:launch:${app.id}`,
      category: 'Apps',
      label: `Launch ${app.name}`,
      subtitle: 'App',
      icon: createElement(AppWindow, { className: 'size-4' }),
      keywords: `app launch ${app.tags.join(' ')}`,
      run: () => store.launchApp(app.id),
    });
  }

  // -- Services: start (any), stop (running only) --------------------------
  for (const project of store.projects) {
    for (const service of project.services) {
      const runtime = store.serviceRuntimes.get(service.id);
      const isRunning = runtime?.status === 'running' || runtime?.status === 'starting';
      const breadcrumb = `${project.name} › ${service.name}`;

      if (!isRunning) {
        actions.push({
          id: `service:start:${service.id}`,
          category: 'Services',
          label: `Start ${service.name}`,
          subtitle: `${project.name} › Service`,
          icon: createElement(Play, { className: 'size-4' }),
          keywords: `start service ${breadcrumb} ${service.command}`,
          run: () => store.startService(service.id),
        });
      } else {
        actions.push({
          id: `service:stop:${service.id}`,
          category: 'Services',
          label: `Stop ${service.name}`,
          subtitle: `${project.name} › Running`,
          icon: createElement(Square, { className: 'size-4' }),
          keywords: `stop service ${breadcrumb}`,
          run: () => store.stopService(service.id),
        });
      }
    }
  }

  // -- Global scripts: run with defaults -----------------------------------
  for (const script of store.globalScripts) {
    const hasParams = script.parameters.length > 0;
    actions.push({
      id: `gscript:run:${script.id}`,
      category: 'Scripts',
      label: `Run ${script.name}`,
      subtitle: hasParams ? 'Global script (uses default params)' : 'Global script',
      icon: createElement(ScrollText, { className: 'size-4' }),
      keywords: `run script ${script.tags.join(' ')} ${script.command}`,
      run: () => store.runGlobalScript(script.id, script.workingDir ?? '.'),
    });
  }

  // -- Projects: open folder / open VS Code --------------------------------
  for (const project of store.projects) {
    actions.push({
      id: `project:open-folder:${project.id}`,
      category: 'Projects',
      label: `Open folder: ${project.name}`,
      subtitle: project.rootPath,
      icon: createElement(FolderOpen, { className: 'size-4' }),
      keywords: `open folder project ${project.tags.join(' ')}`,
      run: () => openInExplorer(project.rootPath),
    });
    actions.push({
      id: `project:open-vscode:${project.id}`,
      category: 'Projects',
      label: `Open in VS Code: ${project.name}`,
      subtitle: project.rootPath,
      icon: createElement(Code, { className: 'size-4' }),
      keywords: `open vscode code editor project ${project.tags.join(' ')}`,
      run: () => openInVscode(project.rootPath),
    });
  }

  // -- Tools: open install location ----------------------------------------
  for (const tool of store.tools) {
    if (!tool.installLocation) continue;
    const loc = tool.installLocation;
    actions.push({
      id: `tool:open-install:${tool.id}`,
      category: 'Tools',
      label: `Open install: ${tool.name}`,
      subtitle: loc,
      icon: createElement(Terminal, { className: 'size-4' }),
      keywords: `open tool install location ${tool.tags.join(' ')}`,
      run: () => openInExplorer(loc),
    });
  }

  return actions;
}

// Silence unused-icon imports when categories are tweaked.
void LayoutDashboard;
