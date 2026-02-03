# Flint for Ignition

A powerful VS Code extension for working with Ignition SCADA/HMI projects, providing a comprehensive project browser, resource management, and development tools.

![Version](https://img.shields.io/badge/version-0.0.1--SNAPSHOT-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-^1.75.0-blue.svg)

## Features

### Debugging with Designer Bridge

Flint supports full Python debugging when used with the [Flint Designer Bridge](https://github.com/bw-design-group/flint-designer-bridge) module:

- **Breakpoints**: Set breakpoints in your Python scripts and pause execution
- **Step debugging**: Step over, into, and out of functions
- **Variable inspection**: View local and global variables at any breakpoint
- **Debug console**: Execute Python expressions in the current debug context
- **Output capture**: See print statements and errors in the VS Code debug console

To enable debugging:
1. Install the [Flint Designer Bridge](https://github.com/bw-design-group/flint-designer-bridge) module on your Ignition gateway
2. Launch a Designer instance
3. Flint will automatically detect the running Designer
4. Set breakpoints and start debugging from VS Code

### Project Browser
- **Hierarchical tree view** of all Ignition project resources
- **Multiple project support** with easy switching between projects
- **Inherited resource visualization** from parent projects
- **Resource categorization** by type (Scripts, Views, Named Queries, etc.)
- **Missing resource.json detection** with quick-fix actions
- **Tree state persistence** across sessions

### Resource Management
- **Create, rename, delete, and duplicate** resources directly from VS Code
- **Resource templates** for quick creation of common resource types
- **Bulk operations** for managing multiple resources
- **Resource validation** to ensure proper structure
- **Copy resource paths** for easy reference

### Gateway Integration
- **Multiple gateway support** with environment configurations (dev/staging/prod)
- **Quick access** to gateway webpage and designer
- **Project synchronization** with gateway
- **Status monitoring** in the status bar

### Search & Navigation
- **Fast resource search** across all projects
- **Content search** within resource files
- **Search history** for quick access to recent searches
- **Type-specific search** filters
- **Quick navigation** to any resource

### Development Tools
- **Advanced Python IntelliSense**:
  - Full autocompletion for Ignition system.* functions
  - Project script module autocompletion with inheritance
  - Automatic stub downloading based on gateway version
  - Function signatures, parameters, and documentation
- **Named query editor** with SQL support
- **Perspective view** JSON editing
- **Resource.json validation** and auto-generation
- **External tool integration** (Kindling, Designer Launcher)

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Flint for Ignition"
4. Click Install

### Installing Pre-release Versions
Pre-release versions (RC builds) are available for testing new features:
1. Find the extension in the Marketplace
2. Click the dropdown arrow next to "Install"
3. Select "Install Pre-Release Version"

Or via command line:
```bash
code --install-extension bwdesigngroup.flint-for-ignition --pre-release
```

### From VSIX File
1. Download the latest `.vsix` file from the releases page
2. Open VS Code
3. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
4. Click the "..." menu → Install from VSIX
5. Select the downloaded file

## Release Versions

Flint uses semantic versioning with release candidates for pre-release testing:

| Version Type | Example | Description |
|--------------|---------|-------------|
| Stable | `0.10.0` | Production-ready releases |
| Pre-release | `0.10.0-RC1` | Release candidates for testing |

Pre-release versions are published to the VS Code Marketplace with the pre-release flag, allowing users to opt-in to test new features before stable release.

## Quick Start

### 1. Initial Configuration
After installing Flint, you'll need to configure your workspace:

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run `Flint: Get Started with Flint`
3. Follow the setup wizard to:
   - Add your project paths
   - Configure gateway connections
   - Set up environments

### 2. Manual Configuration
Alternatively, create a `flint.config.json` file in your workspace root:

```json
{
  "schemaVersion": "0.2",
  "project-paths": [
    "/path/to/ignition/data/projects"
  ],
  "gateways": {
    "local-dev": {
      "description": "Local Development Gateway",
      "projects": ["MyProject", "TestProject"],
      "environments": {
        "dev": {
          "host": "localhost",
          "port": 8088,
          "ssl": false
        }
      }
    }
  }
}
```

Flint supports multiple configuration file locations. See [Configuration File Locations](#configuration-file-locations) for details.

### 3. Using the Project Browser
1. Open the Flint Project Browser in the Explorer sidebar
2. Select a gateway from the dropdown
3. Select a project to browse
4. Click on any resource to open it

## Python Development Features

### Ignition System Functions
Flint provides complete IntelliSense support for Ignition's built-in system functions:

- **Automatic stub downloading**: When you first type `system.`, Flint will prompt to download the appropriate Python stubs for your gateway version
- **Complete module hierarchy**: All system modules are available (system.util, system.db, system.tag, etc.)
- **Rich documentation**: Function signatures, parameter hints, and documentation are displayed
- **Offline support**: Downloaded stubs are cached locally for offline development

### Project Script Modules
Full autocompletion for your custom project script modules:

- **Hierarchical module structure**: Navigate through nested folder structures
- **Inheritance support**: Access modules from parent projects
- **Cross-module references**: Import and use functions from other modules
- **Real-time updates**: Changes to script modules are immediately reflected in IntelliSense

### Gateway Version Support
Configure the Ignition version in your gateway settings to get version-specific autocompletion:

```json
{
  "gateways": {
    "my-gateway": {
      "ignitionVersion": "8.1.33",
      // ... other settings
    }
  }
}
```

## Configuration Options

### VS Code Settings
Configure Flint through VS Code settings (File → Preferences → Settings):

| Setting | Default | Description |
|---------|---------|-------------|
| `flint.showInheritedResources` | `true` | Show/hide inherited resources |
| `flint.groupResourcesByType` | `true` | Group resources by type |
| `flint.autoRefreshProjects` | `true` | Auto-refresh on file changes |
| `flint.showEmptyResourceTypes` | `false` | Show resource types with no resources |
| `flint.has83DesignerLauncher` | `false` | Enable 8.3+ Designer Launcher support |
| `flint.kindlingExecutablePath` | `""` | Path to Kindling executable for backup viewing |
| `flint.configPath` | `""` | Custom path to the Flint configuration file |
| `flint.localConfigPath` | `""` | Custom path to a local override config file |

### Configuration File Locations

Flint searches for configuration files in the following locations (in priority order, highest first):

1. **Custom path** (if `flint.configPath` setting is set)
2. `flint.config.json` (workspace root)
3. `.flint/config.json`
4. `.flint-config.json`
5. `.vscode/flint.config.json`

This flexibility allows you to:
- Keep configs in a `.flint/` directory for a cleaner workspace root
- Use `.vscode/flint.config.json` alongside other VS Code configurations
- Specify a custom location via VS Code settings

### Local Override Files

Flint supports local override configuration files that are merged with the base configuration. This is useful for:
- Developer-specific settings (local gateway hosts, ports)
- Environment-specific overrides that shouldn't be version controlled
- Testing different configurations without modifying the main config

**Local config search order:**

1. **Custom path** (if `flint.localConfigPath` setting is set)
2. `flint.local.json` (sibling to base config)
3. `.flint/config.local.json`

**Example Setup:**

Base config (`flint.config.json` - version controlled):
```json
{
  "schemaVersion": "0.2",
  "project-paths": ["./projects"],
  "gateways": {
    "production": {
      "host": "prod.example.com",
      "port": 8088,
      "ssl": true
    }
  }
}
```

Local override (`flint.local.json` - gitignored):
```json
{
  "gateways": {
    "production": {
      "host": "localhost",
      "port": 8088
    }
  }
}
```

**Merge behavior:**
- **Objects** (gateways, settings): Deep merged, local values override base
- **Arrays** (project-paths): Local array replaces base array entirely
- **schemaVersion**: Always uses base config's version (local doesn't need to specify)

> **Tip:** Add `flint.local.json` and `.flint/config.local.json` to your `.gitignore` file.

### Gateway Configuration
Each gateway in `flint.config.json` supports:
- Multiple projects
- Multiple environments (dev, staging, prod)
- Custom host, port, and SSL settings per environment
- API token authentication (8.3+)

## Keyboard Shortcuts

| Command | Windows/Linux | macOS |
|---------|--------------|-------|
| Search Resources | Ctrl+Shift+R | Cmd+Shift+R |
| Find in Resources | Ctrl+Shift+Alt+F | Cmd+Shift+Alt+F |

## Supported Resource Types

- **Python Scripts** - Project library scripts with full IntelliSense:
  - Ignition system function autocompletion (system.*, system.util.*, etc.)
  - Custom project module autocompletion with inheritance
  - Function signatures, parameters, and documentation
- **Named Queries** - SQL queries with parameter management
- **Perspective Views** - UI views with component hierarchy
- **Perspective Styles** - CSS style classes
- **Perspective Sessions** - Session properties and events
- **Page Configurations** - Perspective page settings

## External Tool Integration

### Kindling
View Ignition backup files (.gwbk, .modl, .idb):
1. Install [Kindling](https://github.com/ia-eknorr/kindling)
2. Right-click on backup files → "Open with Kindling"

### Designer Launcher
Launch the Ignition Designer directly from VS Code:
1. Install Ignition Designer Launcher (8.3+)
2. Click on gateway node → "Open Designer"

## Troubleshooting

### Project Browser is Empty
- Check that a config file exists in one of the [supported locations](#configuration-file-locations)
- Verify project paths are correct and accessible
- Ensure at least one gateway is configured
- Check the VS Code Output panel (View → Output → select "Flint") for errors

### Configuration Not Loading
- Verify JSON syntax is valid (VS Code will show errors for invalid JSON)
- Check that the `schemaVersion` field is present in the base config
- If using a custom config path, verify the path is correct
- Check if a local override file has invalid structure

### Local Override Not Working
- Ensure the local config file is in the correct location (sibling to base config or in `.flint/`)
- Verify the local config contains valid JSON
- Check that property names match the base config exactly (e.g., `gateways`, not `gateway`)
- Local configs don't require `schemaVersion` - it's inherited from the base

### Resources Not Showing
- Check file permissions on project directories
- Verify project.json exists in project root
- Try refreshing projects (refresh button in toolbar)

### Search Not Working
- Ensure projects have been scanned (may take a moment on first load)
- Check that resource files are not corrupted
- Clear search history if experiencing issues

## Known Limitations

- Some complex Perspective view structures may not display correctly in the tree
- Large projects (>10,000 resources) may experience slower initial scanning
- Python stub downloads require internet connection on first use per version

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup
1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press F5 to launch a development instance

### Code Quality Tools

#### Pre-commit Hooks
This project uses pre-commit hooks to ensure code quality before commits. The hooks are automatically installed when you run `npm install`.

The pre-commit hooks will:
- Run ESLint to check TypeScript/JavaScript code quality
- Fix auto-fixable linting issues
- Format code with Prettier
- Ensure all files pass linting with zero errors and warnings

To bypass pre-commit hooks in exceptional cases (not recommended):
```bash
git commit --no-verify -m "your message"
```

#### Manual Code Quality Checks
```bash
npm run lint        # Check code style
npm run lint:fix    # Auto-fix linting issues
npm run prettier    # Format code with Prettier
npm test           # Run all tests
```

### Running Tests
```bash
npm test                    # Run all tests
npm run test:unit          # Run unit tests only
npm run test:integration   # Run integration tests only
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/bw-design-group/flint-vscode-extension/issues)
- **Documentation**: [Wiki](https://github.com/bw-design-group/flint-vscode-extension/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/bw-design-group/flint-vscode-extension/discussions)

## Related Projects

- [Flint Designer Bridge](https://github.com/bw-design-group/flint-designer-bridge) - Ignition module that enables debugging and script execution

## Acknowledgments

- Built for the Ignition SCADA platform by Inductive Automation
- Inspired by the needs of the Ignition developer community
- Special thanks to all contributors and testers

---

**Note**: This extension is not officially affiliated with Inductive Automation. Ignition is a trademark of Inductive Automation.