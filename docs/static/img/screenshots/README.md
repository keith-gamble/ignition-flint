# Screenshot Placeholders

This directory contains placeholder references for screenshots used in the Flint documentation. Replace these with actual screenshots when available.

## Required Screenshots

### Getting Started
- [ ] `extensions-view.png` - VS Code Extensions view showing Flint
- [ ] `installed-extension.png` - Flint shown in installed extensions
- [ ] `activity-bar-icon.png` - Flint icon in VS Code activity bar
- [ ] `status-bar.png` - Flint status bar items
- [ ] `setup-wizard.png` - Initial setup wizard dialog
- [ ] `gateway-selection.png` - Gateway selection dropdown
- [ ] `project-browser.png` - Main project browser tree view
- [ ] `edit-script.png` - Python script being edited
- [ ] `search-results.png` - Search results panel

### Features
- [ ] `project-browser-full.png` - Full project browser with all resource types
- [ ] `context-menu.png` - Right-click context menu on resource
- [ ] `filter-box.png` - Filter box in action
- [ ] `project-selector.png` - Project selection dropdown
- [ ] `resource-icons.png` - All resource type icons
- [ ] `multi-environment.png` - Environment switcher
- [ ] `kindling-integration.png` - Kindling viewing a backup file

### Configuration
- [ ] `config-editor.png` - flint.config.json being edited
- [ ] `gateway-config.png` - Gateway configuration UI
- [ ] `environment-setup.png` - Environment configuration
- [ ] `workspace-settings.png` - VS Code workspace settings for Flint

### Resource Editors
- [ ] `python-editor.png` - Python script with IntelliSense
- [ ] `sql-editor.png` - Named Query SQL editor
- [ ] `json-editor.png` - Perspective view JSON editor
- [ ] `style-editor.png` - Style class editor

### Commands
- [ ] `command-palette.png` - Command palette with Flint commands
- [ ] `quick-pick.png` - Quick pick selection UI
- [ ] `status-updates.png` - Status bar update notifications

## Screenshot Guidelines

When creating screenshots:

1. **Resolution**: 1920x1080 or higher, crop to relevant area
2. **Theme**: Use default VS Code dark theme for consistency
3. **Content**: Use generic/sample data, avoid sensitive information
4. **Annotations**: Add arrows/boxes in red (#FF6B35) when highlighting
5. **Format**: PNG for UI screenshots, GIF for animations
6. **Naming**: Use descriptive lowercase names with hyphens

## Tools for Screenshots

Recommended tools:
- **Windows**: Snipping Tool, ShareX, Greenshot
- **macOS**: CleanShot X, Shottr, built-in screenshot tool
- **Linux**: Flameshot, Spectacle, GNOME Screenshot
- **Cross-platform**: Snagit, Lightshot

## Creating Placeholder Images

To create placeholder images while developing:

```bash
# Create a simple placeholder using ImageMagick
convert -size 800x600 xc:gray -pointsize 48 \
  -draw "text 200,300 'Screenshot Placeholder'" \
  placeholder.png

# Or use a placeholder service
curl -o placeholder.png "https://via.placeholder.com/800x600.png?text=Screenshot+Coming+Soon"
```

## Image Optimization

Before committing screenshots:

```bash
# Optimize PNG files
optipng -o7 *.png

# Or use pngquant for lossy compression
pngquant --quality=85-95 *.png

# For batch processing
find . -name "*.png" -exec optipng -o7 {} \;
```