[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Path,
    [switch] $RequireValid,
    [string] $ExpectedSubject
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "File not found: $Path" }
$signature = Get-AuthenticodeSignature -LiteralPath $Path
$valid = $signature.Status -eq 'Valid' -and $signature.SignerCertificate
if ($valid -and $ExpectedSubject -and $signature.SignerCertificate.Subject -ne $ExpectedSubject) {
    $valid = $false
}
if ($RequireValid -and -not $valid) {
    throw "Invalid Authenticode signature or subject: $($signature.Status)"
}
if ($valid) {
    Write-Host "Valid Authenticode signature: $Path"
    exit 0
}
Write-Host "Unsigned Authenticode file: $Path"
exit 0
