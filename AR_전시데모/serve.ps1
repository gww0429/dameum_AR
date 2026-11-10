# PC 테스트용 로컬 서버 (http://localhost:8790)
# 실행: powershell -ExecutionPolicy Bypass -File serve.ps1
# localhost 는 https 가 아니어도 카메라를 쓸 수 있어 PC 웹캠으로 테스트할 수 있습니다.
param([int]$Port = 8790)
$Root = $PSScriptRoot
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "AR 데모: http://localhost:$Port/  (종료: Ctrl+C)"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css'; '.png'='image/png';
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.glb'='model/gltf-binary'; '.gltf'='model/gltf+json'; '.bin'='application/octet-stream';
  '.mind'='application/octet-stream'; '.md'='text/plain; charset=utf-8' }
$rootFull = [IO.Path]::GetFullPath($Root)
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $req = $c.Request
    if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/__save') {
      $rel = $req.QueryString['path']
      $dest = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      if ($dest.StartsWith((Join-Path $rootFull 'assets')) -and $dest.EndsWith('.mind')) {
        $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
        [IO.File]::WriteAllBytes($dest, $ms.ToArray()); $c.Response.StatusCode = 200
      } else { $c.Response.StatusCode = 403 }
    } else {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq '') { $rel = 'index.html' }
      $f = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      if ($f.StartsWith($rootFull) -and (Test-Path -LiteralPath $f -PathType Leaf)) {
        $b = [IO.File]::ReadAllBytes($f)
        $ext = [IO.Path]::GetExtension($f).ToLower()
        $c.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
        $c.Response.Headers.Add('Cache-Control', 'no-store')
        $c.Response.OutputStream.Write($b, 0, $b.Length)
      } else { $c.Response.StatusCode = 404 }
    }
  } catch { $c.Response.StatusCode = 500 }
  $c.Response.Close()
}
