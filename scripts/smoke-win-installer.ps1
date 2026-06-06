param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [string]$InstallDir = (Join-Path $env:TEMP "TaskWraithSmokeInstall")
)

$ErrorActionPreference = "Stop"

function Assert-ValidSignature([string]$Path, [string]$Label) {
  if (!(Test-Path $Path)) {
    throw "Missing $Label: $Path"
  }
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne "Valid") {
    throw "Invalid Authenticode signature for $Label ($Path): $($signature.Status)"
  }
}

if (!(Test-Path $InstallerPath)) {
  throw "Installer not found: $InstallerPath"
}

$resolvedInstaller = (Resolve-Path $InstallerPath).Path
if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Assert-ValidSignature $resolvedInstaller "installer"

$installArgs = @("/S", "/D=$InstallDir")
$install = Start-Process -FilePath $resolvedInstaller -ArgumentList $installArgs -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw "Installer exited with code $($install.ExitCode)"
}

$appExe = Join-Path $InstallDir "TaskWraith.exe"
$uninstaller = Join-Path $InstallDir "Uninstall TaskWraith.exe"
Assert-ValidSignature $appExe "installed app"
Assert-ValidSignature $uninstaller "uninstaller"

$app = Start-Process -FilePath $appExe -PassThru
Start-Sleep -Seconds 4
if ($app.HasExited) {
  throw "Installed app exited during launch smoke with code $($app.ExitCode)"
}
$app.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (!$app.HasExited) {
  Stop-Process -Id $app.Id -Force
}

$uninstall = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru
if ($uninstall.ExitCode -ne 0) {
  throw "Uninstaller exited with code $($uninstall.ExitCode)"
}
if (Test-Path $appExe) {
  throw "App executable still exists after uninstall: $appExe"
}

Write-Host "Windows installer smoke ok: $resolvedInstaller"
