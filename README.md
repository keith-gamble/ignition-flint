# Flint for Ignition VS Code Extension

Flint for Ignition enriches the development experience on the Ignition platform by providing specialized tools directly within Visual Studio Code. This extension aims to streamline the workflow of developers working with Ignition projects, offering functionalities that cater specifically to the nuances of scripting and configuration in Ignition.

## Download the Extension

- **[Flint for Ignition on the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Keith-gamble.ignition-flint)**

## Key Features

### Enhanced Script Editing
Editing scripts embedded within JSON configurations is a common task in Ignition projects. Flint for Ignition simplifies this process by automatically decoding Python scripts from JSON files for editing. It leverages VS Code's powerful editing features, such as syntax highlighting and IntelliSense, to offer a superior coding experience. Once edited and saved, the extension re-encodes and updates the original JSON file, ensuring a seamless workflow.

### Gateway Backup Management with Kindling
Flint for Ignition integrates with Kindling, a utility created by Inductive Automation for managing Ignition gateway backups. This feature allows developers to effortlessly open and interact with `.gwbk` files directly from VS Code, enhancing the ease of gateway backup management.

- **Using the Feature**: Right-click on a `.gwbk` file within VS Code, and select "Open with Kindling" to initiate. This seamless integration facilitates the exploration and modification of gateway backups, streamlining project management tasks.

### Broad Scripting Support
The extension offers comprehensive support for various Ignition script types, including script actions, script transforms, custom methods, message handlers, and tag event scripts. This broad support ensures developers can efficiently manage and edit a wide range of scripting tasks within their Ignition projects.

## Installation and Usage

1. **Install the Extension**: Find "Flint for Ignition" in the Extensions view (`Ctrl+Shift+X`) in VS Code and install it.

2. **Editing Scripts**: In a JSON file, navigate to a script line, click the lightbulb icon or press `Ctrl+.` to open the edit options, and select the appropriate action (e.g., "Edit Script Transform"). The script will open in a new editor tab for easy editing.

3. **Saving Edits**: Save your changes in the editor to automatically re-encode and update the original JSON file.

4. **Managing Gateway Backups**: Right-click a `.gwbk` file and choose "Open with Kindling" for direct access to backup management features.

## Kindling: A Closer Look

Kindling, developed by Inductive Automation, is designed to simplify the interaction with Ignition gateway backups. By integrating Kindling with Flint for Ignition, developers gain a powerful toolset for navigating and managing `.gwbk` files directly within their preferred development environment.

- **Getting Started with Kindling**: Download Kindling from its [official download page](https://inductiveautomation.github.io/kindling/download.html) to enhance your Ignition project management capabilities.

## Feedback, Contributions, and Further Information

We encourage the community to share feedback and contribute to Flint for Ignition's development. If you have suggestions, questions, or encounter any issues, please reach out through our [GitHub repository](https://github.com/keith-gamble/ignition-flint).

## Licensing

Flint for Ignition is released under the MIT License. Detailed licensing information can be found in the [LICENSE](https://github.com/keith-gamble/ignition-flint/blob/main/LICENSE) file in the GitHub repository.

---

Flint for Ignition seeks to provide a robust, efficient, and enjoyable development experience for Ignition platform projects. With its focus on easing script editing and enhancing project management through Kindling integration, this extension is an invaluable tool for any developer working in the Ignition ecosystem.