# Plan : Global Scripts & TUI (Ratatui) pour CortX

## Contexte

CortX gere actuellement des **projets** et leurs **services** (+ scripts lies aux projets). L'objectif est d'ajouter :
1. **Scripts globaux** : des scripts independants de tout projet (helpers perso, outils CLI, automatisation)
2. **Un TUI Ratatui** (`cortx`) : interface CLI interactive pour lancer facilement ces scripts
3. **Dossiers virtuels** : organisation des projets ET scripts en categories
4. Le tout avec une **lib partagee** (`cortx-core`) entre GUI et TUI

Le but : remplacer la config powershell de scripts par un systeme centralise, configurable et accessible depuis le terminal ou la GUI.

---

## Decisions architecturales

| Decision | Choix |
|----------|-------|
| Structure repo | Cargo workspace a la racine avec `cortx-core` (lib) + `cortx-tui` (bin) |
| Partage de donnees | Acces direct aux fichiers JSON (file locking avec `fs2`) |
| Modele de script | Fichier sur disque reference ET/OU commande inline |
| GUI layout | Nouvelle section "Scripts" dans la sidebar avec vue dediee |
| Categories | Dossiers virtuels dans CortX (1 niveau), pour projets ET scripts |
| Parametres | Systeme type complet (string/bool/number/enum/path) + presets + auto-detect --help |
| TUI UX | Interactif par defaut, `cortx run <script>` pour execution directe |
| TUI style | Lazygit/Lazydocker (multi-panel, clavier, bordures colorees) |
| TUI output | Inline dans le TUI (split screen) |
| TUI scope V1 | Scripts globaux uniquement (pas projets/services) |
| Script groups | Lancement groupe (parallele ou sequentiel, stop-on-failure) |
| Import/export | JSON export config + dossier principal peut etre un repo git |
| Fuzzy search | nucleo (utilise par Helix editor) |
| CLI name | `cortx` |
| Help parsing | Format GNU/POSIX standard |
| Historique | Tracking execution (date, duree, succes/echec, params utilises) |

---

## Structure cible du repo

```
Local-App-Launcher/
  Cargo.toml                          # [workspace] racine
  crates/
    cortx-core/                       # Lib partagee
      Cargo.toml
      src/
        lib.rs                        # Re-exports
        models.rs                     # Tous les modeles de donnees
        storage.rs                    # Persistance JSON + file locking
        process_manager.rs            # Gestion processus (trait EventEmitter)
        script_discovery.rs           # Scan dossier scripts
        help_parser.rs                # Parsing --help GNU/POSIX
        error.rs                      # Types d'erreur
    cortx-tui/                        # Binary TUI
      Cargo.toml
      src/
        main.rs                       # Entry + clap CLI
        app.rs                        # State de l'app TUI
        event.rs                      # Event loop (clavier + process events)
        ui/
          mod.rs                      # Layout principal
          scripts_list.rs             # Panel liste scripts
          script_info.rs              # Panel detail script
          output.rs                   # Panel sortie execution
          search.rs                   # Popup recherche fuzzy
          param_form.rs               # Formulaire parametres
          status_bar.rs               # Barre de status
          help.rs                     # Ecran aide
          theme.rs                    # Couleurs et styles
        input.rs                      # Gestion clavier
        tui_emitter.rs                # Impl ProcessEventEmitter pour TUI
  frontend/
    src-tauri/
      Cargo.toml                      # Depend de cortx-core
      src/
        main.rs                       # Inchange
        lib.rs                        # Inchange (setup Tauri)
        commands.rs                   # Commandes Tauri (existantes + ~20 nouvelles)
        tauri_emitter.rs              # NOUVEAU : Impl ProcessEventEmitter pour Tauri
    src/
      components/
        global-scripts/               # NOUVEAU : composants scripts globaux
          GlobalScriptsView.tsx        # Vue principale (liste + dossiers)
          GlobalScriptCard.tsx         # Carte d'un script
          GlobalScriptForm.tsx         # Formulaire creation/edition
          GlobalScriptDetail.tsx       # Vue detail (params, historique)
          ParameterEditor.tsx          # Editeur de parametres
          ParameterForm.tsx            # Formulaire params avant execution
          FolderManager.tsx            # Gestion dossiers virtuels
          ScriptGroupManager.tsx       # Gestion groupes de scripts
          ExecutionHistory.tsx         # Historique d'executions
      (fichiers existants modifies listees ci-dessous)
```

---

## PHASE 1 : Workspace Cargo & cortx-core

**Objectif** : Restructurer le repo, extraire la logique metier dans `cortx-core`, s'assurer que l'app Tauri fonctionne identiquement.

### 1.1 Creer le workspace Cargo

**Creer** : `Cargo.toml` (racine)
```toml
[workspace]
resolver = "2"
members = ["crates/cortx-core", "crates/cortx-tui", "frontend/src-tauri"]
```

**Creer** : `crates/cortx-core/Cargo.toml`
```toml
[package]
name = "cortx-core"
version = "0.4.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
uuid = { version = "1.11", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
directories = "5.0"
parking_lot = "0.12"
thiserror = "2.0"
walkdir = "2.4"
log = "0.4"
fs2 = "0.4"
regex = "1"
```

**Modifier** : `frontend/src-tauri/Cargo.toml`
- Ajouter `cortx-core = { path = "../../crates/cortx-core" }`
- Retirer les deps dupliquees (uuid, directories, chrono, parking_lot, thiserror, walkdir)

### 1.2 Extraire models.rs vers cortx-core

**Fichier source** : `frontend/src-tauri/src/models.rs`
**Fichier cible** : `crates/cortx-core/src/models.rs`

- Deplacer TOUS les modeles existants (Project, Service, Script, AppSettings, TerminalPreset, etc.)
- Ajouter les nouveaux modeles :

```rust
// === SCRIPT GLOBAL ===
pub struct GlobalScript {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub script_path: Option<String>,       // Chemin absolu fichier script
    pub working_dir: String,               // Repertoire de travail (absolu)
    pub color: Option<String>,
    pub folder_id: Option<String>,         // Dossier virtuel
    pub tags: Vec<String>,
    pub parameters: Vec<ScriptParameter>,
    pub parameter_presets: Vec<ParameterPreset>,
    pub default_preset_id: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub order: u32,
    pub auto_discovered: bool,
}

// === PARAMETRES ===
pub enum ScriptParamType { String, Bool, Number, Enum, Path }

pub struct ScriptParameter {
    pub name: String,
    pub param_type: ScriptParamType,
    pub short_flag: Option<String>,
    pub long_flag: Option<String>,
    pub description: Option<String>,
    pub default_value: Option<String>,
    pub required: bool,
    pub enum_values: Vec<String>,
}

pub struct ParameterPreset {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub values: HashMap<String, String>,
}

// === DOSSIERS VIRTUELS ===
pub struct VirtualFolder {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub order: u32,
    pub folder_type: FolderType,  // Project | Script
}

// === GROUPES DE SCRIPTS ===
pub struct ScriptGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub script_ids: Vec<String>,
    pub execution_mode: GroupExecutionMode,  // Parallel | Sequential
    pub stop_on_failure: bool,
    pub folder_id: Option<String>,
    pub order: u32,
}

// === HISTORIQUE ===
pub struct ExecutionRecord {
    pub id: String,
    pub script_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub parameters_used: HashMap<String, String>,
    pub preset_name: Option<String>,
}

// === CONFIG SCRIPTS ===
pub struct ScriptsConfig {
    pub main_folder: Option<String>,
    pub scan_extensions: Vec<String>,      // .sh, .ps1, .py, etc.
    pub ignored_patterns: Vec<String>,     // node_modules, .git, etc.
    pub auto_scan_on_startup: bool,
}

// === AJOUT A PROJECT ===
// Ajouter a la struct Project existante :
pub folder_id: Option<String>,
```

- Modifier `frontend/src-tauri/src/models.rs` : remplacer par `pub use cortx_core::models::*;`

### 1.3 Extraire storage.rs vers cortx-core

**Fichier source** : `frontend/src-tauri/src/storage.rs`
**Fichier cible** : `crates/cortx-core/src/storage.rs`

Changements cles :
- Ajouter **file locking** via `fs2::FileExt` (shared lock lecture, exclusive lock ecriture)
- Ajouter stockage pour : `global_scripts.json`, `folders.json`, `script_groups.json`, `execution_history.json`
- Ajouter CRUD pour : GlobalScript, VirtualFolder, ScriptGroup, ExecutionRecord
- Garder toutes les methodes existantes (projects, services, scripts projet, settings)
- Le wrapper Tauri dans `frontend/src-tauri/src/storage.rs` ne fait que re-exporter

### 1.4 Extraire process_manager.rs vers cortx-core

**Fichier source** : `frontend/src-tauri/src/process_manager.rs`
**Fichier cible** : `crates/cortx-core/src/process_manager.rs`

Changement cle : introduire un **trait generique** pour l'emission d'evenements :

```rust
pub trait ProcessEventEmitter: Send + Sync + 'static {
    fn emit_script_log(&self, script_id: &str, stream: LogStream, content: String);
    fn emit_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>);
    fn emit_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool);
    fn emit_service_log(&self, service_id: &str, stream: LogStream, content: String);
    fn emit_service_status(&self, service_id: &str, status: ServiceStatus, pid: Option<u32>,
                           mode: Option<String>, preset: Option<String>);
    fn emit_service_exit(&self, service_id: &str, exit_code: Option<i32>);
}
```

- Toutes les methodes prennent `Arc<dyn ProcessEventEmitter>` au lieu de `AppHandle`
- Ajouter `global_scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>` pour les scripts globaux
- Ajouter `run_global_script()` et `stop_global_script()`

**Creer** : `frontend/src-tauri/src/tauri_emitter.rs` - implementation du trait pour Tauri (emit via `AppHandle`)

### 1.5 Creer script_discovery.rs et error.rs

**`crates/cortx-core/src/script_discovery.rs`** :
- `scan_folder(path, extensions, ignored_patterns) -> Vec<DiscoveredScript>`
- Utilise `walkdir` pour parcourir le dossier
- Filtre par extension, ignore les patterns configures
- Extrait nom + description (commentaire en tete du fichier si possible)

**`crates/cortx-core/src/error.rs`** :
- Enum d'erreurs unifiee avec `thiserror`
- Couvre : IO, JSON, NotFound, AlreadyRunning, etc.

### 1.6 Adapter commands.rs

**Fichier** : `frontend/src-tauri/src/commands.rs`
- Modifier les imports pour utiliser `cortx_core::*`
- Adapter `AppState` pour utiliser `CoreStorage` et `CoreProcessManager` de cortx-core
- Toutes les commandes existantes doivent fonctionner identiquement

### 1.7 Verification Phase 1

- `cargo build --workspace` compile sans erreur
- `npm run tauri:dev` dans `frontend/` lance l'app normalement
- Tous les comportements existants (projets, services, scripts projet) fonctionnent identiquement
- `cargo test --workspace` passe (tests unitaires cortx-core)

---

## PHASE 2 : Scripts globaux dans la GUI

### 2.1 Nouvelles commandes Tauri (~20)

**Fichier** : `frontend/src-tauri/src/commands.rs`

Scripts globaux :
- `get_all_global_scripts`, `get_global_script`, `create_global_script`
- `update_global_script`, `delete_global_script`, `reorder_global_scripts`
- `run_global_script(script_id, parameter_values?, preset_id?)` -> PID
- `stop_global_script`, `is_global_script_running`

Scan :
- `scan_scripts_folder` -> `Vec<DiscoveredScript>`
- `import_discovered_scripts` -> `Vec<GlobalScript>`

Dossiers :
- `get_all_folders`, `create_folder`, `update_folder`, `delete_folder`

Groupes :
- `get_all_script_groups`, `create_script_group`, `update_script_group`
- `delete_script_group`, `run_script_group`

Historique :
- `get_execution_history(script_id, limit?)`
- `clear_execution_history(script_id)`

Config :
- `get_scripts_config`, `update_scripts_config`

Help parsing :
- `auto_detect_script_params(command)` -> `Vec<ScriptParameter>`

Export/Import :
- `export_scripts_config` -> JSON string
- `import_scripts_config(json)`

Enregistrer toutes ces commandes dans `lib.rs` invoke_handler.

### 2.2 Types TypeScript

**Fichier** : `frontend/src/types/index.ts`

Ajouter : `GlobalScript`, `ScriptParameter`, `ScriptParamType`, `ParameterPreset`, `VirtualFolder`, `FolderType`, `ScriptGroup`, `GroupExecutionMode`, `ExecutionRecord`, `ScriptsConfig`, `DiscoveredScript`, et les types Input associes.

Modifier le type `View` : ajouter `'scripts'` et `'script-detail'`.

### 2.3 Bridge Tauri

**Fichier** : `frontend/src/lib/tauri.ts`

Ajouter ~20 fonctions invoke + event listeners pour `global-script-log`, `global-script-status`, `global-script-exit`.

### 2.4 Zustand Store

**Fichier** : `frontend/src/stores/appStore.ts`

Nouveau state :
- `globalScripts: GlobalScript[]`
- `folders: VirtualFolder[]`
- `scriptGroups: ScriptGroup[]`
- `globalScriptRuntimes: Map<string, ScriptRuntime>`
- `scriptsConfig: ScriptsConfig | null`
- `selectedGlobalScriptId: string | null`

Nouvelles actions : CRUD pour global scripts, folders, groups + runtime management (memes patterns que les scripts projet existants).

Init : charger `globalScripts`, `folders`, `scriptGroups`, `scriptsConfig` au demarrage.

### 2.5 Composants GUI

**Creer** `frontend/src/components/global-scripts/` :

| Composant | Description |
|-----------|-------------|
| `GlobalScriptsView.tsx` | Vue principale : barre de recherche, filtres par dossier, grille de scripts, boutons Add/Scan/NewFolder |
| `GlobalScriptCard.tsx` | Carte d'un script (nom, description, status, derniere exec, boutons run/stop/edit) |
| `GlobalScriptForm.tsx` | Dialog creation/edition (commande, fichier, working dir, dossier, tags, couleur, env vars) |
| `GlobalScriptDetail.tsx` | Vue detail : config params, presets, historique, execution avec formulaire params |
| `ParameterEditor.tsx` | Editeur de la liste des parametres d'un script (CRUD inline, types, valeurs par defaut) |
| `ParameterForm.tsx` | Formulaire dynamique avant execution : champs generes selon les ScriptParameter, selector de preset |
| `FolderManager.tsx` | Gestion des dossiers virtuels (create/rename/delete/reorder) |
| `ScriptGroupManager.tsx` | Gestion des groupes (create/edit/delete, selection scripts, mode, stop-on-failure) |
| `ExecutionHistory.tsx` | Tableau historique (date, duree, status, params, preset) |

### 2.6 Modifications de l'existant

**`frontend/src/components/layout/AppSidebar.tsx`** :
- Ajouter lien "Scripts" dans la navigation (entre Dashboard et Settings)
- Ajouter section dynamique "Global Scripts" pour les scripts en cours d'execution

**`frontend/src/App.tsx`** :
- Ajouter `case 'scripts': return <GlobalScriptsView />`
- Ajouter `case 'script-detail': return <GlobalScriptDetail />`
- Setup event listeners pour `global-script-log`, `global-script-status`, `global-script-exit`

**`frontend/src/views/Dashboard.tsx`** :
- Ajouter filtrage par dossier virtuel (dropdown ou sidebar de dossiers)
- Les projets avec `folder_id` sont groupes visuellement

**Terminal panel** : les global scripts utilisent le terminalId format `"global-script:{id}"` pour s'integrer dans le meme terminal multi-pane existant.

### 2.7 Verification Phase 2

- Creer/editer/supprimer des scripts globaux via la GUI
- Configurer un dossier principal et scanner les scripts
- Organiser en dossiers virtuels
- Configurer des parametres et les remplir avant execution
- Lancer un script global et voir les logs dans le terminal
- Creer un groupe et le lancer
- Voir l'historique d'execution

---

## PHASE 3 : TUI Ratatui

### 3.1 Setup du crate TUI

**Creer** : `crates/cortx-tui/Cargo.toml`
```toml
[package]
name = "cortx-tui"
version = "0.4.0"
edition = "2021"

[[bin]]
name = "cortx"
path = "src/main.rs"

[dependencies]
cortx-core = { path = "../cortx-core" }
ratatui = "0.29"
crossterm = "0.28"
clap = { version = "4", features = ["derive"] }
nucleo = "0.5"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
log = "0.4"
env_logger = "0.11"
unicode-width = "0.2"
```

### 3.2 CLI avec Clap

**`crates/cortx-tui/src/main.rs`** :
```
cortx                        -> Mode TUI interactif
cortx <script_name> [args]   -> Execute directement un script
cortx --list                 -> Liste les scripts et quitte
cortx --preset <name> <script_name>  -> Execute avec un preset
```

### 3.3 Layout TUI (style Lazygit)

```
+--[ Scripts ]------------------+--[ Info ]---------------------+
| > Build frontend       [done] | Name: Build frontend          |
|   Deploy staging        [run] | Command: npm run build        |
|   Backup database             | Working dir: ~/project        |
| -- DevOps --                  | Params: --env prod            |
|   Docker cleanup              | Last run: 2m ago (success)    |
|   K8s deploy                  |------[ Output ]---------------|
|                               | $ npm run build               |
| [/] Search...                 | > Building for production...  |
|                               | Done in 3.2s                  |
+-------------------------------+-------------------------------+
 [q]Quit [/]Search [Enter]Run [p]Params [?]Help        3 scripts
```

3 panels : ScriptList (gauche), ScriptInfo (droite haut), Output (droite bas)
+ barre de status en bas avec raccourcis clavier

### 3.4 Modules du TUI

| Module | Responsabilite |
|--------|----------------|
| `app.rs` | Struct App avec tout le state, methodes de logique |
| `event.rs` | Event loop : events clavier (crossterm) + events process (mpsc channel) |
| `input.rs` | Dispatch des touches selon le mode (normal, search, param form) |
| `tui_emitter.rs` | Impl `ProcessEventEmitter` qui envoie dans le channel mpsc |
| `ui/mod.rs` | Layout principal (3 panels + status bar) |
| `ui/scripts_list.rs` | Rendu de la liste de scripts avec dossiers, status, couleurs |
| `ui/script_info.rs` | Rendu des infos du script selectionne |
| `ui/output.rs` | Rendu des logs d'execution avec scrolling |
| `ui/search.rs` | Popup de recherche fuzzy (overlay) |
| `ui/param_form.rs` | Formulaire parametres en TUI (popup ou panel) |
| `ui/status_bar.rs` | Raccourcis clavier contextuels |
| `ui/help.rs` | Ecran d'aide complet |
| `ui/theme.rs` | Couleurs (border, status, text, highlight) |

### 3.5 Navigation clavier

| Touche | Action |
|--------|--------|
| `j/k` ou fleches | Naviguer dans la liste |
| `Tab` | Changer de panel actif |
| `Enter` | Lancer le script (ouvre param form si params) |
| `s` | Stop le script en cours |
| `/` | Mode recherche fuzzy |
| `Esc` | Quitter le mode actuel / fermer popup |
| `p` | Ouvrir le formulaire parametres |
| `e` | Editer le script selectionne (ouvre dans $EDITOR) |
| `d` | Supprimer le script |
| `r` | Recharger la liste |
| `g/G` | Aller en haut/bas |
| `h` | Afficher l'historique |
| `?` | Aide |
| `q` | Quitter |
| `c` (dans Output) | Clear output |
| `f` (dans Output) | Toggle auto-scroll |

### 3.6 Recherche fuzzy

- Utilise `nucleo` pour le matching
- Active avec `/`, popup overlay en haut de la liste
- Filtre en temps reel pendant la saisie
- `Enter` confirme la selection, `Esc` annule
- Match sur nom + description + tags

### 3.7 Execution inline

- Quand un script est lance, l'output apparait dans le panel Output
- Les lignes stdout en blanc, stderr en rouge
- Auto-scroll par defaut, desactivable avec `f`
- Status dans la liste change en temps reel (idle -> running -> completed/failed)
- Plusieurs scripts peuvent tourner en meme temps

### 3.8 Verification Phase 3

- `cargo build --bin cortx` compile
- `cortx` lance le TUI avec la liste des scripts (lus depuis le JSON)
- `cortx --list` affiche les scripts en mode texte
- `cortx <name>` execute un script directement
- Navigation, recherche fuzzy, execution inline fonctionnent
- Parametres editables avant execution

---

## PHASE 4 : Features avancees

### 4.1 Auto-detection parametres depuis --help

**Fichier** : `crates/cortx-core/src/help_parser.rs`

- Execute `<command> --help` et parse la sortie
- Regex pour le format GNU/POSIX : `-f, --flag  Description` et `--option VALUE  Description`
- Retourne `Vec<ScriptParameter>` avec les types deduits (flag sans valeur = Bool, avec valeur = String)
- GUI : bouton "Import from --help" dans ParameterEditor, preview des params detectes
- TUI : commande `cortx detect <script_name>` pour auto-detecter

### 4.2 Groupes de scripts

- Backend : `run_script_group()` dans le process manager
  - Mode parallele : lance tout d'un coup
  - Mode sequentiel : lance un par un, attend la fin, verifie succes si stop_on_failure
- GUI : `ScriptGroupManager.tsx` avec create/edit/delete, selection multi des scripts
- TUI : section "Groups" dans la liste, `Enter` sur un groupe lance tout le groupe

### 4.3 Import/Export

- **Export JSON** : `export_scripts_config()` serialise scripts + folders + groups en JSON
- **Import JSON** : `import_scripts_config()` merge avec les configs existantes (pas d'ecrasement)
- **Git** : le dossier principal peut etre un repo git, gere manuellement par l'utilisateur. CortX fournit "Open in Explorer" / "Open in VSCode" pour ce dossier
- GUI : boutons Export/Import dans Settings > Scripts Config
- TUI : `cortx export > scripts.json` et `cortx import scripts.json`

### 4.4 Historique d'execution

- Chaque fin d'execution cree un `ExecutionRecord` automatiquement dans le process manager
- Stocke dans `execution_history.json` (limite configurable, ex: 100 dernieres par script)
- GUI : composant `ExecutionHistory.tsx` dans le detail d'un script
- TUI : touche `h` affiche les dernieres executions du script selectionne

### 4.5 Verification Phase 4

- `--help` parsing fonctionne avec des commandes reelles (python argparse, grep, curl)
- Groupes : lancer un groupe sequentiel avec un script qui echoue au milieu
- Export/import : round-trip sans perte de donnees
- Historique : les executions sont enregistrees et affichees correctement

---

## Fichiers critiques a modifier

| Fichier | Modification |
|---------|-------------|
| `frontend/src-tauri/Cargo.toml` | Ajouter dep cortx-core, retirer deps dupliquees |
| `frontend/src-tauri/src/models.rs` | Re-exporter depuis cortx-core |
| `frontend/src-tauri/src/storage.rs` | Re-exporter depuis cortx-core |
| `frontend/src-tauri/src/process_manager.rs` | Re-exporter depuis cortx-core + wrapper Tauri |
| `frontend/src-tauri/src/commands.rs` | Adapter imports + ajouter ~20 nouvelles commandes |
| `frontend/src-tauri/src/lib.rs` | Enregistrer les nouvelles commandes |
| `frontend/src/types/index.ts` | Ajouter tous les nouveaux types TS |
| `frontend/src/lib/tauri.ts` | Ajouter ~20 fonctions bridge + 3 event listeners |
| `frontend/src/stores/appStore.ts` | Etendre avec globalScripts, folders, groups, etc. |
| `frontend/src/App.tsx` | Ajouter vues scripts + event listeners |
| `frontend/src/components/layout/AppSidebar.tsx` | Ajouter section Scripts navigation + scripts en cours |
| `frontend/src/views/Dashboard.tsx` | Ajouter filtrage par dossier virtuel |

## Nouvelles dependances

| Crate | Usage | Ou |
|-------|-------|----|
| `fs2` | File locking cross-platform | cortx-core |
| `regex` | Parsing --help | cortx-core |
| `ratatui` | Framework TUI | cortx-tui |
| `crossterm` | Backend terminal pour ratatui | cortx-tui |
| `clap` | Parsing CLI args | cortx-tui |
| `nucleo` | Recherche fuzzy | cortx-tui |
| `anyhow` | Error handling simplifie | cortx-tui |
| `env_logger` | Logging | cortx-tui |
| `unicode-width` | Largeur caracteres pour l'UI | cortx-tui |

## Ordre d'implementation

1. **Phase 1** : Workspace + cortx-core (extraction + nouveaux modeles)
2. **Phase 2** : GUI (commandes Tauri + composants React + store)
3. **Phase 3** : TUI (Ratatui + clap + nucleo)
4. **Phase 4** : Features avancees (help parser, groupes, import/export, historique)

Chaque phase est testable independamment et ne casse pas les fonctionnalites existantes.
