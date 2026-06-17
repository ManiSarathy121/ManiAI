param(
    [string]$Action = "discover",
    [int]$Port = 0
)

# Set JSON encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($Action -eq "discover") {
    $msmdsrv = Get-Process -Name msmdsrv -ErrorAction SilentlyContinue
    if ($null -eq $msmdsrv) {
        Write-Output '{"success":false,"error":"Power BI Desktop is not running. Please open a Power BI Desktop report first."}'
        exit
    }
    $connections = Get-NetTCPConnection -OwningProcess $msmdsrv.Id -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue
    if (-not $connections) {
        Write-Output '{"success":false,"error":"Could not find a local TCP port for the Power BI Desktop instance."}'
        exit
    }
    $port = $connections[0].LocalPort
    Write-Output "{`"success`":true,`"port`":$port}"
    exit
}

if ($Action -eq "schema") {
    if ($Port -eq 0) {
        Write-Output '{"success":false,"error":"Port parameter is required for schema action."}'
        exit
    }
    
    $dllPath = "C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.AnalysisServices.Server.Tabular.dll"
    if (-not (Test-Path $dllPath)) {
        $dllSearch = Get-ChildItem -Path "C:\Program Files" -Filter "Microsoft.AnalysisServices.Server.Tabular.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($dllSearch) { $dllPath = $dllSearch.FullName }
    }
    if (-not (Test-Path $dllPath)) {
        Write-Output '{"success":false,"error":"Microsoft.AnalysisServices.Server.Tabular.dll not found."}'
        exit
    }
    
    try {
        [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
    } catch {
        $err = $_.Exception.Message.Replace('"', '\"').Replace("`r", "").Replace("`n", " ")
        Write-Output "{`"success`":false,`"error`":`"Failed to load Microsoft.AnalysisServices.Server.Tabular.dll: $err`"}"
        exit
    }

    $server = New-Object Microsoft.AnalysisServices.Tabular.Server
    try {
        $server.Connect("localhost:$Port")
        if (-not $server.Connected) {
            Write-Output '{"success":false,"error":"Failed to connect to Power BI Desktop local server."}'
            exit
        }
        $db = $server.Databases[0]
        $model = $db.Model
        $tables = @()
        foreach ($tbl in $model.Tables) {
            if ($tbl.IsHidden) { continue }
            $cols = @()
            foreach ($col in $tbl.Columns) {
                if ($col.IsHidden) { continue }
                $colObj = [PSCustomObject]@{
                    name = $col.Name
                    type = $col.DataType.ToString()
                }
                if ($col.Type -eq "Calculated") {
                    $colObj | Add-Member -NotePropertyName "expression" -NotePropertyValue $col.Expression
                }
                $cols += $colObj
            }
            $meas = @()
            foreach ($m in $tbl.Measures) {
                if ($m.IsHidden) { continue }
                $meas += [PSCustomObject]@{
                    name = $m.Name
                    expression = $m.Expression
                }
            }
            $tables += [PSCustomObject]@{
                name = $tbl.Name
                columns = $cols
                measures = $meas
            }
        }
        $rels = @()
        foreach ($r in $model.Relationships) {
            $rels += [PSCustomObject]@{
                fromTable = $r.FromTable.Name
                fromColumn = $r.FromColumn.Name
                toTable = $r.ToTable.Name
                toColumn = $r.ToColumn.Name
            }
        }
        $result = [PSCustomObject]@{
            success = $true
            database = $db.Name
            port = $Port
            tables = $tables
            relationships = $rels
        }
        Write-Output ($result | ConvertTo-Json -Depth 10)
    } catch {
        $err = $_.Exception.Message.Replace('"', '\"').Replace("`r", "").Replace("`n", " ")
        Write-Output "{`"success`":false,`"error`":`"Failed to query model: $err`"}"
    } finally {
        if ($server.Connected) { $server.Disconnect() }
    }
}
