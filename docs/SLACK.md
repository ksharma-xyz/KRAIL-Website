# krail-claude-bot

One Slack bot, used by every repo, so updates from any of them land in
the same place and look the same.

It is not specific to the Journal. The daily publish is the first thing
using it; a failed nightly build, a release, a scheduled report are all
the same shape of message and use the same action.

---

## Why a bot and not an incoming webhook

A webhook URL is tied to one channel and can only post. A bot token can
post to any channel, reply in threads, and be moved to a different
channel by changing one repo variable instead of regenerating a URL.
It is also one secret to rotate rather than one per channel.

---

## Setting it up, once

### 1. Create the app

Go to <https://api.slack.com/apps>, **Create New App**, **From an app
manifest**, pick the workspace, and paste this:

```yaml
display_information:
  name: krail-claude-bot
  description: Posts build, publish and release updates from GitHub Actions.
  background_color: "#0B0B0D"
features:
  bot_user:
    display_name: krail-claude-bot
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.public
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
  is_hosted: false
```

`chat:write.public` is what lets it post to a public channel without
being invited to it first. For a private channel you still have to
invite it: `/invite @krail-claude-bot`.

### 2. Install it and take the token

**Install to Workspace**, then copy the **Bot User OAuth Token**. It
starts `xoxb-`. That is the only secret involved.

### 3. Give it to the repos that need it

This account is a user rather than an organisation, so there are no
org-level secrets to inherit. The same token goes into each repo once:

```sh
for repo in KRAIL-Website KRAIL krail-shorts; do
  gh secret set SLACK_BOT_TOKEN --repo "ksharma-xyz/$repo"
done
```

It prompts for the value each time. Paste the same `xoxb-` token.

### 4. Pick the channel, optionally

The workflows default to `krail-dev-hq`. To send a repo somewhere else
without touching a workflow file:

```sh
gh variable set SLACK_CHANNEL --body krail-fb-posts --repo ksharma-xyz/KRAIL-Website
```

---

## Using it from a workflow

In this repo:

```yaml
- uses: ./.github/actions/slack-notify
  with:
    token: ${{ secrets.SLACK_BOT_TOKEN }}
    channel: ${{ vars.SLACK_CHANNEL || 'krail-dev-hq' }}
    text: New on the Journal
    title: Berowra to Cowan, two stations and a free ferry
    url: https://krail.app/blog/berowra-to-cowan-without-a-car/
    context: 4 queued behind it
```

From any other repo, public or private, by full path:

```yaml
- uses: ksharma-xyz/KRAIL-Website/.github/actions/slack-notify@main
  with:
    token: ${{ secrets.SLACK_BOT_TOKEN }}
    channel: krail-dev-hq
    text: Nightly build failed
    title: Nightly build failed
    url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    status: fail
```

A public repo's action can be used from a private one, so `krail-shorts`
can call this without anything being duplicated or made public.

### Inputs

| Input | Required | What it does |
| --- | --- | --- |
| `token` | yes | The `xoxb-` token, always from a secret |
| `channel` | yes | Name without the hash, or a channel ID |
| `text` | yes | Notification preview and screen reader fallback. Not rendered in the message, so it can repeat the title |
| `title` | no | Headline. Becomes a link when `url` is set |
| `url` | no | Link for the title |
| `body` | no | A paragraph under the headline |
| `context` | no | Smaller grey line, for counts and next steps |
| `status` | no | `ok`, `warn` or `fail`. Sets the colour down the left edge |
| `thread_ts` | no | Reply in a thread instead of posting to the channel |
| `blocks` | no | Raw Block Kit JSON, when the above is not enough |

It outputs `ts`, the posted message's timestamp, so a later step can
thread a reply onto it.

### It fails loudly

Slack answers `200` with `ok: false` for a bad token, a channel the bot
is not in, or a malformed block. The action checks that field and fails
the step with the error Slack gave. Without it a broken notification is
a green tick and a message nobody ever sees.

Steps that post to Slack carry `continue-on-error: true`, so a Slack
outage never fails a publish. The post still goes out, you just do not
get told about it in Slack.

---

## What not to send

The rule from `CLAUDE.md` about outward-facing artifacts applies here.
No user counts, retention, revenue, ratings, install counts or anything
personal in a Slack message, because the message is built in a public
repo's workflow file and the text often ends up in a run log that is
public too. Link to the page and let the dashboard hold the numbers.
