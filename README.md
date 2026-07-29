# Access Shisho Cloud from GitHub Actions

This is a GitHub Action that helps jobs to access Shisho Cloud, either by signing in the shishoctl CLI or by exporting a short-lived access token for other tools.

Visit [the Shisho Cloud docs](https://shisho.dev/docs/g/getting-started/deploy-policies-with-github-actions) for instructions on how to integrate GitHub Actions with Shisho Cloud.

## Usage

Both modes exchange the workflow's OIDC ID token for a short-lived Shisho Cloud access token, so the job needs the `id-token: write` permission and the bot must have a matching trust condition. No long-lived secret is stored in the repository.

### Sign in shishoctl (default)

Signs in via the shishoctl CLI, which must be installed beforehand. Later steps can then run `shishoctl` commands as the bot.

```yaml
permissions:
  id-token: write
steps:
  - uses: flatt-security/shisho-cloud-action@v1
    with:
      bot-id: <bot ID>
```

### Export an access token (`export-token: true`)

Performs the token exchange inside the action — shishoctl is not required — and exposes the access token as a masked step output for non-shishoctl consumers.

```yaml
permissions:
  id-token: write
steps:
  - id: auth
    uses: flatt-security/shisho-cloud-action@v1
    with:
      bot-id: <bot ID>
      export-token: true
      expires-in-minutes: 360
  - run: some-tool --token "${{ steps.auth.outputs.token }}"
```

- `steps.<id>.outputs.token` is the bare access token, masked in run logs. Consumers that require a product-specific prefix add it themselves.
- `steps.<id>.outputs.expires-at` is the expiry time in RFC 3339 UTC.
- The token's lifetime is fixed at exchange time (server default 30 minutes, maximum 24 hours) and the token is not refreshable, so size `expires-in-minutes` to cover the whole job.

## Inputs

| Name                 | Required | Description                                                                                        |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `bot-id`             | yes      | ID of the bot to sign in as.                                                                        |
| `expires-in-minutes` | no       | Expiration time of the access token in minutes. Defaults to the server default.                     |
| `export-token`       | no       | When `true`, export the access token as the `token` output instead of signing in via shishoctl.     |
| `sts-endpoint`       | no       | Custom STS endpoint URL (advanced).                                                                 |
