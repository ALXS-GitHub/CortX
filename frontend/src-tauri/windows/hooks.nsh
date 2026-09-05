; CortX NSIS Installer Hooks
; Adds / removes the cortx CLI directory in the user's PATH.
;
; The PATH is *never* read or written from NSIS here, and that is deliberate.
; NSIS is compiled with NSIS_MAX_STRLEN = 1024: `ReadRegStr` returns an empty
; string when the registry value is longer than that, and the previous version
; of this file took the resulting "PATH is empty" branch and wrote $INSTDIR on
; its own — destroying every other entry. A developer PATH passes 1024
; characters easily (the one that found this bug was 2270), and ${WordReplace}
; in the uninstall hook had the same ceiling.
;
; So both operations are delegated to windows\path-manager.ps1, which does the
; read/modify/write through .NET (no length limit) and rewrites the value as
; REG_EXPAND_SZ. If PowerShell is missing or the script fails, the PATH is left
; exactly as it was and the user is told — never a partial write.

; The script ships as a Windows Tauri resource (declared in
; `tauri.windows.conf.json` alongside conpty, and landing next to the exe), so
; it is simply on disk at $INSTDIR when the hooks run.
;
; It cannot be packed with `File` from here: ${__FILEDIR__} inside a macro is
; resolved where the macro is *expanded* — Tauri's generated installer.nsi —
; not where it is written, so it never points at src-tauri\windows.
;
; Install time: resources are extracted before POSTINSTALL runs.
; Uninstall time: they are still there during PREUNINSTALL, before files go.
; If the file is missing (upgrading from a build that predates it), PowerShell
; exits non-zero and the caller leaves the PATH untouched.
!macro CORTX_RUN_PATH_SCRIPT ACTION
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\path-manager.ps1" -Action ${ACTION} -Directory "$INSTDIR"'
  Pop $0 ; exit code
  Pop $1 ; output
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; A silent install must never stop on a dialog.
  IfSilent cortx_skip_path

  MessageBox MB_YESNO|MB_ICONQUESTION "Would you like to add the CortX CLI to your system PATH?$\r$\nThis allows you to run 'cortx' from any terminal." IDNO cortx_skip_path

  !insertmacro CORTX_RUN_PATH_SCRIPT "add"

  StrCmp $0 "0" cortx_path_ok
  MessageBox MB_OK|MB_ICONEXCLAMATION "CortX could not update your PATH, so it has been left unchanged.$\r$\nAdd this folder manually if you want the 'cortx' command:$\r$\n$INSTDIR"
  Goto cortx_skip_path

  cortx_path_ok:
  ; Marker for the uninstaller: only remove what we actually added.
  WriteRegStr HKCU "Software\CortX" "AddedToPath" "1"
  WriteRegStr HKCU "Software\CortX" "InstDir" "$INSTDIR"

  cortx_skip_path:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $2 HKCU "Software\CortX" "AddedToPath"
  StrCmp $2 "1" 0 cortx_skip_remove

  !insertmacro CORTX_RUN_PATH_SCRIPT "remove"

  DeleteRegKey HKCU "Software\CortX"

  cortx_skip_remove:
!macroend
