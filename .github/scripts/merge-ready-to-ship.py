#!/usr/bin/env python3
"""
merge-ready-to-ship.py — INDEPENDENT merge backstop for the engineering pipeline.

Runs as a scheduled GitHub Actions workflow (merge-ready-to-ship.yml) on
GitHub's infrastructure, completely independent of the mini orchestrator's
`linear-promote-check.py` cron. If that cron dies (gateway restart, Linear API
outage, the mini going down), this workflow still merges Ready to Ship tickets.

It is a BACKSTOP, not a replacement: it only acts on tickets whose repo is the
repo this workflow runs in (passed as REPO). It reuses an open staging->main
promo PR if one exists (GitHub permits only one per base/head), re-arms
auto-merge (idempotent), and only raises a new promo PR if none is open — so it
never double-raises against the promotion driver.

Stateless by design: every operation is idempotent at the GitHub level, so the
ephemeral Actions container needs no state file.

Required env:
  LINEAR_API_KEY   Linear API key (repo secret)
  GITHUB_TOKEN     provided automatically by Actions
  REPO             the repo this workflow runs in (e.g. "reflectify")
  GITHUB_ORG       org (default josephdanielhill)
"""
import json, os, re, subprocess, sys, urllib.request

GITHUB_ORG = os.environ.get("GITHUB_ORG", "josephdanielhill")
REPO = os.environ.get("REPO", "").strip()
if not REPO:
    print("ERROR: REPO env not set", file=sys.stderr)
    sys.exit(1)

# ── Linear constants (mirror pipeline_config.py — kept inline so this script
#    is self-contained and runs on GitHub without the mini's files) ─────────
BLD_TEAM_ID = "51d0986a-2686-40bf-b22d-47b960e7b52c"
READY_TO_SHIP_ID = "1d1a9eeb-53d1-402a-a179-e063db13977e"
DONE_STATE_ID = "c1acb116-df76-447b-9bdb-65cba23dc2f7"

# Repos that DON'T use a staging branch (feature branches merge straight to main).
MAIN_DIRECT_REPOS = {"deck-crm"}
# Repos that DO use the staging->main promotion model.
STAGING_REPOS = {
    "reflectify", "crewcall", "canban", "milo", "weeklie",
    "josephhillco", "kostly",
}
ALL_REPOS = MAIN_DIRECT_REPOS | STAGING_REPOS
TITLE_REPO = {
    "crewcall": "crewcall", "canban": "canban", "milo": "milo",
    "weeklie": "weeklie", "josephhill": "josephhillco",
    "joseph hill": "josephhillco", "reflectify": "reflectify",
    "radar": "reflectify", "deck-crm": "deck-crm", "deckcrm": "deck-crm",
    "kostly": "kostly",
}


def linear_key():
    return os.environ.get("LINEAR_API_KEY", "").strip()


def gql(q):
    key = linear_key()
    if not key:
        print("ERROR: LINEAR_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=json.dumps({"query": q}).encode(),
        headers={"Authorization": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def gh(args):
    r = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=40)
    return r.stdout.strip(), r.returncode, (r.stderr or "").strip()


def pr_url_to_num(pr_url):
    if pr_url and pr_url.startswith("http") and "github.com/" in pr_url:
        tail = pr_url.rstrip("/").split("/")
        if tail and tail[-1].isdigit():
            return tail[-1]
    return None


def repo_from_pr(ident):
    """Resolve the ticket's repo from its own PR on GitHub (robust path)."""
    idl = ident.lower()
    for repo in sorted(ALL_REPOS):
        out, rc, _ = gh(["pr", "list", "--repo", f"{GITHUB_ORG}/{repo}",
                         "--state", "all", "--limit", "50",
                         "--json", "number,title,headRefName,state"])
        if rc != 0 or not out:
            continue
        try:
            prs = json.loads(out)
        except Exception:
            continue
        for pr in prs:
            hay = (f"{pr.get('title','')} {pr.get('headRefName','')}").lower()
            if idl in hay:
                return repo
    return None


def repo_from_test_url(comments):
    for c in comments:
        m = re.search(r"https://(?:[a-z0-9-]+\.)*([a-z0-9-]+)-test\.pages\.dev",
                      c.get("body", ""))
        if m:
            return m.group(1)
    return None


def repo_from_title(title):
    tl = title.lower()
    for kw, repo in TITLE_REPO.items():
        if kw in tl:
            return repo
    return None


def resolve_repo(ident, title, comments):
    return (repo_from_pr(ident)
            or repo_from_test_url(comments)
            or repo_from_title(title))


def find_open_promo_pr(repo):
    """Open staging->main promo PR for repo (GitHub permits only ONE such PR)."""
    out, rc, _ = gh(["pr", "list", "--repo", f"{GITHUB_ORG}/{repo}",
                     "--base", "main", "--head", "staging",
                     "--state", "open", "--json", "number,title,url,mergedAt"])
    if rc != 0 or not out:
        return None
    try:
        prs = json.loads(out)
    except Exception:
        return None
    for pr in prs:
        if not pr.get("mergedAt"):
            return pr
    return None


def find_ticket_pr(repo, ident):
    """Main-direct repos: the ticket's own PR to main (open or merged)."""
    out, rc, _ = gh(["pr", "list", "--repo", f"{GITHUB_ORG}/{repo}",
                     "--base", "main", "--state", "all",
                     "--json", "number,title,url,mergedAt,headRefName,state"])
    if rc != 0 or not out:
        return None
    try:
        prs = json.loads(out)
    except Exception:
        return None
    idl = ident.lower()
    for pr in prs:
        hay = (f"{pr.get('title','')} {pr.get('headRefName','')}").lower()
        if idl in hay:
            return pr
    return None


def arm_auto_merge(repo, pr_url, delete_branch=False):
    """Arm GitHub auto-merge on an open PR. Idempotent — re-arming an already
    armed PR is a no-op. NEVER --delete-branch for staging->main promo PRs
    (the staging integration branch must survive)."""
    num = pr_url_to_num(pr_url)
    if not num:
        return False, "no PR number"
    args = ["pr", "merge", str(num), "--repo", f"{GITHUB_ORG}/{repo}",
            "--squash", "--auto"]
    if delete_branch:
        args.append("--delete-branch")
    _, rc, err = gh(args)
    return rc == 0, (err or "")[:180]


def close_ticket(issue_id):
    try:
        res = gql('mutation{ issueUpdate(id:"%s", input:{ stateId:"%s" }){ success } }'
                  % (issue_id, DONE_STATE_ID))
        return bool(res.get("data", {}).get("issueUpdate", {}).get("success"))
    except Exception:
        return False


def main():
    if not linear_key():
        print("ERROR: LINEAR_API_KEY not set", file=sys.stderr)
        return 1
    # 1. Find Ready to Ship tickets on the BLD team.
    q = ('{ issues(filter:{ state:{ id:{ eq:"%s" } } team:{ id:{ eq:"%s" } } }, '
         'first:20){ nodes { id identifier title url state{ name } '
         'comments(first:20){ nodes{ id body } } } } }'
         % (READY_TO_SHIP_ID, BLD_TEAM_ID))
    try:
        issues = gql(q).get("data", {}).get("issues", {}).get("nodes", [])
    except Exception as e:
        print(f"ERROR: Linear query failed: {e}", file=sys.stderr)
        return 1
    if not issues:
        return 0  # nothing to promote — silent

    acted = []
    for iss in issues:
        ident = iss["identifier"]
        title = iss["title"]
        comments = iss.get("comments", {}).get("nodes", [])
        repo = resolve_repo(ident, title, comments)
        # Only act on tickets that belong to THIS repo.
        if repo != REPO:
            continue

        if repo in MAIN_DIRECT_REPOS:
            # Main-direct: promotion = the ticket's own PR to main.
            ticket_pr = find_ticket_pr(repo, ident)
            if not ticket_pr:
                acted.append(f"{ident}: no PR to main found for {repo}")
                continue
            pr_url = ticket_pr["url"]
            if ticket_pr.get("state") == "MERGED" or ticket_pr.get("mergedAt"):
                if close_ticket(iss["id"]):
                    acted.append(f"{ident}: already shipped via {pr_url}, moved to Done")
                continue
            ok, err = arm_auto_merge(repo, pr_url, delete_branch=True)
            acted.append(f"{ident}: main-direct PR open, auto-merge "
                         + ("armed" if ok else f"FAILED to arm ({err})")
                         + f" -> {pr_url}")
            continue

        # Staging model: promotion = a staging->main promo PR.
        existing = find_open_promo_pr(repo)
        if existing:
            pr_url = existing["url"]
            ok, err = arm_auto_merge(repo, pr_url)
            acted.append(f"{ident}: promo PR open, auto-merge "
                         + ("armed" if ok else f"FAILED to arm ({err})")
                         + f" -> {pr_url}")
        else:
            body = (f"Promotion: `{ident}` — {title}\n\n"
                    f"Approved in Linear via **Ready to Ship**. "
                    f"Merging promotes the staging build to live.\n\n"
                    f"_(raised by the independent merge backstop)_")
            out, rc, err = gh(["pr", "create", "--repo", f"{GITHUB_ORG}/{repo}",
                               "--base", "main", "--head", "staging",
                               "--title", f"Promote {ident}: {title[:60]}",
                               "--body", body])
            if rc == 0 and out:
                pr_url = out.splitlines()[-1] if out else out
                if not pr_url.startswith("https://"):
                    pr_url = f"https://github.com/{GITHUB_ORG}/{repo}/pull/{pr_url}"
                ok, aerr = arm_auto_merge(repo, pr_url)
                acted.append(f"{ident}: raised promo PR, auto-merge "
                             + ("armed" if ok else f"FAILED to arm ({aerr})")
                             + f" -> {pr_url}")
            else:
                acted.append(f"{ident}: FAILED to create PR ({err or rc})")

    for a in acted:
        print(a)
    if acted:
        print(f"Merge backstop complete ({len(issues)} ready-to-ship ticket(s), "
              f"{len(acted)} acted on in {REPO}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
