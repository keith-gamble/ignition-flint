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
The extension offers comprehensive support for various Ignition script types, including script actions, script transforms, custom methods, message handlers, tag event scripts, and property change scripts. This broad support ensures developers can efficiently manage and edit a wide range of scripting tasks within their Ignition projects.

### Copy as JSON Function
The `Copy as JSON` feature is designed to enhance the development workflow by allowing developers to easily convert Ignition's printed scripting and configuration data into a JSON format suitable for documentation, sharing, or further processing. This functionality recognizes and respects the complexity of Ignition's data structures, ensuring accurate and user-friendly JSON representation.

- **Using the Feature**: Simply select where you would like to add it into a text file, right-click, and select `Copy as JSON`. The extension will convert the selected data into a well-formatted JSON string and copy it to your clipboard, ready for pasting wherever you need it.

### Ignition Project Script Explorer
Flint for Ignition introduces a new explorer view called "Ignition Project Scripts" that provides a hierarchical view of all the scripts in your Ignition projects. This feature enables developers to easily navigate through script resources, packages, and modules, making it more convenient to locate and manage scripts within the project structure.

- **Using the Feature**: Open the "Ignition Project Scripts" view in the VS Code explorer sidebar to access the hierarchical representation of your project's scripts. From here, you can expand and collapse folders, open script files, and perform various actions such as adding, deleting, and renaming script resources.

### Script Element Navigation and Code Completion
Flint for Ignition offers advanced navigation and code completion capabilities for script elements within your Ignition projects. Developers can quickly navigate to specific script elements, such as functions, classes, and methods, using the "Navigate to Script Element" command. Additionally, the extension provides intelligent code completion suggestions based on the project's script structure, making it easier to write and reference code elements.

- **Using the Feature**: To navigate to a specific script element, use the "Navigate to Script Element" command from the command palette or the context menu in the "Ignition Project Scripts" view. Start typing the path to the desired element, and the extension will provide suggestions for auto-completion. Once selected, the corresponding script file will open, and the cursor will be positioned at the specified element.

### Inherited Resource Management
Flint for Ignition introduces functionality to manage inherited resources in Ignition projects. Developers can now easily override inherited script resources, making it convenient to customize and extend functionality while maintaining the project's inheritance structure. The extension also provides options to discard overridden resources and revert to the inherited version when needed.

- **Using the Feature**: In the "Ignition Project Scripts" view, inherited resources are indicated with a special icon. To override an inherited resource, right-click on it and select "Override Inherited Resource." The overridden resource will be created in the current project, allowing you to modify it independently. To discard an overridden resource and revert to the inherited version, right-click on the overridden resource and select "Discard Overridden Resource."

## Installation and Usage

1. **Install the Extension**: Find "Flint for Ignition" in the Extensions view (`Ctrl+Shift+X`) in VS Code and install it.

2. **Editing Scripts**: In a JSON file, navigate to a script line, click the lightbulb icon or press `Ctrl+.` to open the edit options, and select the appropriate action (e.g., "Edit Script Transform"). The script will open in a new editor tab for easy editing.

3. **Saving Edits**: Save your changes in the editor to automatically re-encode and update the original JSON file.

4. **Managing Gateway Backups**: Right-click a `.gwbk` file and choose "Open with Kindling" for direct access to backup management features.

5. **Copying as JSON**: Use the `Copy as JSON` feature to quickly convert unicode json strings from Ignition into JSON format for easy sharing and documentation.

6. **Exploring Project Scripts**: Open the "Ignition Project Scripts" view in the VS Code explorer sidebar to navigate and manage your project's script resources.

7. **Navigating to Script Elements**: Use the "Navigate to Script Element" command to quickly jump to specific script elements within your project.

8. **Managing Inherited Resources**: Override and discard inherited resources using the context menu options in the "Ignition Project Scripts" view.

## Kindling: A Closer Look

Kindling, developed by Inductive Automation, is designed to simplify the interaction with Ignition gateway backups. By integrating Kindling with Flint for Ignition, developers gain a powerful toolset for navigating and managing `.gwbk` files directly within their preferred development environment.

- **Getting Started with Kindling**: Download Kindling from its [official download page](https://inductiveautomation.github.io/kindling/download.html) to enhance your Ignition project management capabilities.

## Feedback, Contributions, and Further Information

We encourage the community to share feedback and contribute to Flint for Ignition's development. If you have suggestions, questions, or encounter any issues, please reach out through our [GitHub repository](https://github.com/keith-gamble/ignition-flint).

## Licensing

Flint for Ignition is released under the MIT License. Detailed licensing information can be found in the [LICENSE](https://github.com/keith-gamble/ignition-flint/blob/main/LICENSE) file in the GitHub repository.

---
