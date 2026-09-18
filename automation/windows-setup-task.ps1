# Rejestruje w Harmonogramie zadań Windows codzienne uruchomienie scrapera.
# Uruchom raz, w PowerShell, z katalogu projektu:
#   powershell -ExecutionPolicy Bypass -File automation\windows-setup-task.ps1
#
# Domyślnie zadanie startuje codziennie o 08:15. Zmień $Time w razie potrzeby.
# Zadanie odpala "npm run push" w katalogu projektu (pobiera ceny i wypycha dane).

param(
  [string]$Time = "08:15",
  [string]$TaskName = "WakacjeTracker-Scrape"
)

$ErrorActionPreference = "Stop"

# Katalog projektu = katalog nadrzędny względem tego skryptu.
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Znajdź node.exe.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Error "Nie znaleziono node w PATH. Zainstaluj Node.js 18+ i spróbuj ponownie."
  exit 1
}

Write-Host "Projekt : $ProjectDir"
Write-Host "Node    : $node"
Write-Host "Godzina : $Time (codziennie)"
Write-Host "Zadanie : $TaskName"

$action = New-ScheduledTaskAction -Execute $node -Argument "scraper/push.js" -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -RunOnlyIfNetworkAvailable

# StartWhenAvailable => jeśli komputer był wyłączony o zaplanowanej porze,
# zadanie uruchomi się przy najbliższej okazji.

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host ""
Write-Host "Zarejestrowano zadanie '$TaskName'."
Write-Host "Test od razu:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Usunięcie:     Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
