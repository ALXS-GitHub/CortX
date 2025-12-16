# TODO

Don't forget to update PRD when adding features

- [ ] Add modes for the services (e.g. dev, prod, test, etc...) we can have modes for each service and the possibility to run all services / individual services in a specific mode
- [ ] split terminal view to have multiple terminals visible at the same time (only horizontal split for now is fine)
- [ ] sidebar should be resizable (when opened, and remember size for next time)

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