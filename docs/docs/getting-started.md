---
title: Getting Started
sidebar_label: Getting Started
---

# Getting Started

This guide shows you how to set up Flint to browse your Ignition projects.

## Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Flint"
4. Click Install

## Configuration

Create a configuration file in one of the supported locations:

| Location | Description |
|----------|-------------|
| `flint.config.json` | Workspace root (recommended) |
| `.flint/config.json` | In a `.flint` directory |
| `.flint-config.json` | Hidden file in workspace root |
| `.vscode/flint.config.json` | With other VS Code settings |

You can also specify a custom path via the `flint.configPath` VS Code setting.

### Basic Configuration

```json
{
  "schemaVersion": "0.2",
  "project-paths": [
    "path/to/your/ignition-projects"
  ],
  "gateways": {
    "my-gateway": {
      "id": "my-gateway",
      "host": "localhost",
      "port": 8088,
      "ssl": false,
      "projects": ["MyProject"],
      "enabled": true
    }
  }
}
```

### Configuration Fields

**project-paths**: Array of paths to folders containing Ignition projects

**gateways**: Object containing gateway configurations
- `id`: Unique identifier for the gateway
- `host`: Gateway hostname or IP
- `port`: Gateway port (usually 8088 for HTTP, 443 for HTTPS)
- `ssl`: Whether to use HTTPS
- `projects`: List of project names on this gateway
- `enabled`: Whether this gateway is active

### Local Override Files

For developer-specific settings that shouldn't be version controlled, create a local override file:

| Location | Description |
|----------|-------------|
| `flint.local.json` | Sibling to base config |
| `.flint/config.local.json` | In the `.flint` directory |

Local configs are merged with the base config. Example:

**Base config** (`flint.config.json` - version controlled):
```json
{
  "schemaVersion": "0.2",
  "gateways": {
    "production": { "host": "prod.example.com", "port": 8088 }
  }
}
```

**Local override** (`flint.local.json` - gitignored):
```json
{
  "gateways": {
    "production": { "host": "localhost" }
  }
}
```

The merged result uses `localhost` as the host while keeping other base settings.

:::tip
Add `flint.local.json` and `.flint/config.local.json` to your `.gitignore` file.
:::

## Using Flint

### View Your Projects

1. Click the Flint icon in VS Code's Activity Bar (left sidebar)
2. Your projects will appear in the tree view
3. Expand folders to see resources

### Select a Gateway

Click "Select Gateway" in the status bar to switch between configured gateways.

### Refresh Projects

Click the refresh button in the tree view or run "Flint: Refresh Projects" from the Command Palette.

## Example Setup

Here's a complete example for a local Ignition setup:

```json
{
  "schemaVersion": "0.2",
  "project-paths": [
    "C:/Program Files/Inductive Automation/Ignition/data/projects"
  ],
  "gateways": {
    "local": {
      "id": "local",
      "host": "localhost",
      "port": 8088,
      "ssl": false,
      "projects": ["SampleQuickstart"],
      "enabled": true
    }
  },
  "settings": {
    "showInheritedResources": true,
    "groupResourcesByType": true,
    "autoRefreshProjects": true,
    "searchHistoryLimit": 50
  }
}
```

## VS Code Settings

You can customize Flint through VS Code settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `flint.showInheritedResources` | `true` | Show resources from parent projects |
| `flint.groupResourcesByType` | `true` | Group resources by type in the tree |
| `flint.autoRefreshProjects` | `true` | Auto-refresh when files change |
| `flint.showEmptyResourceTypes` | `false` | Show resource types with no items |
| `flint.configPath` | `""` | Custom path to configuration file |
| `flint.localConfigPath` | `""` | Custom path to local override file |

## Troubleshooting

### Projects Not Showing

1. Check your `project-paths` point to valid Ignition project directories
2. Verify the directories contain `project.json` files
3. Try refreshing the project browser

### Configuration Not Found

Flint searches for config files in this order:
1. Custom path (if `flint.configPath` is set)
2. `flint.config.json` (workspace root)
3. `.flint/config.json`
4. `.flint-config.json`
5. `.vscode/flint.config.json`

Run "Flint: Open Configuration" from the Command Palette to create or open your config.

### Local Override Not Working

- Ensure the file is named correctly (`flint.local.json` or `.flint/config.local.json`)
- Verify it's valid JSON
- Check that property names match the base config exactly

### Resources Not Loading

Make sure your project structure is valid. Each resource folder should contain a `resource.json` file.