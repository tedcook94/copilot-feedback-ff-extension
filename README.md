# Copilot PR Comment Copier

A Firefox extension that adds "Copy" buttons to GitHub Copilot review comments on pull requests, making it easy to copy individual comments or all unresolved comments as Markdown.

## Features

- **Copy individual comments** via a button in each Copilot comment header
- **Copy all unresolved comments** with one click using the floating button in the bottom-right corner
- Copies as clean Markdown with file paths, line references, and code suggestions formatted as diffs
- Excludes the Copilot summary/overview comment
- Automatically detects new comments loaded dynamically (lazy loading, SPA navigation)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (for `web-ext`)

### Loading as a temporary extension (for development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file from this directory
4. Navigate to any GitHub PR with Copilot review comments

Temporary extensions are removed when Firefox restarts.

### Building the `.zip` package

```sh
npx web-ext build --source-dir . --overwrite-dest
```

This produces a `.zip` file in `web-ext-artifacts/`.

### Linting

```sh
npx web-ext lint --source-dir .
```

## Publishing / Getting a signed `.xpi`

Firefox requires extensions to be signed by Mozilla for permanent installation. To get a signed `.xpi`:

1. Go to the [AMO Developer Hub](https://addons.mozilla.org/developers/addons)
2. Log in (or create an account)
3. Click **"Upload New Version"** on your extension's page (or **"Submit a New Add-on"** for first-time upload)
4. Choose **"On your own"** for self-distribution (unlisted)
5. Upload the `.zip` file from `web-ext-artifacts/`
6. Once approved, click on the version number on the **"Manage Status & Versions"** page to download the signed `.xpi` file

### Installing the signed `.xpi`

- Drag the `.xpi` file into a Firefox window, **or**
- Go to `about:addons`, click the gear icon, and select **"Install Add-on From File..."**
