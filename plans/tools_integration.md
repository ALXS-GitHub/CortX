# Plan : Integration Tools & Config Management dans CortX

## Contexte

CortX est un outil de centralisation de l'environnement dev :
1. **v1** — Projets et services associes (lancer une app dev en un clic)
2. **v2** — Scripts globaux (scripts disperses sur la machine, parametres, presets)
3. **v3 (ce plan)** — Tools et configs (registre de tous les outils installes + gestion de leurs configurations)

L'objectif : avoir un **cockpit dev personnel** ou tout est visible — projets, scripts, tools — dans une seule app.

### Probleme actuel

- Les outils (CLI, GUI, custom) sont installes a des endroits differents, avec des configs dispersees (`%APPDATA%`, `%USERPROFILE%`, `.config/`, etc.)
- Pas de vue d'ensemble de ce qu'on utilise, ce qu'on a teste, ce qu'on a abandonne
- Pas de lien facile entre un outil et sa configuration
- La Toolbox Docusaurus documente les outils mais ne les gere pas

### Alternatives existantes et pourquoi elles ne suffisent pas

| Outil | Ce qu'il fait | Ce qui manque |
|-------|--------------|---------------|
| **chezmoi** | Deploie des dotfiles depuis un repo Git | Pas de registre de tools, pas de GUI, pas de tracking de statut |
| **Scoop/WinGet** | Installent des packages de maniere declarative | Pas de gestion des configs, pas de vue d'ensemble perso |
| **Topgrade** | Met a jour tout | Juste les updates, pas de registre |
| **Dev Home (MS)** | Dashboard dev Windows | Deprecated mai 2025 |

Aucun outil ne combine : registre de tools + tracking de statut + reference aux configs + lien vers documentation + GUI.

---

## Decisions

| Decision | Choix | Raison |
|----------|-------|--------|
| Scope initial | GUI uniquement | Le TUI/CLI viendra plus tard (sous-commandes `cortx tools`) |
| Edition des configs | Editeur externe (Open in VSCode) | Pas besoin de reinventer un editeur de texte |
| Sync des configs | Reference seulement (v1), sync potentielle plus tard | Commencer simple, evaluer le besoin reel |
| Lien Toolbox | Champ URL par tool | Simple, pas de couplage fort entre les deux projets |
| Statuts | Labels custom avec defaults proposes | Flexibilite maximale tout en offrant un bon point de depart |
| Partage | Nice-to-have via import/export existant | Pas prioritaire, l'infra d'import/export CortX existe deja |
| Storage | Fichier JSON dedie (`tools.json`) | Coherent avec le pattern existant (projects.json, global_scripts.json, etc.) |
| TUI/CLI futur | Sous-commandes dans le binaire existant (`cortx tools`, `cortx tools list`) | Un seul binaire, separation claire via clap |

---

## Modele de donnees

### Tool (nouveau)

```rust
pub struct Tool {
    pub id: String,                    // UUID
    pub name: String,                  // ex: "bat", "Starship", "GlazeWM"
    pub description: Option<String>,   // Description libre
    pub category: Option<String>,      // ex: "CLI", "Terminal", "Window Manager", "Font", custom
    pub tags: Vec<String>,             // Tags libres (comme les scripts globaux)

    // Statut
    pub status: String,                // Label custom: "Active", "Inactive", "To Test", "Archived", "Replaced", ou custom
    pub replaced_by: Option<String>,   // ID d'un autre tool (si statut = "Replaced")

    // Installation
    pub install_method: Option<String>,     // ex: "scoop install bat", "winget install ...", "cargo install ...", "manual"
    pub install_location: Option<String>,   // Chemin d'install (ex: "C:\Users\alxsm\scoop\apps\bat")
    pub version: Option<String>,            // Version actuelle installee
    pub homepage: Option<String>,           // URL officielle du tool

    // Configuration
    pub config_paths: Vec<ToolConfigPath>,  // Liste de fichiers/dossiers de config associes

    // Documentation
    pub toolbox_url: Option<String>,        // Lien vers la page Toolbox Docusaurus
    pub notes: Option<String>,              // Notes libres

    // Organisation
    pub folder_id: Option<String>,          // Dossier virtuel (reutilise le systeme existant, nouveau type "Tool")
    pub order: u32,                         // Ordre d'affichage

    // Meta
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

### ToolConfigPath (nouveau)

```rust
pub struct ToolConfigPath {
    pub label: String,          // ex: "Main config", "Theme", "Keybindings"
    pub path: String,           // Chemin absolu vers le fichier ou dossier
    pub is_directory: bool,     // true si c'est un dossier entier
}
```

### Statuts par defaut proposes

Valeurs suggerees a l'utilisateur (mais il peut taper ce qu'il veut) :
- **Active** — utilise quotidiennement
- **Inactive** — installe mais plus utilise
- **To Test** — pas encore installe/teste, dans la liste d'envie
- **Archived** — plus pertinent, garde pour reference
- **Replaced** — remplace par un autre outil (lien `replaced_by`)

### Categories par defaut proposees

Suggerees (libres aussi) :
- CLI Tool
- Terminal
- Shell
- Prompt
- Editor / IDE
- Window Manager
- Font
- Theme
- Desktop / Ricing
- DevOps
- Language / Runtime
- Browser
- Utility
- Custom (mes propres outils)

---

## Dossiers virtuels

Le systeme de `VirtualFolder` existant supporte deja un champ `folder_type`. On ajoute un nouveau type :

```rust
pub enum FolderType {
    Project,
    Script,
    Tool,     // NOUVEAU
}
```

Cela permet d'organiser les tools en dossiers (ex: "Terminal Stack", "CLI Replacements", "Fonts", etc.) comme on organise deja les scripts.

---

## Vue GUI

### Navigation

Nouvelle section dans la sidebar, au meme niveau que "Dashboard" et "Scripts" :

```
Sidebar:
  - Dashboard (projets)
  - Scripts (globaux)
  - Tools (NOUVEAU)
  - Settings
```

### Vue principale Tools

Layout similaire a la vue Scripts existante :

```
+------------------------------------------+
| Tools                    [+ Add Tool]     |
|------------------------------------------|
| [Search...]         [Filter: status v]   |
|------------------------------------------|
| Folder: Terminal Stack                    |
|   > Starship          Active    CLI      |
|   > WezTerm           Active    Terminal |
|   > Oh My Posh        Inactive  Prompt   |
|                                          |
| Folder: CLI Replacements                  |
|   > bat               Active    CLI      |
|   > eza               Active    CLI      |
|   > fd                Active    CLI      |
|   > ripgrep           Active    CLI      |
|                                          |
| Sans dossier                              |
|   > GlazeWM           To Test   WM       |
|   > Rainmeter         Archived  Desktop  |
+------------------------------------------+
```

### Vue detail d'un Tool

En cliquant sur un tool, on affiche ses details (layout similaire a la vue detail d'un script) :

```
+------------------------------------------+
| < Back                                    |
|                                          |
| bat                              [Edit]  |
| A cat clone with syntax highlighting     |
|                                          |
| Status: Active        Category: CLI Tool |
| Version: 0.24.0                          |
| Install: scoop install bat               |
| Location: C:\Users\alxsm\scoop\apps\bat |
| Homepage: https://github.com/sharkdp/bat |
|                                          |
| Tags: [rust] [modern-cli] [replacement] |
|                                          |
| --- Configs ---                          |
| Main config    %APPDATA%\bat\config      |
|   [Open in VSCode] [Open in Explorer]    |
|                                          |
| --- Links ---                            |
| Toolbox: https://alxs-github.github.io/..|
|   [Open in Browser]                      |
|                                          |
| --- Notes ---                            |
| Remplace cat. Alias: alias cat="bat"     |
| Utilise le theme Catppuccin Mocha.       |
+------------------------------------------+
```

### Formulaire Add/Edit Tool

Champs du formulaire :

**Section principale :**
- Name (requis)
- Description
- Category (input avec suggestions des valeurs existantes + defaults)
- Status (input avec suggestions : Active, Inactive, To Test, Archived, Replaced)
- Replaced by (select parmi les autres tools, visible uniquement si status = Replaced)
- Tags (multi-input comme pour les scripts)
- Folder (select parmi les dossiers de type Tool)

**Section Installation :**
- Install method (texte libre : "scoop install bat", "manual", etc.)
- Install location (file picker ou texte)
- Version (texte)
- Homepage URL

**Section Configuration :**
- Liste dynamique de config paths (ajouter/supprimer)
  - Label (ex: "Main config")
  - Path (file/folder picker)

**Section Documentation :**
- Toolbox URL
- Notes (textarea)

### Actions rapides (boutons)

Pour chaque tool :
- **Open config in VSCode** (par config path)
- **Open folder in Explorer** (install location)
- **Open homepage** (navigateur)
- **Open Toolbox page** (navigateur)
- **Run install command** (si install_method defini, execute la commande — reutilise le process manager existant)

### Filtres et recherche

- **Recherche** par nom, description, tags
- **Filtre par statut** : All / Active / Inactive / To Test / Archived / Replaced
- **Filtre par categorie** : All / chaque categorie presente
- **Filtre par dossier** : All / chaque dossier + "Unfiled"
- **Tri** : Nom (A-Z), Date d'ajout, Statut

---

## Backend (Tauri commands)

Nouvelles commandes a ajouter :

```
// CRUD
get_all_tools() -> Vec<Tool>
get_tool(id) -> Option<Tool>
create_tool(input: CreateToolInput) -> Tool
update_tool(id, input: UpdateToolInput) -> Tool
delete_tool(id)
reorder_tools(tool_ids: Vec<String>)

// Actions
open_tool_config(tool_id, config_index) -> ()   // Ouvre dans VSCode
open_tool_location(tool_id) -> ()                // Ouvre dans Explorer
open_tool_url(tool_id, url_type: "homepage" | "toolbox") -> () // Ouvre dans le navigateur
run_install_command(tool_id) -> Result<u32, String>  // Lance la commande d'install

// Dossiers (reutilise le systeme existant avec folder_type = Tool)
// Les commandes existantes get_all_folders, create_folder, etc. supportent deja le type
```

### Storage

Nouveau fichier : `tools.json` dans le meme repertoire que les autres fichiers CortX.

Format identique aux autres storages : vecteur de `Tool` serialise en JSON, avec file locking via `fs2`.

---

## Integration avec l'existant

### Ce qu'on reutilise

| Composant existant | Utilisation |
|-------------------|-------------|
| `VirtualFolder` + `FolderType` | Dossiers de type `Tool` |
| `Storage` (file locking, JSON) | Nouveau fichier `tools.json` |
| `ProcessManager` | Pour `run_install_command` |
| Import/Export | Inclure les tools dans l'export JSON |
| Sidebar + routing | Nouveau lien "Tools" |
| Tag system | Meme pattern de tags libres |
| Open in VSCode / Explorer | Commandes existantes reutilisees |

### Ce qu'on cree de neuf

- Modeles `Tool` + `ToolConfigPath` dans `cortx-core/src/models.rs`
- Storage methods dans `cortx-core/src/storage.rs`
- Commandes Tauri dans `src-tauri/src/commands.rs`
- Composants React : `ToolsView`, `ToolDetail`, `ToolForm`, `ToolCard`
- Route `/tools` + `/tools/:id`

---

## Lien avec la Toolbox Docusaurus

Le lien est intentionnellement leger :
- Chaque tool dans CortX a un champ optionnel `toolbox_url`
- Un bouton "Open Toolbox page" ouvre l'URL dans le navigateur
- Pas de synchronisation automatique entre les deux
- La Toolbox reste la source de documentation detaillee
- CortX reste la source de gestion operationnelle (statut, config, lancement)

A terme, on pourrait imaginer un script qui genere les pages Toolbox depuis les donnees CortX, mais ce n'est pas dans le scope initial.

---

## TUI/CLI futur (hors scope initial, pour reference)

Architecture prevue pour plus tard :

```
cortx                      -> TUI scripts (existant)
cortx run <script>         -> CLI run script (existant)
cortx list                 -> CLI list scripts (existant)
cortx tools                -> TUI tools (futur)
cortx tools list           -> CLI list tools (futur)
cortx tools add <name>     -> CLI add tool (futur)
cortx tools status <name>  -> CLI show/change status (futur)
cortx tools configs <name> -> CLI list config paths (futur)
```

Implementation via sous-commandes clap dans le binaire existant `cortx-tui`.

---

## Phases d'implementation suggerees

### Phase 1 : Fondations (backend)
- Modeles `Tool` + `ToolConfigPath` dans cortx-core
- Storage (CRUD tools.json)
- Commandes Tauri (CRUD + actions)
- Extension de `FolderType` avec `Tool`

### Phase 2 : Vue principale (frontend)
- Route `/tools`
- Composant `ToolsView` (liste avec dossiers, recherche, filtres)
- Composant `ToolCard`
- Sidebar : ajout du lien "Tools"

### Phase 3 : Detail et formulaire (frontend)
- Route `/tools/:id`
- Composant `ToolDetail` (vue detail complete)
- Composant `ToolForm` (creation/edition)
- Actions : open config, open location, open URLs

### Phase 4 : Polish
- Filtres avances (statut, categorie, dossier)
- Drag-and-drop pour reordonner
- Import/Export incluant les tools
- Run install command

---

## Questions ouvertes (a trancher pendant l'implementation)

1. **Auto-detection de tools installes** — scanner Scoop/WinGet/Chocolatey pour pre-remplir le registre ? (probablement v2)
2. **Sync des configs** — si le besoin se confirme, ajouter un mode "backup config to central folder" + "restore" ? (v2)
3. **Version tracking** — detecter automatiquement la version installee via la commande du tool ? (v2)
4. **Lien Tool -> Script** — un tool pourrait avoir des scripts CortX associes (ex: "update bat", "switch bat theme") ? (a discuter)
5. **Icones** — afficher l'icone du tool dans la liste ? Source : fichier local, URL, ou pack d'icones integre ?

---

## Features futures — Reflexion en cours

### Analyse de l'existant (outils concurrents)

Aucun outil existant ne combine registry + GUI + config management + Windows support :

| Outil | Ce qu'il fait | Ce qui manque vs CortX |
|-------|--------------|----------------------|
| **chezmoi** | Dotfiles : git repo, templating, deploy, secrets, multi-machine | Pas de registry, pas de GUI, pas de tracking statut/version |
| **yadm** | Bare git repo sur $HOME, alternatives par OS | Pas de registry, pas de GUI |
| **dotter** | Linking dotfiles, Rust, cross-platform | Juste du linking |
| **Mackup** | Backup/restore 400+ apps (paths connus), sync Dropbox/Git | macOS/Linux only, pas de registry, pas de GUI |
| **Nix/Home Manager** | Declaratif total (packages + configs) | Complexe, pas natif Windows |
| **WinGet Config** | YAML setup machine Windows | Juste l'install, pas de configs post-install |
| **Dev Home (MS)** | Dashboard dev Windows | **Deprecie mai 2025** |
| **shallow-backup** | Dump listes de packages (brew/pip/npm) | Pas de registry, juste des listes |

**Point cle :** Aucun de ces outils ne fait d'auto-detection des outils installes (sauf Mackup qui a une DB de paths connus hardcodes, et shallow-backup qui dump les package managers). C'est un avantage potentiel pour CortX.

**Positionnement CortX :** "chezmoi gere tes fichiers, CortX gere ta connaissance de ton environnement" — mais l'objectif est d'aller au-dela du simple annuaire.

### Features envisagees (par priorite estimee)

#### 1. Config Snapshots & Restore (priorite haute)

**Approche retenue : copie simple** (pas de bare git repo)
- Copier les fichiers config dans un dossier interne CortX au clic "Snapshot"
- Avantage : simple, pas de risque de modifier la mauvaise copie
- Lister les snapshots avec dates par tool
- Diff entre snapshot et fichier actuel
- Restore = copier le snapshot vers le path original
- Pas besoin de git — juste des copies horodatees dans le data dir

**Approche alternative consideree et ecartee : bare git repo**
- `git --git-dir=~/.cortx-configs.git --work-tree=/ add <path>` (comme yadm)
- Avantage : historique natif, pas de copie, diff integre
- Inconvenient : risques (modifier le mauvais fichier), complexite, besoin de git installe, `.gitignore *` sur la racine
- **Decision : la copie est plus simple et evite les risques**

#### 2. Setup Script Generator (priorite basse)

- Generer un `.ps1` / `.sh` a partir du champ `installMethod` de chaque tool
- Grouper par package manager : `scoop install X Y Z`, `cargo install A B`, etc.
- Checklist pour inclure/exclure certains tools
- One-click pour recreer le setup sur une nouvelle machine

#### 3. Auto-detection / Scan (priorite moyenne)

Aucun concurrent ne fait ca proprement. CortX pourrait :
- Scanner le PATH et detecter les binaires connus
- Interroger les package managers (`scoop list`, `winget list`, `cargo install --list`, `npm list -g`)
- Checker les paths de config connus par app (DB interne, comme Mackup mais mieux)
- Pre-remplir un tool : nom, version, install method, install location, config paths
- Proposer l'ajout en un clic

#### 4. Health Check / Audit Dashboard (priorite moyenne)

- Verifier que le tool est installe (`where tool` / check path)
- Comparer version enregistree vs `tool --version`
- Badge "outdated" / "up to date" / "not found"
- Dashboard resume : "3 outdated, 1 not found, 2 configs missing"

#### 5. Quick Actions par Tool (priorite basse)

- Commandes custom associees a un tool (comme les scripts mais liees au tool)
- Ex: Starship → "Reload config", Scoop → "Update this tool"
- Reutilise le process manager existant

#### 6. Config Watch & Notifications (priorite basse)

- Watcher sur les fichiers de config
- Notification quand un config change en dehors de CortX
- Auto-snapshot optionnel avant chaque changement detecte

#### 7. Dependency Graph (priorite basse)

- Champ `dependsOn: string[]` (IDs d'autres tools)
- Warning si on archive un tool dont un autre depend
- Ordre d'installation respecte dans le setup script
