# NoDupe releases

Everything to publish a new version of **NoDupe** to users.

| File | What it is |
|---|---|
| [RELEASE_MANAGEMENT.md](RELEASE_MANAGEMENT.md) | **Start here.** The whole process, step by step, with diagrams, rules and what to do when something goes wrong |
| `publish.mjs` | Signs a release, creates the GitHub release with the installer, then publishes the list |
| `update.mjs` | Changes a published release: rollout, pause, withdraw, mandatory, notes |

## Quick start

```powershell
# 1. one-time: gh auth login (Technowiz account), and set the signing seed for this window
$env:RELEASE_SIGNING_KEY = "<seed from your password manager>"

# 2. rehearse, then publish (it asks you to type the version)
node releases/NoDupe/publish.mjs 2.1.0 .\NoDupe-2.1.0-x64.exe --notes "First change|Second change" --rollout 5 --dry-run
node releases/NoDupe/publish.mjs 2.1.0 .\NoDupe-2.1.0-x64.exe --notes "First change|Second change" --rollout 5

# 3. later: raise the rollout (no seed needed)
node releases/NoDupe/update.mjs 2.1.0 --rollout 25
```

Installers and the signed list live in the public repository [`technowizsolutionsllp/app-releases`](https://github.com/technowizsolutionsllp/app-releases). The website answers the app's update check from that list at `/api/nodupe/updates/v1/check`. How it all fits together: [docs/RELEASES.md](../../docs/RELEASES.md).
