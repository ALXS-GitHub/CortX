<#
.SYNOPSIS
  Add or remove one directory in the *user* PATH, safely.

.DESCRIPTION
  The installer used to do this in NSIS with `ReadRegStr` / `WriteRegExpandStr`.
  That is unsafe: NSIS is built with `NSIS_MAX_STRLEN = 1024`, and `ReadRegStr`
  returns an **empty string** when the value is longer than its buffer. The
  hook then took the "PATH is empty" branch and wrote the install directory on
  its own — wiping every other entry. A developer machine passes 1024
  characters easily (this one was at 2270), so the bug was not an edge case.

  .NET has no such limit, so the read/modify/write happens here instead. The
  value is rewritten as REG_EXPAND_SZ, the type PATH normally has: writing it
  as a plain string would stop any `%VAR%` inside an entry from expanding.

  Nothing is written unless the value actually changes, and a PATH that cannot
  be read is never "repaired" by overwriting it.

.PARAMETER Action
  `add` appends Directory if it is not already there; `remove` deletes every
  occurrence of it.

.PARAMETER Directory
  The directory to add or remove.

.OUTPUTS
  Exit code 0 on success (including "nothing to do"), 1 on failure. The NSIS
  hook treats any non-zero code as "leave the PATH alone".
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Directory
)

$ErrorActionPreference = 'Stop'

function Get-UserPath {
  $item = Get-ItemProperty -Path 'HKCU:\Environment' -Name 'Path' -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  return [string]$item.Path
}

function Normalize([string]$p) {
  return $p.Trim().TrimEnd('\').ToLowerInvariant()
}

try {
  $current = Get-UserPath
  # A missing value is legitimate (a fresh profile): treat it as empty. Only a
  # read *failure* would be dangerous, and that throws instead.
  if ($null -eq $current) { $current = '' }

  $entries = @($current -split ';' | Where-Object { $_.Trim() -ne '' })
  $target = Normalize $Directory

  switch ($Action) {
    'add' {
      if (@($entries | ForEach-Object { Normalize $_ }) -contains $target) {
        Write-Output 'already on PATH; nothing to do'
        exit 0
      }
      $updated = $entries + $Directory
    }
    'remove' {
      $updated = @($entries | Where-Object { (Normalize $_) -ne $target })
      if ($updated.Count -eq $entries.Count) {
        Write-Output 'not on PATH; nothing to do'
        exit 0
      }
    }
  }

  $value = ($updated -join ';')

  # Refuse to shrink the PATH to nothing unless that is genuinely what is left.
  if ($value -eq '' -and $Action -eq 'add') {
    Write-Error 'refusing to write an empty PATH'
    exit 1
  }

  Set-ItemProperty -Path 'HKCU:\Environment' -Name 'Path' -Value $value -Type ExpandString

  # Let already-running shells and Explorer see the change.
  $signature = @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
  $api = Add-Type -MemberDefinition $signature -Name 'CortxEnv' -Namespace 'Cortx' -PassThru
  $unused = [UIntPtr]::Zero
  [void]$api::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$unused)

  Write-Output "$Action ok ($($updated.Count) entries)"
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
