param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'build'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$dark = [System.Drawing.ColorTranslator]::FromHtml('#291d1b')
$brown = [System.Drawing.ColorTranslator]::FromHtml('#82502a')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#ebc54c')
$cream = [System.Drawing.ColorTranslator]::FromHtml('#fff3d8')
$iconPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src/assets/shortcut-icon.png'
$icon = [System.Drawing.Image]::FromFile($iconPath)

function New-Canvas([int]$Width, [int]$Height) {
    return [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
}

function Save-Canvas($Bitmap, [string]$Name) {
    $target = Join-Path $OutputDirectory $Name
    $Bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $Bitmap.Dispose()
    Write-Host "Created $target"
}

try {
    $sidebar = New-Canvas 164 314
    $graphics = [System.Drawing.Graphics]::FromImage($sidebar)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear($dark)
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($brown), 0, 0, 164, 7)
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($gold), 0, 7, 164, 2)
        $graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(21, 64, 122, 122))
        $font = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
        $caption = [System.Drawing.Font]::new('Segoe UI', 8, [System.Drawing.FontStyle]::Regular)
        try {
            $graphics.DrawString('CubeBricks', $font, [System.Drawing.SolidBrush]::new($gold), 13, 196)
            $graphics.DrawString('MODEL WORKSPACE', $caption, [System.Drawing.SolidBrush]::new($cream), 27, 235)
        } finally {
            $font.Dispose()
            $caption.Dispose()
        }
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($brown), 20, 275, 124, 1)
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($gold), 20, 279, 44, 2)
    } finally { $graphics.Dispose() }
    Save-Canvas $sidebar 'installerSidebar.bmp'

    $header = New-Canvas 150 57
    $graphics = [System.Drawing.Graphics]::FromImage($header)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear($dark)
        $graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(7, 8, 40, 40))
        $font = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
        try { $graphics.DrawString('CubeBricks', $font, [System.Drawing.SolidBrush]::new($gold), 48, 15) }
        finally { $font.Dispose() }
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($brown), 48, 39, 88, 1)
        $graphics.FillRectangle([System.Drawing.SolidBrush]::new($gold), 48, 43, 31, 2)
    } finally { $graphics.Dispose() }
    Save-Canvas $header 'installerHeader.bmp'
} finally { $icon.Dispose() }
