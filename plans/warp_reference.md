# Référence Warp — et reprise du travail sur les blocs

Dernière mise à jour : 2026-09-05.

Ce document existe parce que CortX prend Warp comme référence pour son mode
terminal (DEV-13), et que pendant toute la première passe on a travaillé à
partir de captures d'écran et de chaînes extraites du binaire. **C'était
inutile : Warp est open source.**

---

## 1. Warp est open source — et le dépôt est lisible

- Dépôt : **https://github.com/warpdotdev/warp**
- Ouvert le **30 avril 2026**. Rust. ~56k étoiles.
- Révision consultée : `a48ff80` (2026-09-05).

### Licences — la contrainte à connaître avant de toucher à quoi que ce soit

| Partie | Licence |
|---|---|
| `crates/warpui`, `crates/warpui_core` (leur framework UI natif) | **MIT** |
| **Tout le reste**, dont `app/` et le terminal | **AGPL v3** |

CortX publie des releases GitHub (`.github/workflows/deploy.yml`), donc c'est
de la **distribution**. Embarquer du code AGPL forcerait CortX sous AGPL.

> **Règle de travail : lire pour comprendre, jamais transcrire.** On s'en sert
> comme référence de *comportement* et de *paramètres* (« leur padding vaut
> 1,1 cellule »), pas comme source à recopier. Les deux crates MIT sont libres
> d'usage mais inutilisables ici : c'est de l'UI native, CortX est un WebView
> React.

### Ce que ça remplace

L'installation locale (`C:\Program Files\Warp\`) reste utile pour **la config
d'Alexis** et **ses thèmes**, mais plus pour le code :

- `resources/settings_schema.json` — tous les réglages avec défauts et descriptions
- `pwsh.ps1` — l'intégration shell PowerShell en clair
- `%LOCALAPPDATA%\warp\Warp\config\settings.toml` — la config réelle d'Alexis
- `%APPDATA%\warp\Warp\data\themes\` — ses thèmes

---

## 2. Où regarder dans leur source

Cloner ailleurs que dans le dépôt CortX. Sous Windows il faut
`git config core.longpaths true` (des chemins de migration dépassent la limite).

| Sujet | Chemin |
|---|---|
| Espacement / padding des blocs | `app/src/settings/mod.rs` → `TerminalSpacing` |
| Rendu de la grille de blocs | `app/src/terminal/blockgrid_renderer.rs`, `blockgrid_element.rs` |
| Liste de blocs, viewport | `app/src/terminal/block_list_element.rs`, `block_list_viewport.rs` |
| Réglages de blocs | `app/src/terminal/block_list_settings.rs` |
| Prompt sur la même ligne | `app/src/settings/same_line_prompt_block.rs` |
| Modèle de bloc, sérialisation | `app/src/terminal/model/block/`, `model/blocks/` |
| **Zone de saisie** (mode classique) | `app/src/terminal/input/classic.rs`, `buffer_model.rs`, `decorations.rs` |
| Historique inline / menu de complétion | `app/src/terminal/input/inline_history/`, `inline_menu/` |
| Suggestions (dont l'appel IA) | `app/src/input_suggestions.rs`, `app/src/ai/predict/generate_ai_input_suggestions.rs` |
| Cœur terminal | `crates/warp_terminal` |
| Éditeur de texte générique | `crates/editor/src/` (`selection.rs`, `multiline.rs`, `render/`) |

---

## 3. La trouvaille qui explique le padding

`app/src/settings/mod.rs` :

```rust
/// Terminal Spacing settings. BlockPadding and inline_separator_height values are
/// measured in grid cells, not pixels.
pub fn normal(line_height_ratio: f32, ctx: &AppContext) -> Self {
    block_padding: BlockPadding {
        padding_top:         1.1  * (DEFAULT_UI_LINE_HEIGHT_RATIO / line_height_ratio).min(1.0),
        command_padding_top: 0.19 * ...,
        middle:              0.5  * ...,
        bottom:              1.0  * ...,
    },
    prompt_to_editor_padding: 10.,
    editor_bottom_padding:    20.,
    overflow_offset:          12.,
    subshell_separator_height: 0.,   // caché en normal : montré dans le padding
}
pub fn compact(...) {
    block_padding: BlockPadding { padding_top: 0.3, command_padding_top: 0., middle: 0., bottom: 0.2 },
    prompt_to_editor_padding: 0., editor_bottom_padding: 4., overflow_offset: 6.,
    subshell_separator_height: 1.1,
}
```

**Les valeurs sont en cellules de grille, et fractionnaires.** C'est la preuve
directe que leur respiration n'est atteignable que parce qu'ils possèdent la
mise en page. Une grille xterm ne sait pas exprimer 0,19 de ligne.

**Échelle du retard** : Warp en `normal` a ~2,1 cellules d'air par bloc
(1,1 haut + 1,0 bas). Notre ligne vide unique donne 0,5 de part et d'autre du
trait — **un quart de leur respiration**. Deux lignes vides nous mettraient
dans le bon ordre de grandeur, et c'est un changement de réglage.

---

## 4. Faut-il notre propre renderer ? Non.

Question posée par Alexis le 2026-09-05, tranchée par la négative.

Le mot « renderer » cache le vrai coût : ce ne serait pas la partie qui
dessine, ce serait l'**émulateur**. Parseur VT (CSI, OSC, DCS, SGR, modes,
charsets), buffer + scrollback + **reflow au redimensionnement**, caractères
larges CJK, combinants, tables de largeur Unicode, écran alterné, régions de
défilement, protocoles souris, sélection, ligatures et alignement powerline,
images inline, recherche, liens, et les performances sous `cat` d'un gros
fichier. Alacritty, WezTerm et Ghostty ont pris des années chacun.

**Si on le faisait quand même**, la voie saine serait de ne pas écrire
l'émulateur : les crates **`alacritty_terminal`** ou **`wezterm-term` /
`termwiz`** exposent parseur + grille + scrollback sans UI, en Rust — c'est ce
que fait Zed. Mais le hic reste notre architecture : l'UI de CortX est un
WebView React, donc un cœur Rust devrait pousser sa grille jusqu'au webview où
il faudrait **repeindre nous-mêmes** (atlas de glyphes, ligatures, sélection,
images) — soit refaire la moitié rendu de xterm.js, justement celle qu'on ne
veut pas écrire.

**Forker Warp n'est pas une option** : 81 crates, 472 Mo, c'est un IDE
agentique complet (IA, LSP, notebooks, cloud, MCP, vim), pas un composant
terminal — et c'est AGPL.

### Ce qui reste possible sans renderer

1. **Une plaque de fond par bloc, dessinée *derrière* le texte.** Dans la
   fenêtre Terminal le canvas xterm est transparent (`allowTransparency`, fond
   `rgba(0,0,0,0)`) : une couche sous les canvas transparaît. C'est ce qui
   donne le rendu « carte » de Warp. Non fait. Ne marcherait pas dans le dock,
   dont le canvas est opaque.
2. **Deux lignes vides au lieu d'une** pour approcher leurs 2,1 cellules.
3. Lire leur source pour la spécification visuelle exacte (trait, survol,
   position de la barre d'actions) plutôt que de deviner sur captures.

---

## 5. Reprise du travail — état au 2026-09-05

Les 21 tickets du projet Zorg « CortX » sont traités, la version est bumpée en
**0.15.0**, **aucun tag n'est poussé** (pas de release). Deux passes de retours
d'Alexis ont été intégrées.

### Fait et vérifié

- **#7 blocs, visuel** : trait de 1 px achromatique par construction (blanc ou
  noir selon la luminance du fond, ~11 %), donc il ne peut plus emprunter la
  teinte d'un thème — c'était la cause du trait rose sur `aespa_wda`. Masque de
  survol supprimé. Barre d'actions qui ne se pose que sur une ligne dont la fin
  droite est mesurée vide (une cellule avec couleur de fond compte comme
  occupée : c'est la pastille d'horodatage d'oh-my-posh).
- **#15 curseur** : `pointer-events: none` sur le bloc de saisie empêchait de
  cliquer pour placer le caret. Couche de hit ajoutée, correspondance point →
  offset **mesurée**, jamais `x / cellWidth`.
- **#20/#4 groupes d'onglets** : refaits en carte imbriquée. Les couleurs ne
  dérivent plus de l'accent (sur `aespa_wda` l'accent est `#0c161f`, un
  quasi-noir : d'où les puces olive).
- **#7 padding** : ligne vide réelle émise par l'intégration shell avant
  l'invite, pour les quatre shells, réglage `terminal.blockSpacing`
  (`normal` par défaut). Garde-fous testés : jamais avant la première invite,
  jamais si le prompt ouvre déjà sur une ligne vide, `\r\n` et non `\n`.

### À faire ensuite

1. **Passer le padding à deux lignes** (voir §3) — ordre de grandeur de Warp.
2. **La plaque de fond par bloc** (voir §4.1) — c'est ce qui manque pour le
   rendu « carte ».
3. **Relire leur source** pour la spécification visuelle et le comportement de
   la zone de saisie, maintenant que c'est possible.
4. Jamais vérifié à l'œil : le résultat du `blockSpacing` avec le prompt
   oh-my-posh deux lignes d'Alexis.

### Rappels de tokens (piège coûteux, deux allers-retours)

Dans la fenêtre Terminal, sur un thème à fond d'écran :

- **Ne jamais dériver une couleur de l'accent** (`--tab-active-bg`,
  `--primary`) : un accent quasi-noir donne une tache sur une photo.
- **Ne jamais mélanger `--foreground` à un fort pourcentage** : blanc à 34 %
  sur un fond brun-rouge donne du rose vif.
- Ce qui tient : `--card` pour les surfaces, `--foreground` à *faible*
  pourcentage pour les bordures, ou blanc/noir pur choisi sur la luminance du
  fond pour ce qui ne doit prendre aucune teinte.
