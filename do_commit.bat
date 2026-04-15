@echo off
cd /d c:\HCS\edguard-v2
git add src/services/api.ts src/services/sessionApi.ts
git commit -m "fix: update API fallback URL to fly.dev"
git push
echo DONE_EDGUARD > c:\HCS\edguard-v2\commit_done.txt
