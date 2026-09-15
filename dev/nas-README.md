# foundry-dev — recovery from nothing

Dev instance of Foundry VTT 13.351 for the `pf2e-d20-session-tracker` module. Source repo on David's PC: `E:\code4fun\Foundry\session_dice` (git). Nothing here is production; the Forge game is.

## Layout
```
/mnt/user/appdata/foundry-dev/
  app/                  deploy-managed by dev/deploy.ps1 (rsync --delete). NEVER hand-edit.
    docker-compose.yml
    module/             the module tree, bind-mounted read-only into the container
  env/foundry-dev.env   FOUNDRY_LICENSE_KEY + FOUNDRY_ADMIN_KEY, mode 600. Not in the repo.
  data/                 the container's /data (owned 99:100): Config/, Data/worlds, Data/systems, Data/modules, Logs/
    container_cache/foundryvtt-13.351.zip   the Linux release; the image installs from it, no foundryvtt.com login
  backups/              foundry-dev-data-<stamp>.tgz from dev/backup.ps1
```

## Rebuild from scratch
1. `mkdir -p /mnt/user/appdata/foundry-dev/{app,env,data/container_cache,data/Data/modules,backups}`
2. Recreate `env/foundry-dev.env` (two lines, see `dev/foundry-dev.env.example` in the repo), `chmod 600`.
3. Copy the Linux release zip to `data/container_cache/foundryvtt-13.351.zip`; `chown -R 99:100 data backups`.
4. From the PC: `.\dev\deploy.ps1 -Init` (ships compose + module, `docker compose up -d`, polls `/api/status`).
5. Browser: http://your-docker-host:30000 → accept the EULA → admin key from the env file → install PF2e 7.12.2 and the modules listed in docs/PLAN.md §1.4 → create or import a world → users GM / PlayerA / PlayerB with passwords.
6. Restore a backup: stop the container, extract `backups/<file>.tgz` into `data/` (it contains `Data/worlds` and `Config`), `chown -R 99:100 data`, start.

## Day to day
- Module code change: `.\dev\deploy.ps1` then reload the browser (css/hbs/json hot-reload without reload).
- Compose change: `.\dev\deploy.ps1 -Compose`. Restart only: `.\dev\deploy.ps1 -Restart`.
- Logs: `docker compose -f /mnt/user/appdata/foundry-dev/app/docker-compose.yml logs --tail=50`
- Port 30000 (LAN + Tailscale). Container name `foundry-dev`, hostname `foundry-dev` (licence-bound, keep stable).
