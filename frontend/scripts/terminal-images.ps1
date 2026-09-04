<#
.SYNOPSIS
  Draws the same picture three times — Sixel, iTerm2 (OSC 1337) and Kitty
  (APC) — so the three image protocols can be checked in one go.

.DESCRIPTION
  Run it inside a CortX terminal:

      pwsh -File frontend/scripts/terminal-images.ps1

  You should see three copies of the image, each under its own label. What
  each one tells you:

    Sixel     the image addon and the renderer are fine.
    iTerm2    OSC 1337 survives ConPTY *and* CortX repairs the header.
              Two variants are drawn: one with `size=` (which the addon has
              always accepted) and one without, the way fastfetch emits it —
              that second one is the DEV-13 bug. If only the first shows up,
              `lib/terminalImages.ts` is not in the write path.
    Kitty     the APC translation in `lib/terminalImages.ts` works. Three
              variants: PNG, PNG in two chunks, and raw RGBA.

  Add -Dump <file> to write the raw byte stream to a file instead of the
  terminal, to inspect the sequences by hand.

.PARAMETER Image
  A PNG to send. Defaults to the CortX icon.
#>
[CmdletBinding()]
param(
  [string]$Image,
  [string]$Dump
)

$ErrorActionPreference = 'Stop'
$esc = [char]27
$bel = [char]7

if (-not $Image) {
  $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $Image = Join-Path $root 'frontend/src-tauri/icons/128x128.png'
}
if (-not (Test-Path $Image)) { throw "No such image: $Image" }

$bytes = [IO.File]::ReadAllBytes($Image)
$b64 = [Convert]::ToBase64String($bytes)

$out = New-Object System.Text.StringBuilder
function Emit([string]$s) { [void]$out.Append($s) }
function Say([string]$s) { Emit("$s`r`n") }

# --------------------------------------------------------------------------
# 1. Sixel — a small colour bar, generated here so no tool is needed.
# --------------------------------------------------------------------------
Say ''
Say '=== 1. Sixel ==='
$sixel = New-Object System.Text.StringBuilder
[void]$sixel.Append("${esc}Pq")
$palette = @(
  @(0, 100, 20, 20), @(1, 90, 60, 10), @(2, 20, 80, 30),
  @(3, 10, 60, 90), @(4, 60, 20, 90), @(5, 90, 90, 90)
)
foreach ($p in $palette) { [void]$sixel.Append("#$($p[0]);2;$($p[1]);$($p[2]);$($p[3])") }
for ($band = 0; $band -lt 4; $band++) {
  foreach ($p in $palette) {
    [void]$sixel.Append("#$($p[0])")
    [void]$sixel.Append([string]'~' * 12)
    [void]$sixel.Append('$')
  }
  [void]$sixel.Append('-')
}
[void]$sixel.Append("$esc\")
Emit($sixel.ToString())
Say ''

# --------------------------------------------------------------------------
# 2. iTerm2 inline images (OSC 1337).
# --------------------------------------------------------------------------
Say '=== 2a. iTerm2, with size= (works with the stock addon) ==='
Emit("$esc]1337;File=inline=1;size=$($bytes.Length);width=20;preserveAspectRatio=1:$b64$bel")
Say ''
Say '=== 2b. iTerm2, without size= (how fastfetch emits it) ==='
Emit("$esc]1337;File=inline=1;width=20;preserveAspectRatio=1:$b64$bel")
Say ''
Say '=== 2c. iTerm2, ST terminator instead of BEL ==='
Emit("$esc]1337;File=inline=1;width=20:$b64$esc\")
Say ''

# --------------------------------------------------------------------------
# 3. Kitty graphics (APC).
# --------------------------------------------------------------------------
Say '=== 3a. Kitty, PNG in one chunk (a=T,f=100) ==='
Emit("${esc}_Gf=100,a=T,c=20;$b64$esc\")
Say ''

Say '=== 3b. Kitty, PNG in 4 KB chunks (m=1 / m=0) ==='
$chunk = 4096
$i = 0
$first = $true
while ($i -lt $b64.Length) {
  $len = [Math]::Min($chunk, $b64.Length - $i)
  $part = $b64.Substring($i, $len)
  $i += $len
  $more = if ($i -lt $b64.Length) { 1 } else { 0 }
  if ($first) {
    Emit("${esc}_Gf=100,a=T,c=20,m=$more;$part$esc\")
    $first = $false
  } else {
    Emit("${esc}_Gm=$more;$part$esc\")
  }
}
Say ''

Say '=== 3c. Kitty, raw RGBA 32x32 (a=T,f=32,s=32,v=32) ==='
$w = 32; $h = 32
$raw = New-Object byte[] ($w * $h * 4)
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $o = (($y * $w) + $x) * 4
    $raw[$o]     = [byte](($x * 255) / $w)
    $raw[$o + 1] = [byte](($y * 255) / $h)
    $raw[$o + 2] = [byte]128
    $raw[$o + 3] = [byte]255
  }
}
Emit("${esc}_Ga=T,f=32,s=$w,v=$h,c=8;$([Convert]::ToBase64String($raw))$esc\")
Say ''

Say '=== 4. Kitty support query (a=q) — a terminal that supports it answers OK ==='
Emit("${esc}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA$esc\")
Say ''
Say 'done.'

$text = $out.ToString()
if ($Dump) {
  [IO.File]::WriteAllBytes($Dump, [Text.Encoding]::GetEncoding(28591).GetBytes($text))
  Write-Host "wrote $($text.Length) bytes to $Dump"
} else {
  [Console]::Out.Write($text)
}
