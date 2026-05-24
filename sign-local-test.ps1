# sign-local-test.ps1
# Signs the MSIX with a self-signed cert matching the Store publisher CN so
# you can install and test it locally. Run as Administrator.
#
# After testing, remove the cert:
#   certlm.msc > Trusted People > Certificates > delete "CoreSound Local Test"

$ErrorActionPreference = "Stop"

$publisher = "CN=91AE4750-E60A-404D-9406-466F85BE0DB0"
$appx = Get-ChildItem "dist\*.appx" | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $appx) {
    Write-Error "No .appx found in dist\. Run 'npm run dist:win:store' first."
    exit 1
}
Write-Host "Signing: $($appx.Name)" -ForegroundColor Cyan

# 1. Create self-signed cert with the Store publisher CN
$cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $publisher `
    -KeyUsage DigitalSignature `
    -FriendlyName "CoreSound Local Test" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

# 2. Export to temp PFX for signtool
$pfx = "$env:TEMP\coresound-test.pfx"
$cer = "$env:TEMP\coresound-test.cer"
$pass = ConvertTo-SecureString "LocalTestOnly!" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass | Out-Null
Export-Certificate   -Cert $cert -FilePath $cer | Out-Null

# 3. Find signtool.exe (comes with Windows SDK or Visual Studio)
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" `
    -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*x64*" } |
    Sort-Object FullName | Select-Object -Last 1

if (-not $signtool) {
    # Try Visual Studio location
    $signtool = Get-ChildItem "C:\Program Files\Microsoft Visual Studio" `
        -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Select-Object -Last 1
}
if (-not $signtool) {
    Write-Error "signtool.exe not found. Install Windows SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/"
    exit 1
}
Write-Host "Using signtool: $($signtool.FullName)" -ForegroundColor Gray

# 4. Sign the appx
& $signtool.FullName sign /fd SHA256 /f $pfx /p "LocalTestOnly!" $appx.FullName
if ($LASTEXITCODE -ne 0) { Write-Error "signtool failed (exit $LASTEXITCODE)"; exit 1 }

# 5. Trust the cert locally (requires admin)
Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null

# 6. Clean up temp files
Remove-Item $pfx, $cer -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "Double-click  dist\$($appx.Name)  to install and test." -ForegroundColor White
Write-Host ""
Write-Host "When finished, remove the test cert:" -ForegroundColor Yellow
Write-Host "  certlm.msc > Trusted People > Certificates > delete 'CoreSound Local Test'" -ForegroundColor Yellow
