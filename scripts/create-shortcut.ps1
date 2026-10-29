# Adds a "Pin Float" shortcut to the desktop and the Start menu: pwsh scripts/create-shortcut.ps1
# The shortcut runs electron.exe directly, so no console window opens.
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) { throw "Electron not found. Run 'npm i' in the project folder first." }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '')
)
foreach ($dir in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Pin Float.lnk'))
  $lnk.TargetPath = $exe
  $lnk.Arguments = "`"$root`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = (Join-Path $root 'build\icon.ico')
  $lnk.Description = 'Pin images as small windows that stay on top'
  $lnk.Save()
  Write-Output $lnk.FullName
}
