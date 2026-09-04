# Plan : Éditeur d'entrée universel — ticket #15

Statut : étude et plan, rien d'implémenté. Fait suite à la levée par Alexis, le 2026-09-04, de la
décision « pas de zone de saisie séparée façon Warp » prise dans `plans/terminal_mode.md` (DEV-13).

> « warp ne casse rien avec son prompt universel. c'est juste pour le prompt qu'on tape, une fois
> entré il part dessus et il ne doit pas y avoir de problème avec les TUI ou ce genre de chose (car
> si un TUI en full terminal se lance, alors forcément le prompt universel n'apparaît pas) »
>
> « ajoute moi un mode comme dans warp qui permet d'avoir la zone prompt forcée au bottom et pas à
> la suite des éléments »

| Phase | Contenu | État |
|-------|---------|------|
| **U0 — Position de l'entrée** | Réglage `inputPosition: flow \| bottom` ; la dernière ligne utile du grid est collée en bas du pane. Aucun éditeur, aucun changement du flux clavier. | À faire |
| **U1 — Éditeur, mono-ligne, avec échappatoire** | Éditeur DOM actif au prompt seulement ; l'éditeur possède le texte ; toute touche non gérée (Tab, Ctrl+R…) rend la main au shell pour la ligne en cours. | À faire |
| **U2 — Multi-ligne et confort** | Vraie édition multi-ligne, collage multi-ligne sans exécution accidentelle, historique ↑/↓ CortX, surlignage syntaxique léger, Ctrl+R palette. | À faire |
| **U3 — Complétions** | Moteur de complétion CortX (chemins, exécutables, alias, scripts, projets). C'est le ticket **#17**, pas celui-ci. | Ticket #17 |

U0 est livrable seul et immédiatement. U1 est livrable seul et sans régression possible (voir §3.a,
propriété « fail safe »). U2 dépend de U1. U3 dépend de U1 mais est un autre ticket.

---

## 1. Ce que fait Warp — vérifié sur cette machine

Warp 2026.08 est installé (`C:\Program Files\Warp`). Le binaire est compilé, mais **toute
l'intégration shell est en clair** : `pwsh.ps1` (70 Ko, signé, à la racine de l'installation) et,
embarqués en texte brut dans `warp.exe`, `bundled/bootstrap/{bash,zsh,fish}*.sh`,
`bundled/bootstrap/pwsh_init_shell.ps1`, ainsi que `resources/settings_schema.json` (schéma JSON
complet des réglages). Tout ce qui suit vient de la lecture de ces fichiers, sauf mention contraire.

### 1.1 Le protocole

| Séquence | Rôle |
|----------|------|
| `OSC 9278;d;<json hex>` | **Canal principal**. Un message JSON (hex-encodé pour qu'aucun octet du payload ne ressemble à ST/CAN/SUB/ESC) par « hook » : `InitShell`, `Bootstrapped`, `Preexec`, `CommandFinished`, `Precmd`, `InputBuffer`, `Clear`, `FinishUpdate`. C'est là que transitent le cwd, le code de sortie, la commande, les alias, les fonctions, les builtins, le histfile… |
| `OSC 133;A` / `133;B` / `133;P;k=r` | Bornes du prompt (début, fin, right-prompt). **Warp n'utilise pas `133;C` ni `133;D`** : le début et la fin de commande passent par les hooks JSON `Preexec` / `CommandFinished`. |
| `OSC 9277;A` / `9277;B` | Bornes de la sortie d'une « commande génératrice » exécutée hors bande. |
| `OSC 9279` | « reset grid » — dit au terminal de repartir d'une grille propre après une injection. |
| `OSC 9280;A/B/C/D/P` | Canal de complétion zsh (début/fin de génération, une entrée, sa description, signal de synchronisation). |
| `DCS $d …` | Variante des messages JSON hors Windows ; sur ConPTY, Warp bascule tout en OSC (`WARP_USING_WINDOWS_CON_PTY`). |

Variables d'environnement posées (extraites du binaire) : `WARP_SESSION_ID`, `WARP_BOOTSTRAPPED`,
`WARP_HONOR_PS1`, `WARP_USING_WINDOWS_CON_PTY`, `WARP_IS_SUBSHELL`, `WARP_IS_SSH`,
`WARP_INPUT_REPORTING_SUPPORTED`, `WARP_TMP_DIR`, `WARP_INITIAL_WORKING_DIR`, `WARP_PATH_APPEND`,
`WARP_SHELL_DEBUG_MODE`. Pas de `TERM_PROGRAM` dans cette liste.

### 1.2 Comment Warp sait qu'il est « au prompt »

Par les hooks, pas par l'écran :

- PowerShell : `Warp-Prompt` remplace `$function:global:prompt` et appelle `Warp-Precmd` (hook
  `CommandFinished` + `Precmd`), puis décore le prompt avec `133;A … 133;B`. Le **preexec** est
  obtenu en enveloppant `PSConsoleHostReadLine` : `$function:global:PSConsoleHostReadLine = { $line
  = & $old; Warp-Preexec "$line"; $line }`. Warp connaît donc la commande *au moment où la ligne est
  validée*, pas en parsant l'écran.
- zsh / bash / fish : `precmd_functions` / `preexec_functions`, `PROMPT_COMMAND` + `trap DEBUG`,
  `fish_preexec` / `fish_postexec`.

C'est exactement le même principe que `cortx init` aujourd'hui, en plus riche.

### 1.3 Warp désactive-t-il l'éditeur de ligne du shell ? **Non.**

C'est la question décisive, et la réponse est nette :

- `zsh_init_shell.sh` commence par ` unsetopt ZLE` et `bash` par ` stty raw` — **mais uniquement le
  temps du bootstrap** (le script est tapé dans le PTY, on ne veut ni écho ni édition). Le zsh_body
  fait ensuite `setopt ZLE` avec le commentaire : *« We need to restore the stty before any user
  bootstrap files are evaluated in case they ask for user input »*.
- `pwsh_init_shell.ps1` fait `Remove-Module -Name PSReadline` — là encore pour le bootstrap
  (« Prevent history from being written to file, among other interactive features ») ; `pwsh.ps1`
  réimporte PSReadLine de fait, en appelant `Set-PSReadLineKeyHandler`, `Get-PSReadLineOption`,
  `Set-PSReadLineOption -ExtraPromptLineCount`, et en enveloppant `PSConsoleHostReadLine`.
- Le commentaire le plus explicite est dans le bootstrap bash : ces bindings *« are only run in the
  context of the bash editor, **which isn't displayed in Warp** »*. Et dans `pwsh.ps1` :
  *« it doesn't matter what the value of this setting is because **Warp has its own input editor** »*
  (à propos de `PredictionSource`, que Warp force à `None`).

Autrement dit : **l'éditeur de ligne du shell reste vivant, mais son buffer reste vide et n'est
jamais affiché**, parce que Warp n'envoie rien au PTY tant qu'on tape. Au moment de valider, Warp
écrit le texte + un retour chariot dans le PTY ; le shell le lit avec son propre éditeur de ligne
(donc PSReadLine / ZLE font leur travail habituel : historique, expansion, hooks), l'écho apparaît
dans la grille, et Warp lit la commande directement dans la grille (il `unset PS1` en mode « Warp
prompt » précisément pour « pouvoir lire la commande dans la grille sans parser le prompt »).

### 1.4 Le cas du typeahead — le seul point de synchronisation

Si l'utilisateur tape avant que Warp ait repris la main (juste après la fin d'une commande), les
octets partent au PTY et atterrissent dans le buffer du shell. Warp le récupère par un **binding
dédié**, arbitrairement `ESC-i` dans tous les shells (`ESC-1` en PowerShell, parce que la
translation de code virtuel Windows casse `ESC-i` sur les claviers sans « i ») :

```zsh
function warp_report_input {
  warp_send_json_message "{ \"hook\": \"InputBuffer\", \"value\": { \"buffer\": \"$BUFFER\" … } }"
  BUFFER=""   # « prevents zsh from printing typeahead as background output after we've fetched it »
}
bindkey '\ei' warp_report_input
```

Version PowerShell : `Set-PSReadLineKeyHandler -Chord 'Alt+1'` → `GetBufferState` → hook
`InputBuffer` → `BackwardDeleteLine()` → `Write-Host "\e[2K"` (PowerShell n'efface pas correctement
tout seul, « due to cursor position mismatch »). Warp envoie donc `ESC-i` / `Alt+1` dans le PTY,
récupère le buffer, le colle dans son éditeur, et vide le buffer du shell. Les chaînes du binaire
confirment le pipeline côté terminal : `Received shell input buffer for typeahead`, `Matched PTY
output as typeahead`, `Initializing command grid from matched typeahead`, `Clearing accumulated
typeahead`.

**Conclusion : la seule chose que Warp synchronise dans le sens shell → éditeur, c'est le
typeahead.** Le reste du temps, l'éditeur est la seule source de vérité.

### 1.5 La complétion (Tab)

Deux mondes, et c'est important pour nous :

- **zsh** : Warp délègue au vrai moteur de complétion zsh, hors bande. Il installe deux widgets
  (`bindkey '^X' warp_complete_via_list_choices`, `bindkey '^Y'
  warp_complete_via_compadd_override`), envoie `^X`/`^Y` dans le PTY, puis pousse le texte à
  compléter par le tty (`IFS= read -d $'\4' -s` précédé d'un OSC `9280;P` de synchronisation), fait
  tourner `_generic` avec `COLUMNS=500`, et récupère les entrées via une **surcharge de `compadd`**
  (adaptée de `zsh-capture-completion`) qui les émet en `OSC 9280;C` / `9280;D?description`. Les
  redessins du line editor sont avalés dans un DCS pour ne pas polluer l'écran.
- **PowerShell** : **rien**. `pwsh.ps1` ne contient aucun widget de complétion, aucun `9280`, aucun
  appel à `TabExpansion2` / `CommandCompletion`. Sur Windows + pwsh, Warp n'a donc **pas** de
  complétion native du shell : il n'a que son propre moteur (specs embarquées, historique,
  système de fichiers) et ses « commandes génératrices » (`Warp-Run-GeneratorCommand`, exécutées
  dans un pool de runspaces séparés, résultats renvoyés en OSC 9277).

Le réglage `terminal.input.classic_completions_mode` existe dans le schéma (défaut `false`), ainsi
que `completions_open_while_typing` (défaut `false`) et `autosuggestions.enabled` (défaut `true`).

### 1.6 TUI et écran alterné

Non vérifiable dans les scripts shell (c'est purement côté terminal), mais le binaire est explicite :
`alt_screen.rs`, `alt_screen_element.rs`, `alt_screen_reporting.rs`, un champ `is_alt_screen_active`
sérialisé dans tous les snapshots envoyés à l'agent, et un réglage
`appearance.full_screen_apps.alt_screen_padding` (« Controls padding around full-screen terminal
applications »). Warp a donc un **mode de rendu dédié** quand l'application passe en écran alterné :
le pane devient une grille plein cadre et l'éditeur disparaît. Ce que dit Alexis est exact et c'est
bien le comportement du produit.

### 1.7 Quand une commande demande une saisie

Non vérifiable dans les fichiers lisibles. Ce que l'on sait de source sûre : Warp ne sait qu'une
commande est finie qu'au hook `CommandFinished`, donc entre `Preexec` et `CommandFinished`
l'éditeur ne peut pas être « au prompt ». Il existe un réglage
`notifications.preferences.is_password_prompt_enabled` (« Whether to notify when a password prompt
is detected »), donc Warp détecte les demandes de mot de passe pour notifier — ce qui n'a de sens
que si la frappe part alors directement au programme. **Connaissance générale (non vérifiée ici)** :
en mode classique, pendant qu'une commande tourne, les frappes de Warp vont directement au PTY dans
le bloc courant.

### 1.8 Le mode « prompt collé en bas » existe et est un réglage à part entière

`resources/settings_schema.json` :

```json
"InputMode": {
  "description": "Direction that blocks flow in the terminal viewport.",
  "oneOf": [
    { "const": "pinned_to_bottom", "description": "The most recent blocks are at the bottom of the screen and new blocks are added at the bottom as the blocklist grows" },
    { "const": "pinned_to_top",    "description": "The most recent blocks are at the top of the screen and new blocks are added at the top as the blocklist grows" },
    { "const": "waterfall",        "description": "The input starts at the top and gets pushed down by commands above it." }
  ]
}
```

Chemin : `appearance.input.input_mode`, **défaut `pinned_to_bottom`**. Et le style de l'entrée est
un autre réglage : `terminal.input.input_box_type_setting` ∈ `{ universal (« AI-first input »),
classic (« Terminal-first input ») }`, défaut `classic`.

À noter : la config locale d'Alexis (`%LOCALAPPDATA%\warp\Warp\config\settings.toml`) a
`input_mode = "waterfall"`, `input_box_type_setting = "classic"` et `honor_ps1 = true`. C'est-à-dire
exactement l'inverse de ce qu'il demande ici — ce qui plaide pour un **réglage**, pas un
changement de comportement par défaut.

### 1.9 Ce que je n'ai pas pu vérifier sur cette machine

- Le routage clavier exact pendant qu'une commande tourne (§1.7).
- Comment Warp décide d'afficher/masquer l'éditeur exactement (le code de l'éditeur est compilé).
- La stratégie de soumission d'une commande multi-ligne (bracketed paste ? continuation ?).
- S'il envoie `ESC-i` systématiquement à chaque prompt ou seulement quand il soupçonne du typeahead.

---

## 2. État des lieux dans CortX

### 2.1 Ce sur quoi on peut bâtir — c'est beaucoup

| Brique | Fichier | Ce qu'elle apporte |
|--------|---------|--------------------|
| Intégration shell OSC 7 / 133 | `frontend/crates/cortx-core/src/shell_init.rs` | Bloc gardé par `$env:CORTX_TERMINAL_ID`, livré en base64 une ligne pour PowerShell, verbatim pour bash/zsh/fish. Émet `133;A`, `133;B`, `133;C;cmd=<base64>`, `133;D;<exit>`, `OSC 7`. Réglage `shell_integration` + `disable_shell_predictions` (coupe `PredictionSource` de PSReadLine). |
| Parseur d'octets | `frontend/crates/cortx-core/src/terminal/osc.rs` | `OscScanner` (résiste au découpage entre chunks, saute les gros OSC), `TerminalStateTracker` → `TerminalShellState { phase: unknown/idle/running, cwd, command, startedAt, lastExitCode, … }`, événement `terminal-state`. |
| État côté front | `frontend/src/stores/appStore.ts` (`terminalStates`), `frontend/src/lib/tauri.ts` (`onTerminalState`, `getTerminalStates`) | La phase idle/running est déjà dans le store, par terminal. |
| **Suggestions fantômes** | `frontend/src/lib/terminalSuggest.ts` | **La maquette de tout ce dont on a besoin** : `term.parser.registerOscHandler(133, …)`, ancre `{ y: baseY + cursorY, x: cursorX }` posée sur `B`, lecture du texte tapé directement dans le buffer entre l'ancre et le curseur, désactivation sur `buffer.type === 'alternate'`, écriture dans le PTY via `api.writeTerminal`, décoration positionnée au curseur. |
| Clavier | `frontend/src/lib/terminalKeys.ts` + `attachCustomKeyEventHandler` dans `terminalSessions.ts` | Point d'entrée unique pour intercepter des touches avant xterm ; déjà utilisé pour Maj+Entrée → ESC+CR, Ctrl+C/V/Shift+C/V. |
| Session xterm | `frontend/src/lib/terminalSessions.ts` | Une instance par terminal, survit au démontage React ; `onData → write_terminal`, `neutraliseThemeBackground` sur le flux entrant, addons (search, image, serialize, clipboard). |
| Rendu d'un pane | `frontend/src/components/terminal/LeafPane.tsx` → `frontend/src/components/layout/XtermView.tsx` | `XtermView` est un simple `absolute inset-0` ; c'est là que se greffe une bande d'entrée ou un décalage vertical. `SplitTree.tsx` ne fait que la géométrie des splits. |
| Historique | `frontend/crates/cortx-core/src/terminal/history.rs`, `api.getCommandHistory` | `runtime/command-history.jsonl` (ts, terminalId, projectId, cwd, command, exitCode, durationMs), déjà alimenté par `133;D` et déjà lu par les suggestions fantômes. |

### 2.2 Ce que xterm.js 6.0.0 offre réellement (vérifié dans `frontend/node_modules/@xterm/xterm/typings/xterm.d.ts`)

- `term.buffer.active.type: 'normal' | 'alternate'`, `term.buffer.normal`, `term.buffer.alternate`,
  et **`term.buffer.onBufferChange: IEvent<IBuffer>`** — la bascule écran alterné est donc un
  événement, pas un sondage.
- `term.modes: IModes` — `bracketedPasteMode`, `mouseTrackingMode`, `applicationCursorKeysMode`,
  `applicationKeypadMode`, `synchronizedOutputMode`… Signaux utiles pour repérer une application
  qui prend le clavier **sans** passer en écran alterné.
- `term.element`, `term.textarea`, `term.blur()`, `term.focus()`.
- `cursorInactiveStyle: 'outline' | 'block' | 'bar' | 'underline' | 'none'` — permet de **cacher le
  curseur de la grille** quand notre éditeur a le focus.
- `registerMarker` / `registerDecoration` (déjà utilisés), `onWriteParsed`, `onCursorMove`,
  `onResize`, `buffer.baseY`, `buffer.cursorX/Y`, `getLine().translateToString`.

Rien ne manque pour ce plan.

### 2.3 Ce qui n'existe pas encore

- Aucune surface de saisie hors grille ; tout passe par `term.onData`.
- Aucun mécanisme pour récupérer le buffer du shell (l'équivalent du `ESC-i` de Warp).
- Aucun réglage de position d'entrée.

---

## 3. Décisions

### a. Contrat d'activation

**Validé, avec deux corrections.** La proposition de départ (intégration shell active ET entre
`133;B` et `133;C` ET buffer principal) est la bonne, mais :

1. **On ne sort pas de l'éditeur sur `133;C`, on en sort à la soumission.** `133;C` est émis par le
   shell *après* qu'il a lu la ligne ; attendre ce marqueur laisserait une fenêtre de quelques
   dizaines de millisecondes pendant laquelle un programme qui lit stdin tout de suite (`sudo`,
   `read -p`) verrait ses octets détournés vers l'éditeur. Et surtout, en PowerShell, `133;C` est
   émis par le handler `Enter` de PSReadLine : **s'il n'y a pas de PSReadLine, il n'y a pas de `C`
   du tout** et l'éditeur resterait affiché pendant toute la commande. On ne dépend donc pas de `C`
   pour fermer.
2. **`133;B` reçu alors que l'éditeur est déjà actif ne réinitialise pas le texte**, il ne fait que
   redéplacer l'ancre. Le prompt est redessiné plus souvent qu'on ne croit : `bash` porte
   `\e]133;B\a` dans `PS1` (donc à chaque redraw : Ctrl+L, resize), et PSReadLine réinvoque le
   prompt sur redimensionnement.

Machine à états, par pane :

```
                 133;B (normal buffer, intégration vue, réglage on, pas de hand-off en cours)
   ┌──────────┐ ───────────────────────────────────────────────────────────────► ┌──────────┐
   │ classic  │                                                                  │ editing  │
   │ (défaut) │ ◄───────────────────────────────────────────────────────────────  │          │
   └──────────┘   soumission · 133;A · hand-off · onBufferChange→alternate ·      └──────────┘
                  clic dans la grille · pane fermé · intégration perdue
```

Transitions, en détail :

| Événement | En `classic` | En `editing` |
|-----------|--------------|--------------|
| `133;A` | note « intégration vue » | quitte vers `classic` (le shell redessine un prompt : Ctrl+C, resize…). Le texte tapé est **conservé en brouillon** et restauré au `B` qui suit immédiatement. |
| `133;B` | entre en `editing` si toutes les conditions sont réunies ; ancre = `{baseY+cursorY, cursorX}` | ré-ancre seulement |
| `133;C` | rien (informatif) | ne devrait pas arriver ; par sécurité → `classic` |
| `133;D` | rien | → `classic` |
| Soumission (Entrée) | — | vide l'éditeur, écrit `texte + \r` dans le PTY, → `classic` **immédiatement** |
| `onBufferChange` → `alternate` | rien (déjà classic) | → `classic`, sans brouillon |
| `onBufferChange` → `normal` | rien : on attend le prochain `B` | — |
| Hand-off (Tab, Ctrl+R…) | — | écrit le texte courant dans le PTY sans `\r`, → `classic` jusqu'au prochain `B` |
| Clic dans la grille / sélection | rien | → `classic` (l'utilisateur veut la grille) ; retour au prochain `B` ou à la frappe suivante |

**Repli quand l'intégration shell est coupée** : `phase` reste `unknown`, aucun `B` n'arrive, on
reste en `classic` pour toujours. C'est la **propriété « fail safe »** de ce design : *l'éditeur
n'apparaît que si le shell l'a explicitement autorisé en émettant `133;B`.* Un `ssh`, un conteneur,
un `python`, un shell exotique, un profil cassé, une vieille version de `cortx init` → mode
classique d'aujourd'hui, à l'octet près. C'est ce qui rend U1 livrable sans risque de régression.

Cas particuliers utiles :

- **Shell imbriqué** (`bash` lancé depuis pwsh dans un terminal CortX) : `CORTX_TERMINAL_ID` est
  hérité, le shell interne émet ses propres `133;A/B` → l'éditeur revient au prompt interne. C'est
  le bon comportement, gratuitement.
- **REPL** (`python`, `node`) : aucun `133;B` → l'éditeur ne revient qu'à la sortie du REPL.
- **Écran alterné** : `vim`, `htop`, `less` → `buffer.type === 'alternate'` → éditeur masqué. Comme
  le dit Alexis, un TUI plein écran ne peut pas cohabiter avec le prompt universel, et il n'a pas à
  le faire.
- **Applications plein clavier sans écran alterné** (Claude Code / Ink, `fzf` en mode inline) : elles
  tournent *entre* `C` et `D`, donc l'éditeur est déjà fermé. Aucune condition supplémentaire n'est
  nécessaire — mais `term.modes.mouseTrackingMode !== 'none'` sert de garde-fou supplémentaire si un
  jour on voulait rouvrir l'éditeur pendant une commande (on ne le veut pas).

### b. Qui possède le texte — **l'éditeur possède**

**Recommandation : modèle « l'éditeur possède le texte ».** Rien ne part au PTY pendant la frappe ;
à la validation, on écrit `texte + \r`.

Pourquoi pas le modèle « le shell reste autoritatif » (miroir) :

- Il faudrait rejouer chaque édition en retours arrière + caractères. Or ce que le shell affiche
  n'est pas une fonction pure du texte : PSReadLine colore, replie, ouvre un menu de complétion,
  affiche une prédiction, gère la continuation multi-ligne. Le moindre désaccord se voit
  immédiatement et se répare mal.
- Chaque frappe ferait un aller-retour par le PTY : latence et scintillement sur une opération où
  l'utilisateur est le plus sensible.
- Le multi-ligne devient bancal (c'est le shell qui décide de la continuation).
- Et surtout : **l'éditeur ne serait qu'un mensonge visuel**, puisque le vrai curseur resterait dans
  la grille. On paierait toute la complexité sans obtenir ce que le ticket demande.
- Le seul gain réel (Tab et Ctrl+R natifs) est récupérable autrement — voir ci-dessous.

Ce que coûte le modèle retenu, honnêtement :

| Perte | Coût réel | Ce qu'on fait |
|-------|-----------|---------------|
| **Complétion Tab de PSReadLine** | Réelle. Aucune ruse ne permet de la joindre pendant que le shell est bloqué en lecture : Warp lui-même n'a **rien** pour pwsh (§1.5). Le contournement zsh de Warp (widgets + surcharge `compadd`) n'a pas d'équivalent PowerShell. | **U1 : hand-off.** Tab écrit le texte courant dans le PTY (sans `\r`), masque l'éditeur, puis laisse passer la touche. PSReadLine complète exactement comme aujourd'hui, sur la ligne complète. La ligne se termine en mode classique ; l'éditeur revient au prompt suivant. Une seule touche, comportement déterministe, zéro moteur à écrire. **U3/#17 :** complétion CortX (chemins, exécutables du PATH, alias `cortx init`, scripts et projets — CortX a déjà toutes ces données côté Rust). |
| **Ctrl+R de PSReadLine / zsh** | Réelle mais déjà planifiée ailleurs : `terminal_mode.md` P4 prévoit « palette Ctrl+R historique + alias + scripts ». | Hand-off en U1 ; palette CortX en U2. |
| **Historique ↑/↓ du shell** | L'éditeur remonte l'historique CortX (`command-history.jsonl`), pas celui du shell. Les deux divergent (l'historique CortX est global, multi-shell, avec cwd et code de sortie — souvent meilleur, parfois différent). | ↑/↓ = historique CortX en U2 ; hand-off disponible pour retomber sur celui du shell. |
| **Expansion d'alias / de globs à la frappe** | Aucune. Le shell reçoit la ligne entière et fait tout son travail habituel. | — |
| **Hooks du shell (`133;C`, preexec, ajout à l'historique du shell)** | Aucune. On envoie un vrai `\r` dans l'éditeur de ligne du shell : le handler `Enter` de PSReadLine (celui que `shell_init.rs` installe pour émettre `133;C;cmd=…`) se déclenche normalement. | — |

**La règle générale qui rend tout ça tenable** : *toute touche que l'éditeur ne sait pas honorer
déclenche un hand-off.* L'éditeur n'est jamais un cul-de-sac — il est une surface de frappe
optionnelle qui rend la main dès qu'elle ne suffit plus. C'est ce qui permet de livrer U1 sans
avoir écrit une seule ligne de moteur de complétion.

**Typeahead.** Il reste un cas où le shell détient du texte : les caractères tapés entre la fin
d'une commande et l'arrivée de `133;B`. Warp le résout par un binding dédié (§1.4). CortX peut
faire plus simple et sans toucher aux scripts d'intégration : à l'arrivée de `B`, on lit dans la
grille le texte entre l'ancre et le curseur (`terminalSuggest.currentInput()` fait déjà exactement
ça), et si ce texte n'est pas vide on l'**adopte** dans l'éditeur puis on envoie autant de
`\b`/`\x7f` que de caractères pour vider le buffer du shell. Si ça s'avère fragile (largeur
d'affichage ≠ nombre de caractères pour l'unicode large), on ajoutera un binding
`__cortx_report_input` calqué sur Warp dans `shell_init.rs`. **Décision : commencer par la lecture
de grille (aucun changement d'intégration), garder le binding en réserve.**

### c. Les touches qui doivent traverser

En `classic`, rien ne change : tout va au PTY, comme aujourd'hui. En `editing` :

| Touche | Décision | Raison |
|--------|----------|--------|
| **Ctrl+C** | **Toujours transmise au PTY**, et l'éditeur se vide. | C'est la touche panique ; elle ne doit jamais être avalée, jamais dépendre d'un état interne. Le shell affiche `^C` et redessine un prompt (`A` puis `B`), ce qui resynchronise tout. |
| **Ctrl+D** | Transmise **seulement si l'éditeur est vide**. Sinon : suppression avant (comportement emacs). | Le buffer du shell est vide en permanence : un Ctrl+D transmis avec du texte dans notre éditeur **tuerait le shell** alors que l'utilisateur croit supprimer un caractère. Piège majeur, à ne pas rater. |
| **Ctrl+Z** | Toujours transmise. | Suspension. Inoffensive au prompt, indispensable ailleurs. |
| **Ctrl+R** | Hand-off + transmise (U1). Palette d'historique CortX (U2, réglable). | §b. |
| **Ctrl+L** | Transmise ; l'éditeur **conserve** son texte. | Le shell efface l'écran et redessine un prompt vide (son buffer est vide) ; notre texte est à nous, il n'a pas à disparaître. Nécessite de rejouer l'ancre au `B` suivant. |
| **Tab / Maj+Tab** | Hand-off + transmise (U1). Complétion CortX (U3 / #17). | §b. |
| **Ctrl+Espace, Ctrl+@, F7, toute touche non liée** | Hand-off + transmise. | Filet de sécurité générique. |
| **Entrée** | Soumission (voir §b). | |
| **Maj+Entrée** | Nouvelle ligne **dans l'éditeur** (U2). En U1 : hand-off + ESC+CR comme aujourd'hui. | Gain net : plus besoin de la ruse ESC+CR quand l'éditeur est actif. La ruse reste indispensable en mode classique (Claude Code) — `terminalKeys.ts` ne bouge pas. |
| **Échap** | Vide le brouillon si l'éditeur a du texte, sinon hand-off + transmise. | |
| **↑ / ↓** | Historique CortX (U2). En U1 : hand-off + transmises. | |
| **Ctrl+A/E/U/K/W, Alt+←/→, Home/End** | Traitées par l'éditeur (bindings emacs, cohérents avec le profil d'Alexis : `Set-PSReadLineOption -EditMode Emacs`). | |
| **Ctrl+V / Ctrl+Maj+V** | Collage dans l'éditeur. | Gain de sûreté : un collage multi-ligne n'exécute plus rien par accident. |

### d. Le mode « prompt collé en bas »

**C'est un livrable à part entière, indépendant de l'éditeur, et il peut sortir en premier (U0).**

Le problème est purement visuel : xterm rend une grille de `rows` lignes qui se remplit par le haut.
Tant que le scrollback est vide (`buffer.baseY === 0`), la dernière ligne utile est en haut du pane
et il y a du vide en dessous. Dès que le scrollback a démarré, le comportement est déjà « collé en
bas » naturellement.

**Technique retenue : décalage vertical de l'hôte xterm, sans toucher au PTY.**

- Le pane devient `position: relative; overflow: hidden`.
- L'hôte xterm garde exactement la taille que `FitAddon` lui donne (donc `rows`/`cols` inchangés :
  **le shell et les programmes ne voient aucune différence**).
- On lui applique `transform: translateY(offset)` avec
  `offset = clamp(0, (rows - 1 - cursorY) * cellHeight)` quand `buffer.baseY === 0` et
  `buffer.type === 'normal'`, et `offset = 0` sinon.
- Les lignes vides qui débordent en bas sont clippées par le conteneur. Rien ne déborde en haut.
- `cellHeight` se mesure sur `term.element.querySelector('.xterm-screen').clientHeight / term.rows`.
- Recalcul sur `onCursorMove`, `onWriteParsed`, `onResize`, et sur les marqueurs `133;A/B/D`.

Pourquoi pas les alternatives :

- *Écrire des `\n` de remplissage* : polluerait le scrollback, et surtout sur Windows **ConPTY tient
  son propre modèle d'écran et repeint** — des lignes injectées côté xterm seulement produiraient
  des artefacts au prochain repaint. Rejeté.
- *Réduire `rows`* : redimensionnerait le PTY à chaque prompt (churn, reflow, TUI qui croient avoir
  un petit écran). Rejeté.

Cohabitation avec le mode « à la suite du flux » : un simple réglage
`terminal.inputPosition: 'flow' | 'bottom'` (défaut `flow`, l'existant). En `flow`, `offset` vaut
toujours 0 et le code est inerte.

Quand la sortie dépasse la hauteur : `baseY > 0` → `offset = 0` → comportement d'aujourd'hui, la
dernière ligne est déjà en bas. Quand l'utilisateur remonte dans le scrollback : idem. En écran
alterné : `offset = 0` obligatoire, un TUI doit avoir tout le pane.

**Pendant qu'une commande tourne** (donc, en U1+, éditeur masqué) : la zone d'entrée **garde sa
hauteur réservée**. C'est une décision importante — faire disparaître une bande de 2 ou 3 lignes
changerait la hauteur du pane, donc `rows`, donc un `resize` du PTY et un reflow à chaque commande.
Inacceptable. La bande reste, en état passif : fine, atténuée, avec l'indication que la frappe part
au programme en cours (et, plus tard, le nom de la commande + son chronomètre). Elle redevient
éditable au prochain prompt.

Ce que ça donne visuellement en U1+ :

- `bottom` : bande d'entrée collée en bas du pane, sortie au-dessus, collée elle aussi au bas grâce
  à U0. C'est le rendu Warp.
- `flow` : l'éditeur est dessiné **en surimpression à l'ancre du prompt** (même technique que la
  décoration fantôme actuelle), donc on tape visuellement « sur le prompt », à la suite du flux.

### e. Réglages

`TerminalConfig`, côté Rust (`frontend/crates/cortx-core/src/models.rs`) et TS
(`frontend/src/types/index.ts`), plus l'UI dans
`frontend/src/components/terminal/settings/TerminalAppearanceSection.tsx` (position) et
`IntegratedTerminalSection.tsx` (éditeur) :

| Clé (TS / Rust) | Type | Défaut | Phase |
|-----------------|------|--------|-------|
| `inputPosition` / `input_position` | `'flow' \| 'bottom'` | `flow` | U0 |
| `inputEditor` / `input_editor` | `bool` | `false` (bêta) | U1 |
| `inputEditorHandoff` / `input_editor_handoff` | `bool` | `true` | U1 |
| `inputEditorHistory` / `input_editor_history` | `bool` | `true` | U2 |
| `inputEditorMultiline` / `input_editor_multiline` | `bool` | `true` | U2 |

`inputEditor` implique `disable_shell_predictions` (déjà présent) : deux suggestions à l'écran, ça
n'a pas de sens. Idem, quand l'éditeur est actif, `terminalSuggest` doit dessiner son fantôme
**dans l'éditeur**, pas dans la grille — les deux ne cohabitent pas.

---

## 4. Phases et fichiers

### U0 — Position de l'entrée (livrable seul, aucun impact clavier)

Nouveau : `frontend/src/lib/terminalAnchor.ts` (calcul et application de l'offset, un abonnement par
session).

Touchés :
- `frontend/src/lib/terminalSessions.ts` — exposer `cellHeight()`, brancher l'abonnement à la
  création de session, recalculer sur `onResize`.
- `frontend/src/components/layout/XtermView.tsx` — conteneur `relative overflow-hidden`, applique
  `translateY`.
- `frontend/src/types/index.ts`, `frontend/crates/cortx-core/src/models.rs` — `inputPosition`.
- `frontend/src/components/terminal/settings/TerminalAppearanceSection.tsx` — le réglage.

Vérification U0 : `flow` → pixel pour pixel identique à aujourd'hui (le code doit être inerte).
`bottom` → nouveau shell, le prompt est en bas ; on tape 3 commandes, le bloc se colle en bas ; on
dépasse la hauteur, le comportement redevient normal ; `vim` occupe tout le pane ; `htop` idem ;
resize de la fenêtre ; scroll dans le scrollback ; split en 4 panes ; image Sixel affichée ; barre
de recherche ouverte ; sélection à la souris et copie ; clic sur un lien.

### U1 — Éditeur mono-ligne avec hand-off (livrable seul)

Nouveau :
- `frontend/src/lib/terminalInput.ts` — machine à états §3.a, une instance par terminal ; s'abonne
  à `registerOscHandler(133)`, `buffer.onBufferChange`, `onResize` ; expose `state`, `text`,
  `submit()`, `handoff(key)`, `adoptTypeahead()`.
- `frontend/src/components/terminal/InputEditor.tsx` — la surface de saisie (un `textarea` masqué +
  rendu, ou un `contenteditable`), en surimpression à l'ancre (`flow`) ou en bande (`bottom`).
- `frontend/src/styles/terminal-input.css`.

Touchés :
- `frontend/src/components/layout/XtermView.tsx` — monte `InputEditor` par-dessus la grille.
- `frontend/src/components/terminal/LeafPane.tsx` — réserve la hauteur de la bande en mode `bottom`.
- `frontend/src/lib/terminalSessions.ts` — `cursorInactiveStyle: 'none'` quand l'éditeur a le focus ;
  `attachCustomKeyEventHandler` délègue à `terminalInput` avant tout le reste.
- `frontend/src/lib/terminalKeys.ts` — table des touches §3.c.
- `frontend/src/lib/terminalSuggest.ts` — le fantôme se dessine dans l'éditeur quand il est actif.
- Types + `models.rs` + section Réglages.

Aucun changement Rust fonctionnel n'est nécessaire en U1 : l'intégration shell émet déjà tout ce
qu'il faut. (Un seul point à surveiller : `shell_init.rs` doit continuer d'installer le handler
`Enter` de PSReadLine — c'est lui qui émet `133;C;cmd=`.)

### U2 — Multi-ligne, historique, collage

- Soumission multi-ligne : si `term.modes.bracketedPasteMode` est vrai, envoyer
  `ESC[200~ … ESC[201~` puis `\r` ; sinon, envoyer ligne par ligne avec ESC+CR (ce que
  `terminalKeys.ts` sait déjà faire) ; sinon refuser et proposer de joindre. **Ne pas deviner** :
  le mode est lisible, on s'en sert.
- ↑/↓ sur `command-history.jsonl` filtré par cwd/projet, Ctrl+R ouvre `TerminalPalette.tsx`.
- Surlignage syntaxique léger (commande / arguments / chemins / chaînes), à partir de rien de plus
  que ce que CortX connaît déjà (alias, scripts, projets).

### U3 — Complétions → **ticket #17**, hors de ce plan.

---

## 5. Vérification — scénarios obligatoires

À passer intégralement à la fin de U1, puis de U2. Chacun en `flow` **et** en `bottom`, en mode
sombre et clair, dans le dock **et** dans la fenêtre Terminal.

| Scénario | Attendu |
|----------|---------|
| `claude` (Claude Code) | À l'invocation : éditeur masqué dès la validation. Toute la session Claude Code se comporte comme aujourd'hui : Maj+Entrée insère une ligne (ESC+CR), Ctrl+C interrompt, le collage marche. Éditeur de retour au prompt shell à la sortie. |
| `vim` puis `:q` | Écran alterné → éditeur masqué instantanément, pane plein cadre, `offset = 0`. Retour au prompt → éditeur de retour. |
| `htop` puis `q` | Idem, plus la souris et les touches de fonction. |
| `python` puis `exit()` | Le REPL n'émet pas de `133;B` : éditeur masqué pendant toute la session, frappe directe. |
| `ssh <hôte>` | Aucun `CORTX_TERMINAL_ID` distant → aucun marqueur → mode classique pendant toute la session distante. |
| `sudo <cmd>` (mot de passe) | La saisie du mot de passe part au PTY, aucun caractère n'apparaît dans l'éditeur, aucun écho. |
| `git commit` sans `-m` | Ouvre l'éditeur configuré (vim/nano) → écran alterné → masqué. Le message est bien pris en compte. |
| `read -p "nom: " x` (bash) / `Read-Host` (pwsh) | La saisie part au programme. |
| `cat \| grep foo` puis frappe puis Ctrl+D | Le texte va au pipe ; Ctrl+D ferme stdin (et **ne tue pas le shell**). |
| Ctrl+D avec du texte dans l'éditeur | **Ne quitte pas le shell.** Supprime un caractère. |
| Ctrl+C pendant une commande longue | Interrompt. Prompt redessiné, éditeur de retour, vide. |
| Ctrl+C avec du texte dans l'éditeur, au prompt | `^C` affiché, éditeur vidé, nouveau prompt, aucune commande exécutée. |
| Ctrl+L au prompt avec du texte en cours | Écran effacé, prompt redessiné, **le texte est toujours là**. |
| Tab au milieu d'un chemin | Hand-off : PSReadLine complète exactement comme aujourd'hui ; la ligne se termine en classique. |
| Ctrl+R | Hand-off (U1) / palette (U2). |
| Collage multi-ligne (3 lignes) | U1 : la première ligne seulement, le reste refusé avec un message — **jamais d'exécution accidentelle**. U2 : les 3 lignes dans l'éditeur, exécutées à la validation. |
| Typeahead : taper pendant qu'une commande finit | Les caractères se retrouvent dans l'éditeur, **une seule fois**, dans le bon ordre, et le buffer du shell est vide (Entrée n'exécute pas la commande deux fois). |
| Accents, AltGr, ` ^ ¨ (clavier FR), IME | Corrects dans l'éditeur (c'est même un gain : un `textarea` gère les touches mortes mieux que xterm). |
| `cortx init` désactivé / `shellIntegration: false` | Mode classique intégral, aucune trace de l'éditeur. |
| Windows PowerShell 5.1 (PSReadLine 2.0) | Pas de crash ; si le handler `Enter` n'est pas posé, aucun `133;C` → l'éditeur ferme quand même à la soumission. |
| `bash` lancé depuis pwsh dans le même terminal | L'éditeur revient au prompt bash interne. |
| 4 panes splittés, chacun à un prompt | 4 éditeurs indépendants ; le focus suit le pane actif ; aucun `resize` du PTY au changement d'état. |
| Restauration de session + rejeu de scrollback | Aucun éditeur pendant le rejeu (`session.replaying`), retour au premier vrai `B`. |
| Changement de surface (détacher vers la fenêtre) | L'éditeur se reconstruit ; le brouillon éventuel n'est pas exigé. |

Côté Rust : rien de nouveau à tester en U1. Côté front : `tsc`, `bun run build`, lint, et captures
CDP (`WEBVIEW2_USER_DATA_FOLDER` dédié, port 9223) des deux modes de position.

---

## 6. Risques et points où ça peut mal tourner

1. **Le typeahead est le vrai point dur.** Warp a dû ajouter un binding shell dédié dans les quatre
   shells pour le résoudre proprement. Notre lecture de grille est plus simple mais approximative :
   caractères de largeur double, prompt qui se termine en milieu de ligne, ligne repliée. Si le
   test « taper pendant qu'une commande finit » échoue de façon répétable, il faut basculer sur le
   binding (`__cortx_report_input` dans `shell_init.rs`, un OSC `133;` ou un OSC privé), ce qui
   ajoute une modification de l'intégration shell dans tous les shells. **À budgéter comme un
   risque de U1, pas comme un acquis.**
2. **`133;B` en PowerShell arrive par le prompt, `133;C` par PSReadLine.** Deux chemins différents,
   deux façons de tomber en panne. Le design ne dépend de `C` que pour l'historique et le nom de la
   commande (déjà le cas aujourd'hui), pas pour la sûreté.
3. **ConPTY repeint.** Toute manipulation de la grille par le front (U0) doit se limiter à du CSS.
   Aucune écriture locale dans xterm qui ne vienne pas du PTY. C'est la règle absolue sur Windows.
4. **Le décalage vertical (U0) peut « sauter »** pendant qu'une commande produit de la sortie
   (l'offset se réduit ligne par ligne). À vérifier à l'œil ; si c'est désagréable, figer l'offset
   pendant `phase === 'running'` et ne le recalculer qu'aux marqueurs de prompt.
5. **Le focus.** Deux cibles clavier par pane (grille et éditeur). Règle : quand l'éditeur est actif
   il a le focus, `cursorInactiveStyle: 'none'` cache le curseur de la grille, et une sélection
   souris rend le focus à l'éditeur au relâchement. Sinon on obtient des frappes perdues, le pire
   des bugs possibles ici.
6. **Le dock est bas.** Une bande d'entrée réservée coûte 2–3 lignes sur un dock qui en fait 12. Le
   mode `bottom` doit rester réglable par surface, ou au minimum être documenté comme fait pour la
   fenêtre Terminal.
7. **Multi-ligne : pas de solution universelle.** Le bracketed paste de PSReadLine n'est pas garanti
   partout, la continuation dépend du shell. D'où le choix de ne livrer le multi-ligne qu'en U2,
   avec détection explicite via `term.modes.bracketedPasteMode`, et un refus propre en dernier
   recours.
8. **La complétion est le point où ce ticket ne peut pas gagner.** Il faut le dire clairement :
   dans l'éditeur, on n'aura jamais la complétion des paramètres de cmdlets de PSReadLine. Warp non
   plus sur Windows. Le hand-off est un contournement honnête, pas une parité. Si Alexis juge le
   hand-off trop cassant à l'usage, l'alternative est d'accepter que l'éditeur ne serve qu'aux
   lignes qu'on tape d'un jet et de garder Tab comme sortie systématique — ce qui reste utile, mais
   il faut le savoir avant de construire U2.
9. **Deux systèmes de suggestion.** `terminalSuggest.ts` dessine aujourd'hui dans la grille. En U1
   il doit se déplacer dans l'éditeur, sinon on aura deux fantômes ou un fantôme au mauvais endroit.
   Ce n'est pas optionnel.
10. **Trois autres agents travaillent sur ce dépôt en parallèle.** `terminalSessions.ts`,
    `terminalKeys.ts` et `XtermView.tsx` sont des fichiers chauds ; prévoir un rebase avant de
    commencer U1.

---

## 7. Hors périmètre

- Toute forme d'IA dans l'entrée (le `universal` de Warp est explicitement « AI-first input » ; ici
  « universel » veut seulement dire « une zone de saisie à nous »).
- Le moteur de complétion (ticket **#17**).
- Le rendu en blocs DOM à la Warp (la sortie reste une grille xterm ; les blocs restent des
  décorations, cf. `terminal_mode.md` P4).
- `pinned_to_top` (le troisième mode de Warp) : personne ne l'a demandé.
- Toute modification des scripts d'intégration shell, **sauf** si le risque n°1 se matérialise.
