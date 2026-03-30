$ErrorActionPreference = "Stop"

function Get-TailscaleIpv4 {
  $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
  if (-not $tailscale) {
    return $null
  }

  $ips = & tailscale ip -4 2>$null
  if (-not $ips) {
    return $null
  }

  return ($ips | Select-Object -First 1).Trim()
}

$ip = Get-TailscaleIpv4

if (-not $ip) {
  Write-Host "未检测到 Tailscale IPv4，请先安装并登录 Tailscale。" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "可分享给填报人的访问地址：" -ForegroundColor Cyan
Write-Host "前端: http://$ip`:3000"
Write-Host "后端: http://$ip`:3001"
Write-Host ""
Write-Host "建议把 .env 中的 NEXT_PUBLIC_API_BASE_URL 改成：" -ForegroundColor Cyan
Write-Host "NEXT_PUBLIC_API_BASE_URL=""http://$ip`:3001"""
Write-Host ""
