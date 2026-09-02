# Plan : Section Agents (beta) dans CortX — DEV-11

## Contexte

CortX est le cockpit dev personnel : projets + services (v1), scripts globaux (v2), tools et
configs (v3), utilities (v4, DEV-6). Depuis quelques mois la façon de travailler a changé : sur un
projet, ce ne sont plus des services et des scripts qu'on lance, ce sont **des agents** (Claude Code,
Codex) — 5, 10, 15 en parallèle dans des onglets Warp.

### Problème actuel

- Chaque onglet de terminal porte un nom de ticket ou le premier prompt, jamais ce que l'agent fait
  *maintenant*. Pour savoir qui fait quoi, on relit chaque conversation.
- On ne voit pas d'un coup d'œil ce qui tourne, ce qui attend une réponse, ce qui a fini.
- Après un reboot (ou un « je ferme tout ce soir »), tout est à relancer à la main, en retrouvant
  chaque dossier et chaque `--resume`.
- Les agents sont attachés à des projets… qui sont déjà dans CortX. L'information est là, elle n'est
  juste pas croisée.

### Est-ce légitime dans CortX ?

Oui, et c'est même l'endroit le plus naturel :

1. **La section Projets est l'ancre.** Une session d'agent a un `cwd` ; un projet CortX a un
   `root_path`. Le rapprochement est trivial et c'est ce qui rend la vue utile (« les agents de
   Tutti Frutti », pas « 40 uuids »).
2. **CortX gère déjà le lancement de choses dans un terminal externe** (`launch_external_terminal`,
   presets Warp / Windows Terminal / pwsh…). « Relancer une session » = « ouvrir un terminal dans ce
   dossier avec `claude --resume <id>` ». Zéro nouvelle infra.
3. **Le file watcher, le storage JSON, le store zustand, le sidebar, la palette** : tout le socle
   existe. La section coûte de la logique métier (lecture des sessions), pas de la plomberie.
4. Un dashboard séparé (app ou page web) refait exactement ces trois points sans le lien projets.

Ce qui **ne** doit **pas** rentrer (pour l'instant) : un terminal intégré / PTY. Le panneau
« terminal » de CortX est un afficheur de logs sans stdin ; brancher un agent interactif dedans est un
chantier à part (xterm.js + portable-pty). Décision explicite : **on ne le fait pas dans ce ticket**,
l'agent vit dans son terminal externe, CortX l'observe et le relance.

### Alternatives existantes

| Outil | Ce qu'il fait | Ce qui manque |
|-------|---------------|---------------|
| `claude agents` (agent view natif) | Liste les sessions live (busy/idle), dispatch en background | Claude uniquement, pas de lien projet, pas d'historique/annotations, pas de relance groupée |
| `claude --resume` / `codex resume` (pickers) | Reprise d'une session | Un provider à la fois, filtré par cwd, aucune vue d'ensemble |
| Warp launch configurations | Rouvrir N onglets dans N dossiers | Statique, pas de notion de session ni d'état |
| Dashboards tiers (ccusage, claude-code-monitor…) | Stats/coûts | Pas de « qui fait quoi », pas de relance, pas de projets |

---

## Ce qu'on sait des sources de données (vérifié sur la machine, 2026-09-02)

### Claude Code (v2.1.258)

| Source | Contenu | Stabilité |
|--------|---------|-----------|
| `~/.claude/projects/<cwd-encodé>/<sessionId>.jsonl` | Transcript complet. Entrées utiles : `user`/`assistant` (avec `cwd`, `gitBranch`, `version`, `timestamp`), `ai-title` (titre auto), `custom-title` (`/rename`, `--name`), `last-prompt`, `agent-name`, `summary` (compaction). Les `tool_use` sont dans `assistant.message.content`. | **Non documenté**, « change entre versions ». On parse défensivement (champs optionnels, types inconnus ignorés). |
| `~/.claude/projects/<cwd-encodé>/<sessionId>/` | Transcripts des sous-agents. | Idem. v1 : on compte, on n'affiche pas. |
| `~/.claude/sessions/<pid>.json` | **Registre live** : `pid`, `sessionId`, `cwd`, `name`, `nameSource`, `status` (`busy` / `idle`), `kind` (`interactive`…), `startedAt`, `version`. | Non documenté. Peut rester stale après un crash → toujours vérifier que le pid est vivant (`sysinfo`). |
| `claude agents --json` | Même info, forme supportée (pid, cwd, kind, sessionId, name, status). | Documenté. ~1 s d'exécution → à utiliser comme réconciliation, pas en polling serré. |
| `~/.claude/history.jsonl` | Un prompt par ligne avec `project` (cwd brut) + `sessionId`. | Bon index de secours cwd ↔ session, pas nécessaire en v1. |
| Hooks (`SessionStart`, `Stop`, `Notification`, `UserPromptSubmit`, `PreToolUse`…) | JSON sur stdin avec `session_id`, `cwd`, `transcript_path`, `tool_name`… | Documenté. **Opt-in explicite** (règle maison : rien n'écrit dans `~/.claude/settings.json` sans clic). Phase 4. |

Encodage du dossier projet : chaque caractère non alphanumérique du cwd → `-`. On ne le décode pas :
le `cwd` réel est dans chaque entrée `user`/`assistant`.

Relance : `claude --resume <sessionId>` fonctionne depuis n'importe quel cwd (≥ 2.1.223) ; on le
lance quand même dans le cwd d'origine (le projet). `--fork-session` pour « repartir de là sans
toucher l'original ». `--bg` existe pour du non-interactif — hors scope v1.

### Codex (v0.147)

| Source | Contenu | Stabilité |
|--------|---------|-----------|
| `~/.codex/state_5.sqlite` (WAL) — table `threads` | **Index prêt à l'emploi** : `id`, `rollout_path`, `cwd` (préfixe `\\?\` à retirer), `title`, `first_user_message`, `preview`, `name`, `git_branch`, `git_sha`, `model`, `tokens_used`, `created_at_ms`, `updated_at_ms`, `archived`, `is_pinned`, `source` (`cli`/`exec`). | Schéma versionné dans le nom de fichier (`state_5`) → détecter la version, dégrader proprement. Ouvrir en **lecture seule** (`?mode=ro`, `immutable` non car WAL). |
| `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` | Transcript : `session_meta`, `event_msg` (`user_message`, `agent_message`, `task_started`, `task_complete`), `response_item` (`message`, `custom_tool_call`, `custom_tool_call_output`, `reasoning`). | Non documenté, mais typé proprement (`type` + `payload.type`). |
| Live | **Pas de registre live** côté Codex. | Heuristique v1 : `updated_at_ms` < N min = « probablement actif ». Amélioration : détecter les process `codex.exe` (sysinfo) et matcher leur cwd si accessible. |

Relance : `codex resume <id>` (le picker filtre par cwd par défaut → on lance dans le cwd d'origine).

### Terminaux (relance)

- Windows Terminal : `wt.exe -d <dir> pwsh -NoExit -c "claude --resume <id>"` → déjà supporté par
  `launch_external_terminal`.
- Warp Windows : le preset actuel n'ouvre qu'une **fenêtre** vers un dossier (`warp://action/new_window?path=`),
  sans commande. Pour exécuter une commande, Warp veut une **launch configuration** YAML
  (`%APPDATA%\warp\Warp\data\launch_configurations\<name>.yaml`, champs `tabs[].layout.cwd`,
  `tabs[].title`, `tabs[].color`, `tabs[].commands[].exec`) puis `warp://launch/<name>`. Bonus énorme :
  **une config = N onglets** → « relancer tous les agents du projet » en un clic après reboot.

---

## Décisions

| Décision | Choix | Raison |
|----------|-------|--------|
| Nature de la section | **Découverte, lecture seule** des fichiers des providers. CortX ne « possède » pas les sessions. | La source de vérité est chez Claude/Codex. Une session lancée depuis CortX ou depuis Warp donne exactement les mêmes données → pas de distinction « gérée / non gérée » à maintenir. Le ticket l'évoquait ; elle devient inutile. |
| Ce que CortX persiste | Uniquement des **annotations** par `sessionId` (`agents.json`) : nom custom, tags, statut label, épinglé, notes, projet forcé, masqué, référence ticket. | Petit, pas de désync possible avec les transcripts. Les sessions disparues gardent leurs annotations (nettoyage manuel). |
| Rattachement projet | **Plus long préfixe** entre `session.cwd` et `project.root_path` (normalisé : casse, séparateurs, `\\?\`). Une session dans un sous-dossier appartient au projet parent. Override manuel possible (annotation). | Demande explicite du ticket. Les worktrees git hors de l'arbre ne matchent pas → override manuel ou « ajouter comme projet ». |
| cwd sans projet CortX | Groupe « Sans projet », avec bouton **« Créer le projet CortX depuis ce dossier »** (réutilise `create_project`, propose le dossier racine git si détecté). | Demande du ticket. Le dossier racine git évite de créer un projet sur un sous-dossier. |
| Navigation | Un seul `View` `agents` avec un **switch Global / Par projet**, + un onglet « Agents » dans `ProjectView`. | Une liste, deux regroupements ; pas deux écrans à maintenir. L'onglet projet donne le contexte sans quitter le projet. |
| Premier coup d'œil | Une **ligne** par session, 6 infos max : état (pastille), provider (icône), titre, projet · branche, dernier échange (1 ligne), « il y a X ». Tout le reste dans le détail. | Exigence n°1 d'Alexis. Le détail (transcript, outils, fichiers) est à un clic, jamais dans la liste. |
| États affichés | `running` (busy, pid vivant) · `waiting` (idle, pid vivant → attend une réponse) · `stopped` (pas de pid, transcript présent) · `unknown` (Codex sans signal live). | Quatre couleurs, lisibles. « failed » viendra avec les hooks (`StopFailure`). |
| Détail / chat | Sheet latérale (toggle au clic) avec le transcript rendu par **Vercel AI Elements** (`Conversation`, `Message`, `Tool`, `Reasoning`, `CodeBlock`), lecture seule. | Composants shadcn, même stack ; on n'écrit pas un rendu de chat. On mappe notre transcript normalisé vers leurs props, sans le SDK `ai`/`useChat`. |
| Temps réel | Watcher `notify` **récursif** sur `~/.claude/projects`, `~/.claude/sessions`, `~/.codex/sessions` + fichiers sqlite, debounce 500 ms, parse incrémental (tail), event `agent-sessions-changed`. | Le watcher existant est non-récursif et filtre `*.json` → nouveau module `agent_watcher.rs`, pas de modif du watcher data. |
| Hooks Claude Code | **Phase 4, opt-in** : bouton « Installer les hooks CortX » dans Settings (écrit dans `~/.claude/settings.json` après aperçu), + bouton « Retirer ». | Règle maison config/env. Sans hooks on a déjà busy/idle ; les hooks affinent (« attend une permission », « a échoué », outil en cours). |
| Résumés IA / contexte temps réel | Hors scope (« on verra plus tard »). Le titre auto de Claude (`ai-title`) et `title` de Codex suffisent en v1. | Décision d'Alexis. Le modèle prévoit un champ `summary` optionnel pour plus tard. |
| Terminal intégré | **Hors scope.** Relance = terminal externe via le preset Settings. Warp → launch configuration générée. | Décision d'Alexis. |
| Label | Badge **« beta »** sur l'entrée sidebar, le header et la palette. | Demande d'Alexis. Formats non documentés → on assume. |
| Zorg | Pas d'intégration. Détection regex `[A-Z]{2,}-\d+` / `#\d+` dans titre/premier prompt → chip cliquable (copie). | Ticket : « juste afficher le numéro ». |
| Settings | `agents: { claudeConfigDir, codexHome, providers: {claude: bool, codex: bool}, liveThresholdMinutes }`, chemins pré-remplis avec un « browse ». | Règle maison : tout chemin est configurable. |
| TUI / CLI / MCP | Phase 5 : `cortx agents list [--project] [--json]`, `cortx agents resume <id>`, tool MCP `list_agent_sessions`. | Ticket : « dans le TUI aussi ». Le core est dans `cortx-core`, donc quasi gratuit. |

---

## Modèle de données

### `AgentSession` (calculé, non persisté) — `cortx-core/src/agents/mod.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,                       // sessionId (Claude) / thread id (Codex)
    pub provider: AgentProvider,          // ClaudeCode | Codex
    pub title: String,                    // custom-title > ai-title > name > premier prompt tronqué
    pub title_source: TitleSource,        // Custom | Auto | FirstPrompt
    pub cwd: String,                      // normalisé
    pub project_id: Option<String>,       // résolu par préfixe, ou annotation
    pub git_branch: Option<String>,
    pub state: AgentState,                // Running | Waiting | Stopped | Unknown
    pub pid: Option<u32>,
    pub kind: Option<String>,             // interactive | background | exec…
    pub started_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,  // mtime du transcript ou updated_at
    pub last_user_prompt: Option<String>, // 1 ligne, tronquée
    pub last_assistant_text: Option<String>,
    pub current_tool: Option<String>,     // dernier tool_use sans tool_result (Claude)
    pub message_count: u32,
    pub subagent_count: u32,
    pub model: Option<String>,
    pub version: Option<String>,          // version CLI
    pub transcript_path: String,
    pub ticket_refs: Vec<String>,         // "DEV-11", "#42"
    pub annotations: AgentAnnotations,    // fusionné depuis agents.json
}

pub enum AgentState { Running, Waiting, Stopped, Unknown }
pub enum AgentProvider { ClaudeCode, Codex }
```

### `AgentAnnotations` (persisté) — `agents.json`

```rust
pub struct AgentAnnotations {
    pub custom_name: Option<String>,
    pub tags: Vec<String>,                // réutilise tag_definitions
    pub status: Option<String>,           // réutilise status_definitions
    pub pinned: bool,
    pub hidden: bool,
    pub notes: Option<String>,
    pub project_id_override: Option<String>,
    pub updated_at: DateTime<Utc>,
}
// agents.json = { "sessions": { "<sessionId>": AgentAnnotations } }
```

### Cache d'index — `runtime/agents_index.json` (jetable)

`{ "<transcript_path>": { mtime, size, summary: AgentSessionSummary } }`. Si `(mtime, size)` inchangé
→ pas de relecture. Si `size` a grandi → relecture depuis l'ancien offset (append-only). Sinon → full.

### Transcript normalisé (détail) — `AgentTranscript`

```rust
pub struct AgentTranscript { pub session_id: String, pub messages: Vec<AgentMessage> }
pub struct AgentMessage {
    pub id: String, pub role: Role,            // User | Assistant | System
    pub timestamp: DateTime<Utc>,
    pub parts: Vec<AgentPart>,                 // Text | Reasoning | ToolCall{name,input} | ToolResult{name,output,is_error} | Attachment
    pub is_sidechain: bool,
}
```

Pagination par le backend : `get_agent_transcript(id, { from_offset, limit })` → on n'envoie jamais
un JSONL de 2 Mo entier à React.

---

## Architecture backend (`cortx-core`)

```
crates/cortx-core/src/agents/
  mod.rs            // AgentSession, AgentState, résolution projet, ticket_refs, façade AgentIndex
  provider.rs       // trait AgentProviderImpl { discover(), live(), transcript(), resume_command() }
  claude_code.rs    // parse jsonl (head+tail), sessions/<pid>.json, `claude agents --json`
  codex.rs          // sqlite ro (rusqlite, bundled), rollout jsonl
  watcher.rs        // notify récursif + debounce → callback "changed"
  index_cache.rs    // agents_index.json
  launch.rs         // build de la commande de relance + génération Warp launch config
```

- **Lecture head + tail** pour Claude : head (≤ 40 lignes) → `cwd`, `gitBranch`, `version`,
  `ai-title` ; tail (dernier 64 Ko) → `last-prompt`, `custom-title`, dernier `assistant`, dernier
  `tool_use` sans `tool_result`. Un full-scan une seule fois par fichier (compte messages, sous-agents)
  puis cache.
- **Live Claude** : lire `~/.claude/sessions/*.json`, garder ceux dont le `pid` est vivant et dont
  le `procStart` correspond (sinon stale). `claude agents --json` en réconciliation toutes les 30 s
  (optionnel, si le binaire est trouvé).
- **Codex** : `rusqlite` en `OpenFlags::SQLITE_OPEN_READ_ONLY`, requête `threads WHERE archived = 0`.
  Détail = rollout jsonl. Dépendance nouvelle (`rusqlite` bundled ≈ +2 Mo binaire) — acceptable ;
  alternative sans dépendance : parser les `session_meta` de tous les rollouts (139 fichiers ici, ok
  mais plus lent et sans `title`).
- **Résolution projet** : `resolve_project(cwd, &[Project]) -> Option<project_id>` par plus long
  préfixe normalisé. Test unitaire avec sous-dossier / casse / `\\?\`.
- **Watcher** : un thread, `notify` `RecursiveMode::Recursive` sur les 3 racines, debounce 500 ms,
  callback → `AgentIndex::refresh_changed(paths)` → `app.emit("agent-sessions-changed", ())`.
- **Relance** : `resume_command(session, opts) -> (program, args, cwd)` ; Warp Windows → écrire
  `cortx-agents-<slug>.yaml` puis `warp://launch/cortx-agents-<slug>` ; batch → un yaml avec N tabs
  (titre = titre de session, couleur = provider).

### Commandes Tauri (`src-tauri/src/commands.rs`)

| Commande | Rôle |
|----------|------|
| `list_agent_sessions(filter?)` | Liste `AgentSession` (annotations fusionnées, projet résolu) |
| `refresh_agent_sessions()` | Force un rescan complet |
| `get_agent_transcript(id, page)` | Transcript normalisé paginé |
| `get_agent_annotations(id)` / `update_agent_annotations(id, patch)` | Persistance `agents.json` |
| `resume_agent_session(id, { fork?, terminal_override? })` | Ouvre le terminal externe |
| `resume_agent_sessions(ids)` | Batch (Warp launch config ou N `wt`) |
| `create_project_from_session(id)` | Détecte la racine git, appelle `create_project` |
| `get_agents_health()` | Providers détectés, chemins, versions, hooks installés ? |
| `install_agent_hooks()` / `uninstall_agent_hooks()` | Phase 4, explicite |

Event : `agent-sessions-changed`.

---

## Vue GUI

### Navigation

- Sidebar : entrée **Agents** (icône `Bot`) entre Utilities et Apps, avec un `Badge` « beta ».
- Palette : `navItems` + une entité par session (titre, projet) → ouvre le détail.
- `View` : `'agents' | 'agent-detail'`. Header : « Agents · beta ».
- `ProjectView` : onglet « Agents » = même composant liste, filtré sur le projet.

### Liste (le « premier coup d'œil »)

```
┌ Agents · beta ──────────────────────────────── [Global | Par projet]  [🔍]  [Relancer sélection] ┐
│ ● ⟡ Dashboard agents pour Cortx #DEV-11      CortX · main         « Dans le contexte du… »  il y a 2 min │
│ ◐ ⟡ Fix drop targeting in Utilities          CortX · feat/dev-6   attend une réponse         il y a 8 min │
│ ○ ◎ Generate branding image                  Tutti Frutti · main  Use your image_gen tool…   il y a 3 j  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
● running  ◐ waiting  ○ stopped   ⟡ Claude  ◎ Codex
```

- Tri par défaut : état (running > waiting > stopped) puis dernière activité.
- Mode **Par projet** : groupes repliables « CortX (3) », « Tutti Frutti (1) », « Sans projet (2) »,
  avec en tête de groupe « Relancer les 3 » et, pour « Sans projet », « Créer le projet ».
- Filtres discrets : provider, état, tags, « masquer les terminées > 7 j ». Pas de barre de filtres
  visible par défaut — un bouton filtre.
- Hover / clic droit : Relancer, Fork, Épingler, Renommer, Copier l'id, Copier le `--resume`,
  Ouvrir le dossier, Masquer.
- Trois vues comme les autres sections : card / list / compact (`ViewModeToggle`, préférence persistée). La vue list (~44 px par ligne) est celle par défaut.

### Détail (`agent-detail`)

- En-tête : titre (éditable), état, provider, projet, branche, modèle, version CLI, id, pid, tags,
  statut, boutons Relancer / Fork / Ouvrir dossier.
- Corps : transcript rendu avec AI Elements, du plus récent vers le plus ancien à l'ouverture (scroll
  vers le bas), chargement paginé vers le haut. Tool calls repliés par défaut, `Reasoning` replié.
- Panneau latéral (optionnel, repliable) : fichiers touchés (dérivés des `tool_use` Edit/Write),
  sous-agents (compte + noms), notes.
- Live : quand `agent-sessions-changed` concerne cette session, on recharge la dernière page.

### Settings → « Agents (beta) »

Chemins `~/.claude`, `~/.codex` (browse), providers on/off, seuil « actif » Codex, terminal pour la
relance (défaut = preset global), section « Hooks Claude Code » (phase 4).

---

## Frontend : ce qu'on crée

```
src/components/agents/
  AgentsView.tsx          // switch Global/Par projet, liste, filtres, actions
  AgentRow.tsx            // la ligne compacte
  AgentGroup.tsx          // groupe projet repliable
  AgentDetail.tsx         // en-tête + transcript
  AgentTranscript.tsx     // mapping AgentMessage → AI Elements
  AgentStateDot.tsx, ProviderIcon.tsx, BetaBadge.tsx
  useAgentSessions.ts     // load + subscribe agent-sessions-changed (store slice)
src/components/ui/ai-elements/   // installés via `npx ai-elements@latest add conversation message tool reasoning code-block`
```

Store : slice `agents` dans `appStore` (`agentSessions`, `isLoadingAgents`, `loadAgentSessions`,
`updateAgentAnnotations`) ; `viewPrefsStore` : mode Global/Projet, groupes repliés.

Dépendances nouvelles : AI Elements tirent `ai` + `streamdown` (markdown) — à vérifier à
l'installation ; si trop lourd, garder `streamdown` seul et écrire `Message`/`Tool` maison (≈ 150
lignes). `rusqlite` côté Rust.

---

## Intégration avec l'existant

**Réutilisé** : `launch_external_terminal` + `TerminalPreset`, `create_project`, tags
(`tag_definitions`) et statuts (`status_definitions`), `Storage` (+ `agents.json`, `DataFile::Agents`),
`TauriEmitter`/`app.emit`, `CompactItem` / `ViewModeToggle`, palette, `viewPrefsStore`, sysinfo (déjà
présent pour `runtime_state`), export/import (annotations incluses dans `ScriptExport`).

**Touché** : `types/index.ts` (`View`, `AgentSession`…), `App.tsx` (switch + header), `AppSidebar.tsx`,
`buildEntities.ts`, `lib/tauri.ts`, `appStore.ts`, `Settings.tsx` (+ le literal de `handleSave` !),
`models.rs` (`AppSettings.agents`), `storage.rs`, `file_watcher.rs` (`DataFile::Agents`), `lib.rs`
(invoke_handler + démarrage du watcher agents), `commands.rs`, `ProjectView.tsx` (onglet), `PRD.md`.

**Bug latent à corriger au passage** : `commands.rs:441` — dans le bloc Windows, `MacTerminal |
ITerm2` retombe sur `wt.exe`. Et le preset Warp Windows devrait pouvoir exécuter une commande (launch
config), ce qui profite aussi aux services/scripts.

---

## Phases d'implémentation

### Phase 1 — Core lecture (Rust, sans UI)
- `agents/` : modèles, provider Claude (head/tail, registre live), provider Codex (sqlite ro +
  rollout), résolution projet, cache index, watcher récursif.
- Commandes `list_agent_sessions`, `refresh_agent_sessions`, `get_agents_health`, event.
- Tests unitaires sur des fixtures JSONL/rollout anonymisées (head/tail, titres, tool en cours,
  résolution projet sous-dossier).
- Livrable vérifiable : `cortx agents list --json` (mini sous-commande dès cette phase, ça sert de
  harness de test).

### Phase 2 — Vue liste (React)
- `View` + sidebar (badge beta) + palette + header.
- `AgentsView` : Global / Par projet, tri, filtres, ligne compacte, temps réel via l'event.
- Relance simple (une session, terminal preset) + Fork + Copier `--resume`.
- Groupe « Sans projet » + « Créer le projet ».
- Onglet Agents dans `ProjectView`.

### Phase 3 — Détail et annotations
- AI Elements, `get_agent_transcript` paginé, `AgentDetail`.
- `agents.json` : renommer, tags, statut, épingler, masquer, notes, override projet.
- Chips ticket (regex), fichiers touchés dérivés.
- Settings « Agents (beta) ».

### Phase 4 — Relance groupée et hooks
- Warp launch configuration générée (N onglets) + fallback N × `wt`.
- Hooks Claude Code opt-in : `Notification` (permission / question → `waiting` précis),
  `Stop`/`StopFailure` (`failed`), `PreToolUse` (outil courant fiable). Handler = `cortx agents
  hook` qui écrit un petit fichier d'état dans `runtime/agents/<sessionId>.json` (pas de socket).
- Détection process Codex.

### Phase 5 — Parité CLI / TUI / MCP
- `cortx agents list|show|resume`, onglet `[6] Agents` dans le TUI, tool MCP `list_agent_sessions`.
- Docs (`docs.md`, README, PRD).

---

## Risques et questions ouvertes

| Sujet | Risque / question | Position proposée |
|-------|-------------------|-------------------|
| Formats non documentés | Une mise à jour de Claude Code / Codex casse le parse. | Parse tolérant, badge beta, `get_agents_health` remonte « X fichiers illisibles », tests fixtures par version. |
| Volume | 39 dossiers projet, transcripts jusqu'à 2–3 Mo, ~5 500 sessions historiques ici. | Head/tail + cache mtime/size ; premier scan complet en tâche de fond avec état « indexation… ». Option « ignorer les sessions > N jours » dans Settings. |
| Sessions « idle » ≠ « attend une réponse » | Sans hooks, `idle` = le tour est fini ; on ne sait pas si l'agent a posé une question. | v1 : `waiting` si idle et dernier message assistant se termine par `?` ou contient un `AskUserQuestion` — heuristique assumée, hooks en phase 4. |
| Codex live | Pas de registre, pas de pid. | `unknown`/« actif il y a X min » assumé en v1. |
| Worktrees git | Un worktree de CortX hors de `root_path` ne matche pas. | Override manuel + détection `git rev-parse --git-common-dir` en phase 3 si besoin. |
| AI Elements | Poids des dépendances (`ai`, `streamdown`), API qui bouge. | Installer, mesurer le bundle ; fallback maison prévu. |
| Vie privée | Les transcripts contiennent tout. CortX ne les copie pas, ne les exporte pas (annotations seules dans l'export). | Rien à sortir de la machine. |
| Sécurité | On ne fait qu'ouvrir un terminal avec `claude --resume <uuid>` ; l'id est validé (uuid) avant d'être mis dans une commande. | Pas d'injection possible via un titre. |
| Warp launch configs | Fichiers YAML écrits dans `%APPDATA%\warp` → c'est une écriture dans la config d'un outil tiers. | Préfixe `cortx-agents-`, nettoyage des anciens, et un toggle Settings « Générer des launch configs Warp » (défaut on si preset = Warp). |

Réponses d'Alexis (2026-09-02) :
1. Détail en **sheet latérale**, qui s'ouvre/se ferme selon la ligne cliquée (re-clic = fermeture).
2. **7 jours** par défaut pour les sessions terminées, « Voir tout » derrière.
3. **Claude et Codex dès la v1.**
4. Ajout : **plusieurs vues** (card / list / compact via `ViewModeToggle`), comme Projets, Tools, Apps.
