## Fix failing CI checks (2026-05-19T10:56:33.813Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26053715722 ---
ci UNKNOWN STEP ﻿2026-05-18T18:51:49.5041643Z Current runner version: '2.334.0'
ci UNKNOWN STEP 2026-05-18T18:51:49.5068232Z ##[group]Runner Image Provisioner
ci UNKNOWN STEP 2026-05-18T18:51:49.5069060Z Hosted Compute Agent
ci UNKNOWN STEP 2026-05-18T18:51:49.5069570Z Version: 20260213.493
ci UNKNOWN STEP 2026-05-18T18:51:49.5070282Z Commit: 5c115507f6dd24b8de37d8bbe0bb4509d0cc0fa3
ci UNKNOWN STEP 2026-05-18T18:51:49.5071047Z Build Date: 2026-02-13T00:28:41Z
ci UNKNOWN STEP 2026-05-18T18:51:49.5071673Z Worker ID: {80f03e03-fdc0-4c0f-8138-e348e21a7ef8}
ci UNKNOWN STEP 2026-05-18T18:51:49.5072419Z Azure Region: centralus
ci UNKNOWN STEP 2026-05-18T18:51:49.5073143Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:49.5074552Z ##[group]Operating System
ci UNKNOWN STEP 2026-05-18T18:51:49.5075178Z Ubuntu
ci UNKNOWN STEP 2026-05-18T18:51:49.5075728Z 24.04.4
ci UNKNOWN STEP 2026-05-18T18:51:49.5076163Z LTS
ci UNKNOWN STEP 2026-05-18T18:51:49.5076681Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:49.5077175Z ##[group]Runner Image
ci UNKNOWN STEP 2026-05-18T18:51:49.5077774Z Image: ubuntu-24.04
ci UNKNOWN STEP 2026-05-18T18:51:49.5078336Z Version: 20260513.135.3
ci UNKNOWN STEP 2026-05-18T18:51:49.5079573Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20260513.135/images/ubuntu/Ubuntu2404-Readme.md
ci UNKNOWN STEP 2026-05-18T18:51:49.5080998Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20260513.135
ci UNKNOWN STEP 2026-05-18T18:51:49.5081926Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:49.5083329Z ##[group]GITHUB_TOKEN Permissions
ci UNKNOWN STEP 2026-05-18T18:51:49.5085626Z Actions: read
ci UNKNOWN STEP 2026-05-18T18:51:49.5086143Z Contents: read
ci UNKNOWN STEP 2026-05-18T18:51:49.5086643Z Metadata: read
ci UNKNOWN STEP 2026-05-18T18:51:49.5087220Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:49.5089331Z Secret source: Actions
ci UNKNOWN STEP 2026-05-18T18:51:49.5089983Z Prepare workflow directory
ci UNKNOWN STEP 2026-05-18T18:51:49.5437169Z Prepare all required actions
ci UNKNOWN STEP 2026-05-18T18:51:49.5475375Z Getting action download info
ci UNKNOWN STEP 2026-05-18T18:51:50.0130609Z Download action repository 'actions/checkout@v6' (SHA:de0fac2e4500dabe0009e67214ff5f5447ce83dd)
ci UNKNOWN STEP 2026-05-18T18:51:50.2608251Z Complete job name: ci
ci UNKNOWN STEP 2026-05-18T18:51:50.3462269Z ##[group]Run actions/checkout@v6
ci UNKNOWN STEP 2026-05-18T18:51:50.3463696Z with:
ci UNKNOWN STEP 2026-05-18T18:51:50.3464117Z fetch-depth: 0
ci UNKNOWN STEP 2026-05-18T18:51:50.3464569Z repository: NeriRos/ralphy
ci UNKNOWN STEP 2026-05-18T18:51:50.3465404Z token: \*\*\*
ci UNKNOWN STEP 2026-05-18T18:51:50.3465814Z ssh-strict: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3466227Z ssh-user: git
ci UNKNOWN STEP 2026-05-18T18:51:50.3466647Z persist-credentials: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3467128Z clean: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3467552Z sparse-checkout-cone-mode: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3468048Z fetch-tags: false
ci UNKNOWN STEP 2026-05-18T18:51:50.3468487Z show-progress: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3468929Z lfs: false
ci UNKNOWN STEP 2026-05-18T18:51:50.3469338Z submodules: false
ci UNKNOWN STEP 2026-05-18T18:51:50.3469761Z set-safe-directory: true
ci UNKNOWN STEP 2026-05-18T18:51:50.3470434Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:50.4494589Z Syncing repository: NeriRos/ralphy
ci UNKNOWN STEP 2026-05-18T18:51:50.4496505Z ##[group]Getting Git version info
ci UNKNOWN STEP 2026-05-18T18:51:50.4497191Z Working directory is '/home/runner/work/ralphy/ralphy'
ci UNKNOWN STEP 2026-05-18T18:51:50.4498533Z [command]/usr/bin/git version
ci UNKNOWN STEP 2026-05-18T18:51:50.4548064Z git version 2.54.0
ci UNKNOWN STEP 2026-05-18T18:51:50.4605464Z ##[endgroup]
ci UNKNOWN STEP 2026-05-18T18:51:50.4621586Z Temporarily overriding HOME='/home/runner/work/\_temp/15d24f5d-d81b-40d0-82aa-30b086d99ffc' before making globa
…[truncated 200943 chars]

```

```
