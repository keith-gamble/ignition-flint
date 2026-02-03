---
title: Development
sidebar_label: Development
---

# Development

This guide covers how to build and publish the Flint extension.

## Prerequisites

- Node.js 18+
- npm
- VS Code
- `vsce` (Visual Studio Code Extension manager)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/bw-design-group/flint-vscode-extension.git
cd flint-vscode-extension
```

2. Install dependencies:
```bash
npm install
```

## Building

### Development Build

For testing locally:
```bash
npm run compile
```

### Watch Mode

Auto-compile on changes:
```bash
npm run watch
```

## Testing

### Run Extension in Debug Mode

1. Open the project in VS Code
2. Press `F5` to launch a new VS Code window with the extension loaded
3. Test your changes in the new window

### Run Tests

```bash
npm test
```

## Publishing

### Prerequisites for Publishing

1. Install vsce:
```bash
npm install -g @vscode/vsce
```

2. Get a Personal Access Token from Azure DevOps or use your publisher account

### Package the Extension

Create a `.vsix` file:
```bash
vsce package
```

### Publish to Marketplace

```bash
vsce publish
```

Or publish a specific version:
```bash
vsce publish minor  # Bumps minor version
vsce publish major  # Bumps major version
vsce publish 1.2.3  # Specific version
```

### Publish Pre-release

```bash
vsce publish --pre-release
```

## Project Structure

```
flint-vscode-extension/
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── commands/              # Command implementations
│   ├── providers/             # Tree data providers
│   ├── services/              # Core services
│   └── utils/                 # Utility functions
├── package.json               # Extension manifest
├── tsconfig.json              # TypeScript configuration
└── flint.config.json         # Example configuration
```

## Key Files

- `package.json` - Extension manifest with commands, settings, and dependencies
- `src/extension.ts` - Main entry point that registers commands and providers
- `flint.config.json` - Example configuration for testing

## Making Changes

1. Make your changes
2. Run `npm run compile` to build
3. Test in debug mode (`F5`)
4. Run `npm run lint` to check code style
5. Commit and push your changes

## Version Management

The version is managed in `package.json`. Follow semantic versioning:
- **Major**: Breaking changes
- **Minor**: New features
- **Patch**: Bug fixes

## Useful Commands

```bash
# Clean and rebuild
npm run clean && npm run compile

# Run linter
npm run lint

# Package for distribution
vsce package

# Show extension info
vsce show bw-design-group.ignition-flint
```

## Troubleshooting

### Build Errors

1. Delete `node_modules` and `package-lock.json`
2. Run `npm install` again
3. Make sure TypeScript version matches `tsconfig.json`

### Publishing Errors

1. Ensure you're logged in: `vsce login your-publisher-name`
2. Check your Personal Access Token is valid
3. Verify version number is higher than published version

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

For more details, see the [repository](https://github.com/bw-design-group/flint-vscode-extension).