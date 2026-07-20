# Farol: gera os PNGs do icone (farol/lighthouse) via GDI+, sem dependencias.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'assets\png'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-RoundedRect([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Farol([int]$size, [string]$file, [bool]$withBg) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $f = $size / 256.0

  $bg     = [System.Drawing.Color]::FromArgb(255, 16, 21, 34)
  $amber  = [System.Drawing.Color]::FromArgb(255, 255, 180, 84)
  $amber45= [System.Drawing.Color]::FromArgb(115, 255, 180, 84)
  $tower  = [System.Drawing.Color]::FromArgb(255, 231, 236, 245)

  if ($withBg) {
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $path = New-RoundedRect $rect (56 * $f)
    $brush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillPath($brush, $path)
    $brush.Dispose(); $path.Dispose()
  }

  function P([float]$x, [float]$y) { New-Object System.Drawing.PointF(($x * $f), ($y * $f)) }
  function RectF([float]$x, [float]$y, [float]$w, [float]$h) { New-Object System.Drawing.RectangleF(($x * $f), ($y * $f), ($w * $f), ($h * $f)) }

  $bAmber45 = New-Object System.Drawing.SolidBrush($amber45)
  $bAmber   = New-Object System.Drawing.SolidBrush($amber)
  $bTower   = New-Object System.Drawing.SolidBrush($tower)
  $bBg      = New-Object System.Drawing.SolidBrush($bg)

  # feixes de luz, saindo da lanterna no topo
  $g.FillPolygon($bAmber45, @((P 114.1 55.5), (P 21.3 27.7), (P 21.3 85.3), (P 114.1 73.6)))
  $g.FillPolygon($bAmber,   @((P 141.9 55.5), (P 234.7 27.7), (P 234.7 85.3), (P 141.9 73.6)))
  # cupula
  $g.FillPolygon($bTower, @((P 128 20.3), (P 145.1 41.6), (P 110.9 41.6)))
  # lanterna com a luz acesa
  $g.FillRectangle($bTower, (RectF 112 41.6 32 27.7))
  $g.FillRectangle($bAmber, (RectF 118.4 46.9 19.2 18.1))
  # galeria
  $galPath = New-RoundedRect (RectF 104.5 69.3 46.9 11.7) (5.9 * $f)
  $g.FillPath($bTower, $galPath); $galPath.Dispose()
  # torre conica
  $g.FillPolygon($bTower, @((P 114.1 81.1), (P 141.9 81.1), (P 162.1 213.3), (P 93.9 213.3)))
  # listras (so quando ha fundo pra recortar)
  if ($withBg) {
    $g.FillRectangle($bBg, (RectF 107.7 117.3 40.5 11.7))
    $g.FillRectangle($bBg, (RectF 102.4 155.7 51.2 11.7))
  }
  # base
  $basePath = New-RoundedRect (RectF 85.3 213.3 85.3 18.1) (9 * $f)
  $g.FillPath($bTower, $basePath); $basePath.Dispose()

  $bAmber45.Dispose(); $bAmber.Dispose(); $bTower.Dispose(); $bBg.Dispose()
  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  ok  $file"
}

foreach ($s in @(256, 64, 48, 32, 24, 16)) {
  Draw-Farol $s (Join-Path $out "farol-$s.png") $true
}
# icone da bandeja: sem fundo, so a marca
Draw-Farol 32 (Join-Path $root 'assets\tray.png') $false
Write-Host 'PNGs gerados.'
