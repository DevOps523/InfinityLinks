# Attack Path Analysis: DEPLOY-SECRETS-001

## Source

Anyone who gains access to a deployment archive, VPS copy, backup, or mistakenly served source directory can recover the key without needing application authentication. Direct browser exposure was not observed in this repo.

## Broken Control

A real Google service account JSON key is present at the root of the deployable public-search bot package. It is ignored by git and not bundled into browser code, but VPS copy, backup, archive, SFTP, support, or misconfigured static serving workflows can expose a credential that grants Google Sheets access.

## Sink / Impact

Local credential file -> GOOGLE_SERVICE_ACCOUNT_KEY_FILE config -> Google Sheets client authentication -> read/write subscription sheet operations.

## Severity

high: High because the file is live credential material in a deployable directory and compromise gives access to the subscription control-plane data store. Severity would drop after rotation and moving credentials outside the source/deploy tree; it would rise if the VPS serves repository files directly.
