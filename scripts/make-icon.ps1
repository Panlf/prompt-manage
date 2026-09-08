# Generates resources/app-icon.ico (multi-size) + resources/app-icon.png (256px)
# Blue gradient rounded square + white italic "P", matching the in-app branding.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outIco = Join-Path $root "resources\app-icon.ico"
$outPng = Join-Path $root "resources\app-icon.png"

function New-AppBitmap([int]$s) {
	$bmp = New-Object System.Drawing.Bitmap($s, $s)
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

	# Rounded square (radius ~22.5% of size), transparent background
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$r = [int]($s * 0.225)
	$path.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
	$path.AddArc($s - 2*$r, 0, 2*$r, 2*$r, 270, 90)
	$path.AddArc($s - 2*$r, $s - 2*$r, 2*$r, 2*$r, 0, 90)
	$path.AddArc(0, $s - 2*$r, 2*$r, 2*$r, 90, 90)
	$path.CloseFigure()

	$rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
	$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, `
		[System.Drawing.Color]::FromArgb(255, 0, 113, 227), `
		[System.Drawing.Color]::FromArgb(255, 100, 210, 255), `
		45)
	$g.FillPath($brush, $path)

	# White italic serif "P", centered
	$font = New-Object System.Drawing.Font("Georgia", [float]($s * 0.60), `
		([System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic), `
		[System.Drawing.GraphicsUnit]::Pixel)
	$fmt = New-Object System.Drawing.StringFormat
	$fmt.Alignment = [System.Drawing.StringAlignment]::Center
	$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
	$g.DrawString("P", $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]$rect, $fmt)

	$g.Dispose()
	return $bmp
}

function BitmapToPngBytes($bmp) {
	$ms = New-Object System.IO.MemoryStream
	$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
	# leading comma prevents PowerShell from unrolling byte[] into the pipeline
	return ,$ms.ToArray()
}

function BitmapToDibBytes($bmp) {
	# 32bpp top-down BGRA -> bottom-up DIB with empty AND mask (valid ICO image format)
	$s = $bmp.Width
	$rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
	$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, `
		[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$stride = $data.Stride
	$pix = New-Object byte[] ($stride * $s)
	[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pix, 0, $pix.Length)
	$bmp.UnlockBits($data)

	$ms = New-Object System.IO.MemoryStream
	$bw = New-Object System.IO.BinaryWriter($ms)
	# BITMAPINFOHEADER
	$bw.Write([uint32]40)          # biSize
	$bw.Write([int32]$s)           # biWidth
	$bw.Write([int32]($s * 2))     # biHeight (image + mask)
	$bw.Write([uint16]1)           # biPlanes
	$bw.Write([uint16]32)          # biBitCount
	$bw.Write([uint32]0)           # biCompression = BI_RGB
	$bw.Write([uint32]($s * $s * 4))
	$bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
	# Pixel rows bottom-up (BGRA)
	for ($y = $s - 1; $y -ge 0; $y--) {
		$row = New-Object byte[] ($s * 4)
		[Array]::Copy($pix, $y * $stride, $row, 0, $s * 4)
		$bw.Write($row)
	}
	# AND mask (all transparent; alpha channel rules)
	$maskRow = [Math]::Ceiling($s / 8.0)
	$maskRow = [int]([Math]::Ceiling($maskRow / 4.0) * 4)
	$bw.Write((New-Object byte[] ($maskRow * $s)))
	$bw.Flush()
	return ,$ms.ToArray()
}

# ---- Compose ICO ----
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = New-Object "System.Collections.Generic.List[object]"
foreach ($sz in $sizes) {
	$bmp = New-AppBitmap $sz
	if ($sz -le 48) { [byte[]]$img = BitmapToDibBytes $bmp } else { [byte[]]$img = BitmapToPngBytes $bmp }
	if (-not $img -or $img.Length -lt 8) { throw "image for size $sz is empty" }
	$entries.Add(@{ Size = $sz; Bytes = $img })
	if ($sz -eq 256) { [IO.File]::WriteAllBytes($outPng, (BitmapToPngBytes $bmp)) }
	$bmp.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)  # ICONDIR
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
	$sz = $e.Size; $img = $e.Bytes
	$b = if ($sz -ge 256) { 0 } else { $sz }
	$w.Write([byte]$b)            # width
	$w.Write([byte]$b)            # height
	$w.Write([byte]0)             # palette
	$w.Write([byte]0)             # reserved
	$w.Write([uint16]1)           # planes
	$w.Write([uint16]32)          # bitcount
	$w.Write([uint32]$img.Length) # size
	$w.Write([uint32]$offset)     # offset
	$offset += $img.Length
}
foreach ($e in $entries) { $w.Write($e.Bytes) }
$w.Flush()
[IO.File]::WriteAllBytes($outIco, $ico.ToArray())

Write-Output ("ICO written: " + $outIco + " (" + $ico.Length + " bytes, " + $sizes.Count + " sizes)")
Write-Output ("PNG written: " + $outPng)
