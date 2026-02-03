---
title: Features
sidebar_label: Features
---

# Features

Flint provides powerful tools for working with Ignition projects in VS Code.

## Merge Conflict Resolution

When working with Git and Ignition projects, merge conflicts can occur in JSON files that contain encoded Python scripts. These scripts are stored as base64-encoded strings, making traditional merge tools ineffective.

Flint provides a custom merge editor that decodes these scripts, allowing you to compare and merge them as readable Python code.

### Detecting Script Conflicts

When you open a JSON file with merge conflicts containing encoded scripts (like `script` or `code` fields), Flint automatically detects them and shows a Code Lens action above the conflict:

![Code Lens showing Compare Decoded Scripts action](/img/screenshots/compare-decoded-scripts-codelens.png)

Click **"Flint: Compare Decoded Scripts"** to open the merge editor.

### The Merge Editor

The merge editor provides a 3-panel view similar to VS Code's native merge editor:

![Merge editor showing three panels for conflict resolution](/img/screenshots/decoded-screenshot-comparison.png)

**Panel Layout:**
- **Top Left (Current)**: The script from your current branch (HEAD)
- **Top Right (Incoming)**: The script from the branch being merged
- **Bottom (Result)**: The final merged script that will be saved

**Features:**
- Full Python syntax highlighting powered by Monaco Editor
- All three panels are editable
- Function definition wrapper shown for context (e.g., `def runAction(self, event):`)
- File path displayed in the header for easy identification

### Resolving Conflicts

You have several options for resolving the conflict:

1. **Use This Version**: Click the "Use This Version ↓" button under either the Current or Incoming panel to copy that entire script to the Result panel

2. **Manual Edit**: Edit the Result panel directly to create a custom merge of both versions

3. **Edit Any Panel**: All panels are editable, so you can make changes to Current or Incoming before copying to Result

When you're satisfied with the Result:
- Click **Accept Result** to save the resolved conflict
- The script will be encoded and written back to the JSON file
- The conflict markers will be removed

**Keyboard Shortcuts:**
- `Ctrl/Cmd + Enter`: Accept Result
- `Escape`: Cancel

### Important Notes

- The function definition line (e.g., `def runAction(self, event):`) is for context only and should not be modified. If changed, an error will be shown.
- The merge editor preserves JSON formatting including trailing commas
- After resolving, the file will be updated but not saved automatically - review the changes before saving

## Project Browser

Browse your Ignition project resources directly in VS Code's explorer panel:

- View all resource types (Views, Scripts, Named Queries, etc.)
- See inherited resources from parent projects
- Quick navigation to resource files

## Resource Management

Manage your project resources without leaving VS Code:

- **Create** new resources with proper templates
- **Rename** resources with automatic reference updates
- **Delete** resources with confirmation
- **Duplicate** resources for quick copying

## Search

Find resources quickly across your projects:

- Search by resource name
- Search within resource content
- Filter by resource type
- Search history for quick access to previous searches

## Tool Integration

Integrate with other Ignition development tools:

- **Designer Launcher**: Open projects directly in Ignition Designer
- **Kindling**: View gateway backups and log files
- **Gateway Navigation**: Quick links to gateway web interface
