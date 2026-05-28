$ErrorActionPreference = "Stop"

$releaseDir = Join-Path (Get-Location) "release/windows/InfinityLinks"

if (-not (Test-Path -LiteralPath (Join-Path $releaseDir "InfinityLinks.exe") -PathType Leaf)) {
    throw "Missing required executable: InfinityLinks.exe"
}

$forbiddenDirectories = @("src", "tests", ".git")
foreach ($directoryName in $forbiddenDirectories) {
    $matches = Get-ChildItem -LiteralPath $releaseDir -Directory -Recurse -Force |
        Where-Object { $_.Name -eq $directoryName }

    if ($matches) {
        throw "Release folder contains forbidden directory: $directoryName"
    }
}

$forbiddenFiles = Get-ChildItem -LiteralPath $releaseDir -File -Recurse -Force |
    Where-Object { $_.Extension -in @(".ts", ".tsx", ".map") }

if ($forbiddenFiles) {
    throw "Release folder contains forbidden source or map files."
}

$requiredItems = @(
    @{ Path = "InfinityLinks.exe"; Type = "Leaf" },
    @{ Path = ".env.example"; Type = "Leaf" },
    @{ Path = "README.txt"; Type = "Leaf" },
    @{ Path = "schema.sql"; Type = "Leaf" },
    @{ Path = "client/index.html"; Type = "Leaf" },
    @{ Path = "data"; Type = "Container" }
)

foreach ($item in $requiredItems) {
    $itemPath = Join-Path $releaseDir $item.Path
    if (-not (Test-Path -LiteralPath $itemPath -PathType $item.Type)) {
        throw "Missing required release item: $($item.Path)"
    }
}

Write-Host "Windows release verification passed."
