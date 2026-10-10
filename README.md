# Flockavelli

A public, self-hosted ledger of corruption reports. Anyone can file a report; everyone can browse,
search, filter, and **corroborate** entries. Single container — Node + Express + SQLite + a static
front end. Runs the same on any VPS, so you can pick it up and move it anywhere.

> **Everything filed here is an unverified public allegation, not an established fact.** The app
> ships with a visible disclaimer, per-browser corroboration (no double-counting from one browser),
> rate limiting, owner-delete, and an admin-delete token so unlawful or false posts can be removed.
> A takedown path isn't optional — it's what keeps a transparency site lawful and defensible.

---

## 1. Run it locally (optional, to test on your Mac)

You do **not** need a UTM VM. Either:

**With Docker Desktop:**
```bash
docker compose up --build
# open http://localhost:8080
```

**Without Docker (plain Node ≥ 18):**
```bash
npm install
npm start
# open http://localhost:8080
```

Data is stored in a SQLite file. With Docker it lives in the `flock_data` volume; without Docker it's
`./data/flockavelli.db`. **Back up = copy that file.**

---

## 2. Deploy to a VPS

1. Create a cheap VPS (1 shared vCPU / 1 GB RAM is plenty). Provider options are in §4.
2. On the server, install Docker + git, then:
   ```bash
   git clone <YOUR_REPO_URL> flockavelli && cd flockavelli
   cp .env.example .env && nano .env        # set a long random ADMIN_TOKEN
   docker compose up -d --build
   ```
3. Put TLS in front. Easiest is **Caddy** (auto HTTPS) or Cloudflare. Example Caddyfile:
   ```
   flockavelli.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```
4. Point your domain's DNS at the server (or proxy it through Cloudflare).

---

## 3. "Claude does the lifting" — auto-deploy from the repo

The repo is the source of truth. I (Claude) edit the code and push to the repo on your word; the
server pulls and rebuilds itself. You never hand over the server password.

**One-time, on the server:**
```bash
chmod +x deploy/update.sh
# run the updater every minute via cron:
( crontab -l 2>/dev/null; echo "* * * * * /path/to/flockavelli/deploy/update.sh >> /var/log/flockavelli-deploy.log 2>&1" ) | crontab -
```

Now the loop is: **you tell me what to change → I push to the repo → within a minute the server
rebuilds with the new version.** (Prefer instant deploys over the 1-minute cron? Swap the cron for a
GitHub webhook that runs `update.sh` — ask me and I'll wire it up.)

---

## 4. Hosting for resilience ("hard to take down")

Honest version: nothing is truly takedown-proof, and offshore doesn't erase your own legal exposure.
What actually buys resilience is **portability + redundancy + a clean domain**, because this whole
app redeploys anywhere in minutes:

- **Host:** a provider with a strong free-expression stance and privacy-friendly signup/payment
  (e.g. Iceland-based hosts, or others known for resisting frivolous takedowns). Keep it boring and
  low-profile.
- **Domain:** register at a privacy-respecting registrar; keep DNS easy to move. Consider a backup
  domain.
- **Front:** Cloudflare (or similar) hides the origin IP and absorbs abuse.
- **Backups:** the entire site is this repo + the SQLite file. Automate an off-box copy of the DB
  file; you can rebuild on a new VPS from scratch in ~10 minutes.
- **Moderation:** keep `ADMIN_TOKEN` set so you can remove illegal content fast — that's both the
  right thing and your legal safe-harbor.

The managed "push-button" hosts (Render, Railway, Fly, Vercel) are the *easiest* to auto-deploy to,
but also the *most* takedown-prone (US jurisdiction + strict content policies). Good for iterating
now; not the final home for this. The Docker setup here means moving between them is trivial.

---

## Admin

Delete any report (moderation):
```bash
curl -X DELETE https://yourdomain/api/reports/<id> -H "x-admin-token: $ADMIN_TOKEN"
```
List reports (JSON): `GET /api/reports`. Health: `GET /healthz`.
