# Plan : Mode Terminal dans CortX — DEV-13

Statut : plan validé avec Alexis le 2026-09-03. Branche `feat/terminal-mode`.

| Phase | État | Notes |
|-------|------|-------|
| P0 | Implémentée (commit `62567dd`, 2026-09-03), à valider | Vérifiée de bout en bout via CDP : cwd, spinner, pastille, toast, historique. ConPTY (dll vendorée) laisse passer OSC 7 / 133. Le bloc PowerShell est livré en une ligne base64 pour survivre à `\| Invoke-Expression` ligne à ligne ; le profil d'Alexis utilise `\| Out-String \| Invoke-Expression`. |
| P1 | Implémentée (2026-09-03), à valider | Même binaire, seconde fenêtre Tauri `terminal` (le front choisit sa racine par le label de fenêtre ; la commande de création est `async`, sinon le WebView reste sur about:blank sous Windows). Document de layout partagé via Rust (`get/set_terminal_layout` + événement `terminal-layout`, révision). Rail de sessions par défaut, bandeau d'onglets en option (réglage), police configurable (Hack NF pour Alexis). Rejeu du scrollback : les réponses aux requêtes du shell sont mises en sourdine pendant le rejeu. `cortx terminal` vérifié à froid. Single-instance actif en release seulement (le verrou est par identifiant d'app, un build dev l'aurait transmis à l'app installée). Artefact connu : un scrollback rejoué dans une fenêtre d'une autre largeur redessine l'ancien contenu décalé jusqu'au prochain prompt. |
| P2 | Implémentée (2026-09-03), à valider | `sessions.json` écrit par le Rust à chaque révision ; cwd par pane via OSC 7 (écrit par la fenêtre si ouverte, sinon par la principale) ; `windowOpen` patché par le backend à l'ouverture / fermeture ; reprise dans la fenêtre principale au boot (shells recréés avec `restoreFrom`, ids remplacés en un seul commit) ; instantanés `runtime/terminal-snapshots/*.bin` (quit + toutes les 60 s), rejoués via le hub avant la sortie du nouveau shell ; launch configs YAML validées côté Rust, exécutées côté front (commandes tapées dans le shell après 1,2 s) ; `--layout` sur `cortx terminal`. Le dock n'est pas restauré (ses onglets sont surtout des services relançables). |
| P3–P4 | À faire | |

## Contexte

CortX est le cockpit dev personnel : projets + services (v1), scripts globaux (v2), tools et
configs (v3), utilities (v4), agents (v5, DEV-11), redesign Halcyon (v6). Depuis le 2026-09-03 le
panneau terminal est un vrai PTY (`portable-pty` + xterm.js WebGL), mais il reste un *dock* : une
barre en bas, des onglets, des panes horizontaux, et rien n'est mémorisé d'un lancement à l'autre.

L'outil principal d'un dev est le terminal. DEV-13 en fait **une feature de premier rang** : un mode
terminal complet, organisé par projet, qui reprend ses sessions, et qui se customise comme Warp.

### Est-ce légitime dans CortX ?

Oui, et c'est l'endroit le plus naturel :

1. **CortX connaît déjà le contexte** qu'un terminal générique doit deviner : le profil shell
   (`cortx init`), les alias, les projets avec `root_path`, services, scripts et fichiers env, les
   sessions d'agents (Claude Code, Codex) avec leur `cwd`.
2. **Le socle existe** : PTY côté Rust (`ProcessManager::spawn_in_pty`, `TerminalHub` avec
   scrollback RAM 4 Mo), xterm.js côté front (`lib/terminalSessions.ts`), storage JSON, watcher,
   store zustand, sidebar, palette, backup git.
3. Un terminal séparé (Warp, Terax) refait tout ça sans le lien projet.

### Ce qui reste hors périmètre (décidé)

- **Pas de zone de saisie séparée façon Warp.** Flux classique + marqueurs de blocs. Les TUI, les
  prompts et les agents interactifs continuent de marcher tels quels.
- **Pas de cloud, partage, notebooks, comptes.** CortX est local-first.
- **Pas d'éditeur, git graph, LSP** (Terax en a, ce n'est pas notre périmètre).
- **Pas de daemon** dans ce ticket. Les PTY vivent dans le process de l'app ; fermer l'app ferme les
  processus (« Hide to tray » couvre l'usage quotidien). La reprise restaure la *disposition*, pas les
  processus, exactement comme Warp.
- **Pas de compatibilité Warp pour les launch configurations** (format propre). Compatibilité Warp
  **uniquement pour les thèmes**.

### Références étudiées

| Source | Ce qu'on reprend |
|--------|------------------|
| Warp (config locale d'Alexis) | Format de thème YAML (`background`, `accent`, `foreground`, `details`, `background_image {path, opacity}`, `terminal_colors.normal/bright`), notion de launch configuration (fenêtres → onglets → layout `cwd` + `commands`), sidebar de sessions avec statut, reprise « au bon endroit sans relancer », `keybindings.yaml`. |
| Terax (Tauri 2 + Rust + React 19, 7 Mo) | OSC 7 / OSC 133 émis par le profil shell pour suivre cwd et blocs sans parser l'écran ; pool de renderers WebGL (5 slots, onglets cachés gardent leur buffer) ; détection d'agents au niveau des octets PTY ; onglets persistants non démontés. |

---

## Décisions d'architecture

### 1. Même binaire, seconde fenêtre Tauri

- La fenêtre « Terminal » (`label: "terminal"`) est une fenêtre Tauri de plus dans `cortx-app`,
  même WebView2, même state Rust. Pas de binaire séparé : les PTY et le scrollback vivent dans
  `ProcessManager` / `TerminalHub`, un second process obligerait à relayer les octets par socket.
- `cortx terminal [--project <name|id>] [--layout <name>]` côté CLI = lance `cortx-app --terminal
  [...]`. Avec `tauri-plugin-single-instance`, l'instance déjà ouverte reçoit les arguments et
  ouvre/focus la fenêtre terminal (et l'espace du projet demandé).
- **Contrainte** : une fenêtre = un WebView = un DOM. On ne déplace pas une instance xterm entre le
  dock et la fenêtre. Un terminal qui change de fenêtre est *ré-attaché* : nouvelle instance xterm,
  scrollback rejoué depuis `TerminalHub::scrollback` (déjà le mécanisme utilisé au retour d'un
  onglet caché). Transparent pour l'utilisateur.
- Le **dock du bas et la fenêtre partagent le même modèle** (mêmes terminaux, mêmes espaces). Le dock
  est une vue réduite ; la fenêtre est la vue complète. Un terminal est affiché dans *une* surface à
  la fois (`surface: 'dock' | 'window'`).

### 2. Règle « où ça s'ouvre »

| Action | Par défaut | Réglage |
|--------|-----------|---------|
| Démarrer un service, lancer un script (projet ou global) | Dock, sans changer de vue | `terminal.openProcessesIn: dock \| window` |
| « Ouvrir une session de dev » sur un projet (launch config) | Fenêtre Terminal, espace du projet | `terminal.openDevSessionsIn: window \| dock` |
| « Nouveau terminal » depuis le dock | Dock | — |
| « Nouveau terminal » depuis la fenêtre | Fenêtre, espace courant | — |
| Bouton « détacher » sur un onglet ou un pane | Envoie vers la fenêtre | — |
| Bouton « renvoyer dans le dock » | Envoie vers le dock | — |

### 3. Scope Global / Projet (comme partout dans l'app)

- Chaque terminal appartient à un **espace** (`workspace`) : un espace par projet (`projectId`) +
  un espace « Libre » (`projectId: null`).
- La fenêtre a un **sélecteur de scope** en haut : `Global` (toutes les sessions, chip couleur du
  projet sur chaque onglet) ou un projet (filtre). Le scope est un filtre d'affichage, jamais une
  cloison : on peut ouvrir Zorg et CortX côte à côte en Global.
- Le scope courant, l'espace actif et l'onglet actif sont persistés.

### 4. Reprise de session (comme Warp)

- Persisté à chaque changement (debounce 300 ms) et à la fermeture :
  fenêtres, scope, espaces, onglets, arbre de splits, cwd courant (via OSC 7), titre, couleur,
  épinglage, shell utilisé, et pour les services/scripts leur identité (relançables).
- Au lancement : rouvrir **au bon endroit** (shell dans le bon cwd), **ne rien relancer**. Les
  onglets de services/scripts sont recréés en état « arrêté » avec leur bouton « relancer ».
- Réglage `terminal.restore: always | ask | never` (défaut `always`).
- **Instantané de scrollback** optionnel (`terminal.restoreScrollback: none | last-lines`, défaut
  `last-lines` avec 200 lignes) écrit dans `runtime/terminal-snapshots/<id>.txt`. Ces fichiers
  restent hors backup git (runtime).

### 5. Intégration shell (fondation)

`cortx init <shell>` émet, en plus des alias :

- **OSC 7** `file://host/cwd` à chaque prompt (cwd tracking).
- **OSC 133 A / B / C / D;<exit>** (début prompt, début commande, fin prompt, fin commande avec code).
- Variable d'env `CORTX_TERMINAL_ID` posée par le PTY (déjà `apply_pty_env`) pour que le profil
  n'émette ces séquences que dans un terminal CortX.

Shells : PowerShell (via `prompt` wrapper), bash (`PROMPT_COMMAND` + `DEBUG` trap), zsh
(`precmd` / `preexec`), fish (`fish_prompt` / `fish_preexec` / `fish_postexec`).

Côté Rust, un **filtre d'octets** dans `spawn_in_pty` (avant le hub) reconnaît ces OSC, met à jour
l'état du terminal (`cwd`, `phase: prompt | running`, `lastCommand`, `lastExit`, `startedAt`), et
émet des événements `terminal-state` vers les webviews. Les séquences sont laissées dans le flux
(xterm les ignore) pour ne rien casser.

### 6. Thèmes compatibles Warp, réglages supplémentaires

Un thème de terminal = un fichier YAML **au format Warp** (lecture stricte du sous-ensemble Warp,
extensions CortX sous une clé `cortx:` ignorée par Warp) :

```yaml
name: aespa_wda
background: "#713d39"
accent: "#0c161f"
foreground: "#ffffff"
details: darker            # darker | lighter → choix clair/sombre de l'UI xterm
background_image:
  path: "aespa_wda.jpeg"   # relatif au dossier du thème, ou absolu
  opacity: 30              # 0-100
terminal_colors:
  normal: { black: …, red: …, … }
  bright: { black: …, red: …, … }
cortx:                      # extensions (facultatif)
  cursor: "#ffffff"
  selection: "#ffffff33"
  blur: 8                   # flou du fond d'écran en px
  imageFit: cover           # cover | contain | tile | center
```

Les thèmes vivent dans `data/terminal/themes/<name>.yaml` (+ images à côté). Import direct d'un
`.yaml` Warp (copie fichier + image référencée). Une poignée de thèmes intégrés (Dark Modern,
Light Modern, Halcyon Teal, Classic) livrés en ressources et copiés au premier lancement.

**Réglages d'apparence** (tous dans `settings.json` sous `terminal.appearance`, donc synchronisés) :

| Clé | Valeurs | Défaut |
|-----|---------|--------|
| `themeDark` / `themeLight` | nom de thème | `Dark Modern` / `Light Modern` |
| `syncWithApp` | bool (suivre le mode clair/sombre de l'app) | true |
| `fontFamily` | string | JetBrains Mono |
| `fontSize` | 9–24 | 13 |
| `lineHeight` | 1.0–2.0 | 1.2 |
| `ligatures` | bool | true |
| `cursorStyle` / `cursorBlink` | block/underline/bar, bool | bar, true |
| `padding` | px | 8 |
| `windowOpacity` | 50–100 (fenêtre terminal uniquement) | 100 |
| `windowEffect` | none/acrylic/mica (Windows), vibrancy (macOS) | none |
| `scrollback` | lignes | 5000 |
| `bell` | none/visual/sound | visual |

**Thème par projet** (validé) : `project.terminal?.theme` optionnel ; l'espace du projet prend ce
thème, le reste utilise le thème global. Réglable depuis la fiche projet.

### 7. Launch configurations (format propre)

`data/terminal/launch/<id>.yaml` :

```yaml
id: 8c1f…
name: Zorg dev
projectId: 3fa2…          # ou null pour une config globale
window: terminal           # terminal | dock
tabs:
  - title: dev
    layout:                # arbre de splits
      split: horizontal
      children:
        - { cwd: ".", command: "bun dev" }
        - split: vertical
          children:
            - { cwd: ".", command: "cargo watch -x run" }
            - { cwd: ".", shell: pwsh }
  - title: agent
    layout: { cwd: ".", command: "claude" }
```

`cwd` relatif = relatif au `root_path` du projet. `command` est tapé dans le shell (pas exécuté
hors shell), pour garder le profil, les alias et l'historique. Lançable depuis : la fiche projet
(bouton « Ouvrir une session de dev », la première config du projet est la config par défaut), la
palette, la sidebar de la fenêtre, `cortx terminal --layout`.

### 8. Sidebar de sessions et agents

La fenêtre a un rail gauche (repliable, Ctrl+B) :

- Espaces (projets avec chip couleur + Libre), chacun dépliable en onglets.
- Par onglet : icône de type (shell, service, script, agent), titre, cwd raccourci, **statut** :
  `idle` (prompt), `running` (commande en cours + durée), `attention` (agent attend une entrée),
  `done` (commande finie, code de sortie, non lue), `stopped` (service/script arrêté), `error`.
- Section « Agents » : les sessions Claude Code / Codex détectées (données de DEV-11 croisées avec le
  `cwd` et le process enfant du PTY). Un terminal dont le process enfant est `claude`/`codex` est
  tagué agent. `attention` = process vivant + pas de sortie depuis N s + dernier bloc non terminé
  (heuristique, affinée plus tard si les agents émettent des OSC dédiées).

Badges sur les onglets (dock et fenêtre) + notification OS optionnelle quand une commande > 10 s se
termine dans un onglet non visible (`terminal.notifyOnLongCommand`).

### 9. Blocs et navigation

Sans changer le rendu : décorations xterm (`registerDecoration`) sur les marqueurs OSC 133.

- Sauter au prompt précédent / suivant (Ctrl+↑ / Ctrl+↓).
- Barre latérale de blocs : liseré coloré (vert / rouge selon code de sortie), clic = sélectionne
  le bloc ; actions : copier la commande, copier la sortie, replier la sortie, marquer.
- Historique global des commandes (`runtime/command-history.jsonl` : projet, cwd, commande, exit,
  durée) alimenté par OSC 133. Consultable dans la palette (Ctrl+R dans la fenêtre) avec les alias
  CortX et les scripts du projet comme entrées exécutables.
- Recherche globale dans le scrollback de toutes les sessions (via `TerminalHub`).

### 10. Performance

- Pool de contextes WebGL (max 5 actifs) ; un onglet non visible libère son addon WebGL et garde
  son buffer xterm (comme Terax). Au-delà de N onglets dormants, l'instance xterm est disposée et
  sera rejouée depuis le hub.
- Scrollback Rust cap 4 Mo / terminal inchangé. Snapshot disque limité aux dernières lignes.
- Objectif : 20 onglets ouverts, aucun coût perceptible ; ouverture de la fenêtre < 300 ms.

---

## Modèle de données

### `data/terminal/sessions.json` (synchronisé par le backup git)

```ts
interface TerminalSessionsFile {
  version: 1;
  scope: 'global' | { projectId: string };
  activeWorkspaceId: string | null;
  workspaces: TerminalWorkspace[];
}
interface TerminalWorkspace {
  id: string;
  projectId: string | null;         // null = Libre
  activeTabId: string | null;
  tabs: TerminalTab[];
}
interface TerminalTab {
  id: string;
  title: string | null;             // null = titre auto (cwd / commande)
  color: string | null;
  pinned: boolean;
  surface: 'dock' | 'window';
  layout: LayoutNode;               // arbre de splits
  activeLeafId: string;
}
type LayoutNode =
  | { kind: 'leaf'; id: string; terminal: PersistedTerminal }
  | { kind: 'split'; id: string; direction: 'horizontal' | 'vertical'; ratio: number[]; children: LayoutNode[] };
interface PersistedTerminal {
  ref: { kind: 'shell'; shell?: string } | { kind: 'service' | 'script' | 'global-script'; key: string };
  cwd: string;
  title?: string;
}
```

Note : `cwd`, titres et commandes peuvent être spécifiques à la machine ; c'est accepté (les
projets le sont déjà). Les chemins relatifs au projet sont stockés relatifs quand c'est possible.

### `settings.json` → `terminal`

`TerminalConfig` existant (`preset`, `custom_path`, `custom_args`, `integrated_shell`) + nouvelles
clés : `appearance` (§6), `openProcessesIn`, `openDevSessionsIn`, `restore`, `restoreScrollback`,
`restoreScrollbackLines`, `notifyOnLongCommand`, `longCommandSeconds`, `newTabInheritsCwd`,
`injectProjectEnv`, `keybindings: Record<string, string>` (override des défauts).

### `projects.json` → `project.terminal?`

`{ theme?: string; defaultLaunchId?: string; shell?: string }`.

### Fichiers

| Chemin | Synchronisé | Contenu |
|--------|-------------|---------|
| `data/terminal/sessions.json` | oui | disposition et cwd |
| `data/terminal/themes/*.yaml` + images | oui | thèmes (format Warp) |
| `data/terminal/launch/*.yaml` | oui | launch configurations |
| `data/settings.json` (clé `terminal`) | oui (déjà) | réglages |
| `data/runtime/terminal-snapshots/*.txt` | non | instantanés de scrollback |
| `data/runtime/command-history.jsonl` | non | historique global |

`Storage::BACKUP_FILES` devient une liste de fichiers **et de dossiers** (`terminal/`), avec copie
récursive et exclusion des images > 10 Mo (avertissement dans l'UI de backup).

---

## Découpage technique

### Rust (`cortx-core`)

- `terminal/osc.rs` : filtre d'octets OSC 7 / 133, état par terminal, `TerminalStateEvent`.
- `terminal/sessions.rs` : lecture/écriture `sessions.json`, validation de l'arbre.
- `terminal/themes.rs` : parse YAML Warp (+ `cortx:`), import, liste, thèmes intégrés (`serde_yaml`).
- `terminal/launch.rs` : parse/valide/exécute une launch config (résolution `cwd` relatif).
- `terminal/history.rs` : append/recherche `command-history.jsonl`.
- `process_manager.rs` : `spawn_shell` accepte `workspaceId`, env projet injecté (`injectProjectEnv`),
  `CORTX_TERMINAL_ID`, `CORTX_PROJECT`. Liste du process enfant courant (sysinfo) pour la détection
  d'agents.
- `shell_init.rs` : émission OSC 7 / 133 par shell, gardée par `CORTX_TERMINAL_ID`.
- `storage.rs` : `terminal_dir()`, backup récursif.

### Tauri (`src-tauri`)

- Fenêtre `terminal` (créée à la demande, `WebviewWindowBuilder`, même `index.html` avec
  `?window=terminal`), plugin `single-instance`, `window-vibrancy` pour acrylic/mica, opacité.
- Commandes : `terminal_sessions_get/set`, `terminal_themes_list/import/get`, `terminal_launch_list
  /save/delete/run`, `terminal_history_search`, `terminal_open_window`, `terminal_move_to_surface`,
  `terminal_child_process`, `terminal_search_scrollback`.
- Événements : `terminal-state` (cwd, phase, exit), `terminal-agent` (détection), diffusés aux deux
  fenêtres.
- Arguments CLI `--terminal`, `--project`, `--layout` (au démarrage et via single-instance).

### CLI (`cortx-tui`)

- `cortx terminal [--project] [--layout]` : lance ou réveille l'app.
- `cortx terminal layouts` : liste les launch configs.

### Front (`frontend/src`)

- `stores/terminalStore.ts` : nouveau store (espaces, onglets, arbre de splits, scope, surface,
  état par terminal), remplace `terminalPanes` dans `appStore`. Persistance via Rust (pas
  localStorage) pour rester synchronisable.
- `lib/terminalSessions.ts` : pool WebGL, thème depuis un `TerminalTheme` résolu, décorations de
  blocs, rejeu depuis le hub après changement de surface.
- `lib/terminalTheme.ts` : résolution thème (global / projet / clair-sombre) → `ITheme` xterm + CSS
  du fond d'écran.
- `windows/TerminalWindow.tsx` : racine de la seconde fenêtre (TitleBar réduite, rail de sessions,
  sélecteur de scope, zone d'onglets, arbre de splits, barre de statut cwd / shell / durée).
- `components/terminal/` : `SessionRail`, `ScopeSwitcher`, `SplitTree`, `SplitLeaf`, `TabStrip`,
  `BlockGutter`, `TerminalStatusBar`, `LaunchConfigEditor`, `ThemePicker`, `BackgroundPicker`.
- `components/layout/TerminalPanel.tsx` : devient une vue « dock » du même store ; bouton « ouvrir
  en mode terminal » et « détacher » par onglet.
- `views/Settings.tsx` : **section « Terminal » dédiée**, en onglets : Apparence (thème clair/sombre,
  import Warp, fond d'écran + opacité + flou, police, curseur, padding, opacité et effet de fenêtre,
  aperçu live), Comportement (où s'ouvrent les choses, reprise, snapshot, notifications, cwd hérité,
  env projet), Raccourcis (liste éditable, reset), Launch configs (liste, éditeur, dupliquer).
- Fiche projet : thème du terminal, launch configs du projet, bouton « Ouvrir une session de dev ».
- Palette : « Ouvrir le mode terminal », launch configs, historique de commandes, alias.

---

## Phases et livrables

| Phase | Contenu | Sous-ticket |
|-------|---------|-------------|
| **P0 — Intégration shell** | OSC 7/133 dans `cortx init`, filtre Rust, `terminal-state`, cwd et exit dans le dock, badges « terminé » et notification, historique de commandes | DEV-13.1 |
| **P1 — Fenêtre Terminal** | Store terminal (espaces, onglets, arbre de splits), fenêtre `terminal`, scope Global/Projet, rail de sessions, détacher / renvoyer, bouton dans le dock, `cortx terminal` + single-instance, pool WebGL | DEV-13.2 |
| **P2 — Reprise et launch configs** | `sessions.json`, restauration au bon endroit, snapshot de scrollback, launch configs (format propre, éditeur, fiche projet, palette, CLI), règle « où ça s'ouvre » | DEV-13.3 |
| **P3 — Customisation** | Thèmes format Warp (import, intégrés, par projet), fond d'écran, police, curseur, opacité et effet de fenêtre, section Réglages > Terminal complète avec aperçu, raccourcis configurables | DEV-13.4 |
| **P4 — Blocs et agents** | Décorations de blocs, navigation, copier/replier, recherche globale, palette Ctrl+R (historique + alias + scripts), détection d'agents et statut `attention` dans le rail | DEV-13.5 |

Chaque phase est mergeable seule et laisse l'app dans un état utilisable. P0 et P3 sont
indépendantes de P1 ; P2 et P4 dépendent de P1.

## Vérification

- Rust : tests unitaires sur le parseur OSC (séquences coupées entre deux chunks, TUI qui repeint),
  le parseur de thème (fichier Warp d'Alexis tel quel), les launch configs (cwd relatif, arbre
  invalide), `sessions.json` (migration de version).
- Front : `tsc`, `bun run build`, lint ; captures CDP (`WEBVIEW2_USER_DATA_FOLDER` dédié, port 9223)
  des deux fenêtres en clair et sombre, skins Halcyon et Classic, avec le thème `aespa_wda` importé.
- Manuel : 20 onglets répartis sur 3 projets, fermeture, relance, tout revient au bon cwd sans rien
  relancer ; `cortx terminal --project cortx` depuis un autre terminal focus la fenêtre ; service
  démarré depuis Projets → dock uniquement ; session de dev → fenêtre.
- Ne jamais arrêter l'app installée (`C:\Program Files\Cortx\cortx-app.exe`) pendant les tests.

## Hors périmètre, à reconsidérer plus tard

Daemon de PTY survivant à l'app (modèle tmux), SSH et WSL, séquences OSC dédiées pour les agents si
Claude Code / Codex en publient, thèmes de l'app pilotés par le thème du terminal.
