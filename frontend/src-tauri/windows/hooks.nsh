; CortX NSIS Installer Hooks
; Handles adding/removing cortx CLI to/from the user's PATH

!include "WinMessages.nsh"

!macro NSIS_HOOK_POSTINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Would you like to add the CortX CLI to your system PATH?$\r$\nThis allows you to run 'cortx' from any terminal." IDNO cortx_skip_path

  ; Read current user PATH
  ReadRegStr $0 HKCU "Environment" "Path"

  ; If PATH is empty, just set it to INSTDIR
  StrCmp $0 "" 0 cortx_path_append
  WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  Goto cortx_path_done

  cortx_path_append:
  ; Append INSTDIR to existing PATH
  WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"

  cortx_path_done:
  ; Broadcast environment change so new terminals pick it up
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Store marker so uninstaller can clean up
  WriteRegStr HKCU "Software\CortX" "AddedToPath" "1"
  WriteRegStr HKCU "Software\CortX" "InstDir" "$INSTDIR"

  cortx_skip_path:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Check if we previously added to PATH
  ReadRegStr $0 HKCU "Software\CortX" "AddedToPath"
  StrCmp $0 "1" 0 cortx_skip_remove

  ReadRegStr $1 HKCU "Software\CortX" "InstDir"
  ReadRegStr $2 HKCU "Environment" "Path"

  ; Remove our entry from PATH
  ${WordReplace} $2 ";$1" "" "+" $2
  ${WordReplace} $2 "$1;" "" "+" $2
  ${WordReplace} $2 "$1" "" "+" $2

  WriteRegExpandStr HKCU "Environment" "Path" $2
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  DeleteRegKey HKCU "Software\CortX"

  cortx_skip_remove:
!macroend
