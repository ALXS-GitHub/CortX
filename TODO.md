# TODO

Don't forget to update PRD when adding features

- [ ] Generate a logo for the project
- [ ] warning : click on link should always be external (do not open in the app) (for now ctrl click is ok, but normal click should also be external)
- [X] Improve terminal scrolling experience (e.g. auto scroll to bottom on new output, go back to bottom button, scrollbar, etc...)
- [X] Clickable links in terminal output
- [X] Close all terminals button
- [X] When closing a running service terminal with the 'x' button this should hide the terminal instead of stopping the service. (thus we have to find a way to reopen a running service terminal, maybe in a running services section). (+ we could be able to reopen stopped services terminals as well)
- [ ] bottom terminal section should allow content above to be scrollable further (e.g. for now terminal could be hidding some content above it and it's not possible to scroll up enough to see that content)
- [ ] Add a open in VSCode (or other editor) option for projects
- [ ] Add a .env locator -> the goal is to easily find .env files in a project and get their variables
- [ ] Running port indication (on terminal running the service (should automatically detect the port of the running service))
- [ ] In addition of services, add scripts support (that could be linked to services or standalone) e.g. a build script that is linked to the frontend service. a build script that is linked to multiple services (frontend and backend). A clean backup script which is standalone, a deploy script (linked to frontend or not...), etc...
- [ ] Add modes for the services (e.g. dev, prod, test, etc...) we can have modes for each service and the possibility to run all services / individual services in a specific mode
- [ ] Make the app updatable (check tauri docs for that) -> must be public repo, so please make sure its safe in term of security before pushing + readme is ready for public. Windows only for now is fine.
- [ ] The color dot of the service should be the same of the dashboard card for those shown services (for now they are all grey)