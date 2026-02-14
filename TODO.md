# TODO

Don't forget to update PRD when adding features

- [ ] New version of CortX - with CortX CLI : 
  - [ ] For the moment cortex is mainly about projects and their services and also supports scripts for those projects but it doesn't support scripts only (not big project, here we just want a simple script, like for example a function to extract background of image, etc... (see the myhelp tool I've made for my powershell -> this would just be an improved version of it))
  - [ ] To do that we will maybe need to have a "scripts" folder (and ability to set it's location) -> so it's just easier to have all scripts at the same place and also make a git to store them all at the same place (but separated from this cortx project). for example it could be the place where I store my powershell scripts and we could easily reuse them here in cortx. also we could also include other scripts that are located in different places.
  - [ ] second objective is to have CortX available as CLI (for scripts in the first place, and maybe later for projects and services). so it's just easier to run whatever script in cli (use RATATUI for this). This GUI should be great looking, easy to use, super simple when we just want to execute things, but could go with much more things and complexity when we want to configure things (we could go as deep as possible but when we just want to do simple things the tui shouldn't have this complexity).
  - [ ] We could do the same things in the GUI as in the TUI (TUI now is only for scripts)
  - [ ] We have to integrate the scripts things in the app (I already said we have scripts relative to projects, but here this is not the goal of this part, we want to make scripts made by the user on his computer that are not specific to any project but rather global helpers easily accessible within CortX). So now basically in cortX we should have the 'projects/services' part and then another section 'scripts'. -> find a nice way to organize this on the GUI so it doesn't change anything of the UI for the projects, but just add this scripts things. (my idea here is just to look how the project specific scripts are working and basically do the same for global script but with different behaviors and organisation just so we know their are global scripts).
  - [ ] The goal would be to have script being configured with different option (for example we could configure which -- parameters are usable and the value we want for them). Also we could have a feature that based on the --help automatically generates those config (should have a standard format to respect to make it possible -> to discuss). else it should be easily configurable and usable so we can easily change parameters, and so.
  - [ ] The Tui and Gui should have everything shared (basically it's just the interface that changes and the way they interact with data/config, etc...)
  - [ ] Since there are more and more projects I add in CortX (and I suppose it's going to be the same with scripts), we should also have a way to sort them (I think adding folders could be a nice way to do this and we could add them in different folders so it's easier to find them).
  - [ ] Basically I want this to become the replacer of my powershell script config. (though this will not replace my powershell config with oh-my-posh, styling, helpers, tools -> it's only a replacer for the scripts part)
  -> talk and plan all that with claude.

---

- [ ] Make sure it's written CortX not Cortx in the app (top bar, app name, etc...)
- [ ] When opening in VSCode make sure it's doesn't open a terminal that execute the code command (this terminal should be hidden or use another method to directly open VSCode without opening a terminal)
- [ ] Find if there is a better way to handle the port used detection (instead of parsing output, maybe use some library or other way to detect which ports are used by which process)
- [ ] Adding message on close saying "closing running services" while it's closing them with a loading indicator
- [ ] Adjust the areas position for dropping a terminal in current pane / left / right (I feel like it's not really 25 % / 50 % / 25 % of the pane width right now, because there are some gaps)

## Done

- [X] Improve terminal scrolling experience (e.g. auto scroll to bottom on new output, go back to bottom button, scrollbar, etc...)
- [X] Clickable links in terminal output
- [X] Close all terminals button
- [X] When closing a running service terminal with the 'x' button this should hide the terminal instead of stopping the service. (thus we have to find a way to reopen a running service terminal, maybe in a running services section). (+ we could be able to reopen stopped services terminals as well)
- [X] In the services section we could add the stop all / start all buttons for a project
- [X] warning : click on link should always be external (do not open in the app) (for now ctrl click is ok, but normal click should also be external)
- [X] bottom terminal section should allow content above to be scrollable further (e.g. for now terminal could be hidding some content above it and it's not possible to scroll up enough to see that content). + Terminal section should be resizable (drag to resize)
  - [X] Done for the main content but should also be done for the sidebar (scrollable when content is out of view)
- [X] Running port indication (on terminal running the service (should automatically detect the port of the running service))
- [X] Add a open in VSCode (or other editor) option for projects
- [X] Fix scrollbar constently appearing issue
- [X] Custom menu bar (with reduce / maximize / close buttons) to have a better integration with the app design (+ make sure it's draggable from anywhere on the top bar)
- [X] Find a better name for the app (+ rename repo -> do this before making it public and before making the updates system)
- [X] Generate a logo for the project (first write readme and give it to gemini to generate a logo)
- [X] Make the app updatable (check tauri docs for that) -> must be public repo, so please make sure its safe in term of security before pushing + readme is ready for public. Windows only for now is fine.
- [X] Fix updater : [2025-12-16][08:05:53][tauri_plugin_updater::updater][ERROR] update endpoint did not respond with a successful status code
- [X] Check that on quit app all terminals are properly killed...

- [X] Set app version properly everywhere (at the same time using the same version variable) + fix in the topbar the app version is fixed to 0.1.0
- [X] Add a .env locator -> the goal is to easily find .env files in a project and get their variables
- [X] In addition of services, add scripts support (that could be linked to services or standalone) e.g. a build script that is linked to the frontend service. a build script that is linked to multiple services (frontend and backend). A 'cleaning backup' script which is standalone, a deploy script (linked to frontend or not...), etc... (in this i call script any file in the codebase of the project and that is executable (e.g. .sh, .ps1, .py, .js, etc...), the user should be able to define a script by giving it a name, an optional description, the command to run it, the path to the script file (relative to the project root), and the linked services (optional, could be multiple or none))
- [X] Add a see .env file content (full content at once that can be copied or exported)
- [X] When multiple terminal are open, there is a bug when we click to switch between them, fix this (some terminals won't switch properly)
- [X] remove the trailing './' for the path display of a service (between root project and service path) e.g. Path: C:/Users/alxsm/Desktop/Programmes/Perso/My-Journal/./frontend
- [X] Running some services crash the app (e.g. investigate with the particle simulator rust service)
- [X] Fix the console errors (devtools), even if they don't seem to impact the app, they are still present and should be fixed
- [X] sidebar should be resizable (when opened, and remember size for next time)
- [X] Add modes for the services (e.g. dev, prod, test, etc...) we can have modes for each service and the possibility to run all services / individual services in a specific mode. mode is optional (eg if there is only a single mode defined). for each mode we can define a different command to run the service with that mode. When running the terminal should indicate the mode used (if any)
  - [X] Feedback : the default command could be set to a certain mode (e.g. instead of having the define the default command + the dev mode command, we could just define the dev mode command and set it as default, but we could also have a default command that is not linked to any mode)
  - [X] Feedback : should be able to run all project services using a specific mode (e.g. run all services in dev mode).
- [X] Add extra command line arguments support (e.g. for variables, env variables, etc...)
- [X] Multiple terminal panes support (each pane can have multiple terminal tabs)
- [X] Fix the terminal scroll (there is no scroll anymore)
  - [X] Fix the scroll to bottom default behavior (again -> multiple panes might have messed this up)