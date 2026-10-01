# Cloudflare Status Page — static, free-tier, zero dependencies

A self-hosted status page that runs **entirely as static files** on Cloudflare Pages' free tier — uptime bars, incident history, custom domain — with a zero-dependency uptime checker you can cron from anywhere (GitHub Actions included).

**Live demo:** https://zicula.trade/status-demo/ (checks run in real time from your browser)

## Why

Hosted status pages cost $20–99/month per brand. Uptime Kuma is great but needs a server to babysit and isn't white-label. This takes a different cut: **the whole page is static**, so hosting is literally free, and the checks are just a script you schedule wherever you already run cron.

## What's inside

```
status-page/        the page itself (HTML/CSS/JS + config + data files)
uptime/uptime-check.mjs   zero-dependency checker (Node 18+, no npm install)
uptime/github-actions.yml GitHub Actions workflow: check every 15 min + commit + optional deploy
uptime/crontab-example.txt cron alternative
editor/index.html   local incident editor (open in a browser, edit, export JSON)
```

## Quick start (GitHub Actions — recommended)

1. Create a new repo from these files (or use the button above)
2. Edit `status-page/config.json` — your services, name, domain
3. Copy `uptime/github-actions.yml` to `.github/workflows/uptime.yml`
4. Enable **Settings → Pages → Source: GitHub Actions**

That's it: every 15 minutes the checker runs, commits fresh `uptime.json`, and republishes the page. Free, forever.

## Quick start (cron)

```cron
*/15 * * * * cd /path/to/repo && node uptime/uptime-check.mjs && git commit -am "uptime update" && git push
```

## Deploy to Cloudflare Pages

[![Deploy to Cloudflare](https://deploy.cloudflare.com/button.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/zicula/cloudflare-status-page)

Point the Pages project at your custom domain and you have a branded status page with $0/month hosting.

## The packaged kit

This repo is the free, MIT-licensed core. If you want the guided path — step-by-step setup docs, a local incident editor tuned for client work, print-ready incident reports, and lifetime v1.x updates — that's the [Status Page Self-Host Kit ($42, one-time)](https://zicula.gumroad.com/l/status-page-kit).

## License

MIT — use it, fork it, sell it, no attribution needed.
