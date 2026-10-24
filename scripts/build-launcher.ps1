$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $projectRoot 'launcher\CubeBricksStart.cs'
$icon = Join-Path $projectRoot 'src\assets\shortcut-icon.ico'
$output = Join-Path $projectRoot 'CubeBricksStart.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler not found.' }
if (-not (Test-Path -LiteralPath $icon)) { throw 'Launcher icon not found.' }

& $compiler '/nologo' '/target:winexe' '/optimize+' '/codepage:65001' "/win32icon:$icon" "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "Launcher build failed with exit code $LASTEXITCODE." }
Write-Host "Built $output"
