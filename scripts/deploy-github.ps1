# One-time: gh auth login
# Then run: powershell -ExecutionPolicy Bypass -File .\scripts\deploy-github.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;" + $env:Path

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git not found. Install Git for Windows first."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI not found. Install: winget install GitHub.cli"
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Login to GitHub (browser will open)..."
  gh auth login -h github.com -p https -w
}

$repoName = "reesrf4-ok-game"
$owner = (gh api user -q .login)
$remote = "https://github.com/$owner/$repoName.git"

if (-not (Test-Path ".git")) {
  git init -b main
}

gh repo view "$owner/$repoName" 2>$null
if ($LASTEXITCODE -ne 0) {
  gh repo create $repoName --public --source=. --remote=origin --description "OK HTML5 game reesrf4 (FAPI ads)"
} else {
  git remote set-url origin $remote
}

git add game-config.js game.js index.html index-vk.html ok-ads.js styles.css vk-ads-entry.js vk-bridge.js vk-hosting-config.json package.json package-lock.json scripts .github README.md .gitignore
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "Deploy reesrf4: VK 54678871, OK 512004492157"
}

git push -u origin main

gh api -X POST "repos/$owner/$repoName/pages" -f build_type=workflow 2>$null
Start-Sleep -Seconds 3
$url = gh api "repos/$owner/$repoName/pages" -q .html_url 2>$null
if (-not $url) { $url = "https://$owner.github.io/$repoName/" }

Write-Host ""
Write-Host "GitHub Pages URL: $url"
Write-Host ""
Write-Host "Next: paste this URL in apiok.ru/dev -> your game -> Settings (Web + Mobile)"
Write-Host "OK app ID: 512004492157"
Write-Host "Open game: https://ok.ru/game/512004492157"
