# Copy to dev/local.ps1 (git-ignored) and fill in. deploy.ps1 and backup.ps1 dot-source it.
# Keep real host names, addresses and logins out of the repository.
$D20NasHost    = 'user@your-docker-host'        # ssh target that runs the dev container
$D20FoundryUrl = 'http://your-docker-host:30000' # where the dev Foundry instance answers
$D20NasBase    = '/mnt/user/appdata/foundry-dev' # folder on the host: app/ env/ data/ backups/
