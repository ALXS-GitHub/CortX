; CortX NSIS Installer Hooks
; Handles adding/removing cortx CLI to/from the user's PATH

!macro NSIS_HOOK_POSTINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Would you like to add the CortX CLI to your PATH?$\r$\nThis lets you run 'cortx' from any terminal window." IDYES _addPath IDNO _skipPath

  _addPath:
    ; Read current user PATH
    ReadRegStr $0 HKCU "Environment" "Path"

    ; Check if $INSTDIR is already in PATH
    ${StrLoc} $1 $0 "$INSTDIR" ">"
    StrCmp $1 "" 0 _skipPath

    ; Append to PATH
    StrCmp $0 "" 0 +3
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
      Goto _pathDone
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"

    _pathDone:
    ; Broadcast environment change to all windows
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

    ; Store marker for uninstaller
    WriteRegStr HKCU "Software\CortX" "AddedToPath" "1"
    WriteRegStr HKCU "Software\CortX" "InstDir" "$INSTDIR"

  _skipPath:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Check if we added to PATH
  ReadRegStr $0 HKCU "Software\CortX" "AddedToPath"
  StrCmp $0 "1" 0 _skipRemovePath

  ReadRegStr $1 HKCU "Software\CortX" "InstDir"
  ReadRegStr $2 HKCU "Environment" "Path"

  ; Remove "$INSTDIR" from PATH (handles ";dir", "dir;" and standalone "dir")
  ${WordReplace} $2 ";$1" "" "+" $2
  ${WordReplace} $2 "$1;" "" "+" $2
  ${WordReplace} $2 "$1" "" "+" $2

  WriteRegExpandStr HKCU "Environment" "Path" $2
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  DeleteRegKey HKCU "Software\CortX"

  _skipRemovePath:
!macroend
