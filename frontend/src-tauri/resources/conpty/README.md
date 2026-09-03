# Sideloaded ConPTY (Windows only)

`conpty.dll` + `OpenConsole.exe` from the Microsoft NuGet package
**Microsoft.Windows.Console.ConPTY 1.24.260710001** (x64), MIT licensed,
built from https://github.com/microsoft/terminal.

Why: the ConPTY built into Windows drops escape sequences it doesn't know
(Sixel DCS, iTerm2 OSC 1337 images, ...). The one shipped with Windows
Terminal 1.22+ passes them through. `portable-pty` prefers a `conpty.dll`
sitting next to the executable, and `conpty.dll` looks for `OpenConsole.exe`
next to itself, so both files are copied to the app directory by
`bundle.resources` in `tauri.conf.json` (dev builds get them in
`target/debug/` via tauri-build).

To upgrade: download the newer `.nupkg` from
https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY, unzip it,
and replace `runtimes/win-x64/native/conpty.dll` and
`build/native/runtimes/x64/OpenConsole.exe` here. Bump the version above.
