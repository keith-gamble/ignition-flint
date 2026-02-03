/**
 * Setup Wizard Webview Client-Side Logic
 * Handles form state, validation, and communication with the extension
 */
/* eslint-env browser */
/* global acquireVsCodeApi */
(function () {
    // @ts-ignore - vscode is injected by the webview
    const vscode = acquireVsCodeApi();

    // State
    let projectPaths = [];
    let pathResults = []; // Stores scan results per path
    let discoveredProjects = [];
    let gateways = [];
    let gatewayCounter = 0;

    // DOM Elements
    const addFolderBtn = document.getElementById('addFolderBtn');
    const pathList = document.getElementById('pathList');
    const discoveredProjectsSection = document.getElementById('discoveredProjectsSection');
    const discoveredProjectsList = document.getElementById('discoveredProjectsList');
    const gatewaysList = document.getElementById('gatewaysList');
    const addGatewayBtn = document.getElementById('addGatewayBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const submitBtn = document.getElementById('submitBtn');

    // Initialize
    function init() {
        setupEventListeners();
        // Add one gateway by default
        addGateway();
        vscode.postMessage({ command: 'ready' });
    }

    // Event Listeners
    function setupEventListeners() {
        if (addFolderBtn) {
            addFolderBtn.addEventListener('click', function () {
                vscode.postMessage({ command: 'browseFolder' });
            });
        }

        if (addGatewayBtn) {
            addGatewayBtn.addEventListener('click', function () {
                addGateway();
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                vscode.postMessage({ command: 'cancel' });
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', function () {
                submitConfiguration();
            });
        }
    }

    // Add a new gateway
    function addGateway() {
        const index = gatewayCounter++;
        const gateway = {
            index: index,
            name: '',
            url: '',
            ignoreSSLErrors: false,
            projects: []
        };
        gateways.push(gateway);
        renderGateways();
    }

    // Remove a gateway
    function removeGateway(index) {
        gateways = gateways.filter(function (g) {
            return g.index !== index;
        });
        renderGateways();
    }

    // Render all gateway cards
    function renderGateways() {
        if (!gatewaysList) return;

        if (gateways.length === 0) {
            gatewaysList.innerHTML =
                '<div class="empty-state">No gateways configured. Click "Add Gateway" to add one.</div>';
            return;
        }

        let html = '';
        for (let i = 0; i < gateways.length; i++) {
            const gateway = gateways[i];
            const canRemove = gateways.length > 1;

            html += '<div class="gateway-card" data-gateway-index="' + gateway.index + '">';
            html += '  <div class="gateway-card-header">';
            html += '    <h3 class="gateway-card-title">Gateway ' + (i + 1) + '</h3>';
            if (canRemove) {
                html +=
                    '    <button class="gateway-card-remove" data-remove-gateway="' +
                    gateway.index +
                    '">Remove</button>';
            }
            html += '  </div>';

            html += '  <div class="gateway-row">';
            html += '    <div class="form-group">';
            html += '      <label class="form-label">Name</label>';
            html +=
                '      <input type="text" class="form-input gateway-name" data-gateway-index="' + gateway.index + '" ';
            html +=
                '             value="' +
                escapeHtml(gateway.name) +
                '" placeholder="dev-gateway" autocomplete="off" spellcheck="false">';
            html += '    </div>';
            html += '    <div class="form-group">';
            html += '      <label class="form-label">URL</label>';
            html +=
                '      <input type="text" class="form-input gateway-url" data-gateway-index="' + gateway.index + '" ';
            html +=
                '             value="' +
                escapeHtml(gateway.url) +
                '" placeholder="http://localhost:8088" autocomplete="off" spellcheck="false">';
            html += '    </div>';
            html += '  </div>';

            html += '  <div class="checkbox-group">';
            html +=
                '    <input type="checkbox" id="ignoreSSL-' +
                gateway.index +
                '" class="gateway-ssl" data-gateway-index="' +
                gateway.index +
                '"';
            if (gateway.ignoreSSLErrors) {
                html += ' checked';
            }
            html += '>';
            html +=
                '    <label class="checkbox-label" for="ignoreSSL-' +
                gateway.index +
                '">Ignore SSL certificate errors</label>';
            html += '  </div>';

            // Project selection
            html += '  <div class="gateway-projects-section">';
            html += '    <p class="gateway-projects-title">Select projects for this gateway:</p>';
            html += '    <div class="gateway-projects-list">';
            if (discoveredProjects.length === 0) {
                html +=
                    '      <span class="no-projects-message">Add project paths above to see available projects</span>';
            } else {
                for (var j = 0; j < discoveredProjects.length; j++) {
                    var project = discoveredProjects[j];
                    var isChecked = gateway.projects.indexOf(project.name) !== -1;
                    var checkboxId = 'project-' + gateway.index + '-' + j;
                    html += '      <div class="project-checkbox-item">';
                    html += '        <input type="checkbox" id="' + checkboxId + '" class="gateway-project-checkbox" ';
                    html +=
                        '               data-gateway-index="' +
                        gateway.index +
                        '" data-project-name="' +
                        escapeHtml(project.name) +
                        '"';
                    if (isChecked) {
                        html += ' checked';
                    }
                    html += '>';
                    html += '        <label for="' + checkboxId + '">' + escapeHtml(project.name) + '</label>';
                    html += '      </div>';
                }
            }
            html += '    </div>';
            html += '  </div>';

            html += '</div>';
        }

        gatewaysList.innerHTML = html;

        // Add event listeners to the new elements
        setupGatewayEventListeners();
    }

    // Setup event listeners for gateway card elements
    function setupGatewayEventListeners() {
        // Remove buttons
        var removeButtons = document.querySelectorAll('.gateway-card-remove');
        removeButtons.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                var index = parseInt(e.target.getAttribute('data-remove-gateway'), 10);
                removeGateway(index);
            });
        });

        // Name inputs
        var nameInputs = document.querySelectorAll('.gateway-name');
        nameInputs.forEach(function (input) {
            input.addEventListener('input', function (e) {
                var index = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                updateGatewayField(index, 'name', e.target.value);
            });
            input.addEventListener('blur', function (e) {
                var index = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                var name = e.target.value.trim();
                if (name) {
                    vscode.postMessage({
                        command: 'validateGatewayName',
                        name: name,
                        index: index
                    });
                }
            });
        });

        // URL inputs
        var urlInputs = document.querySelectorAll('.gateway-url');
        urlInputs.forEach(function (input) {
            input.addEventListener('input', function (e) {
                var index = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                updateGatewayField(index, 'url', e.target.value);
            });
            input.addEventListener('blur', function (e) {
                var index = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                var url = e.target.value.trim();
                if (url) {
                    vscode.postMessage({
                        command: 'validateGatewayUrl',
                        url: url,
                        index: index
                    });
                }
            });
        });

        // SSL checkboxes
        var sslCheckboxes = document.querySelectorAll('.gateway-ssl');
        sslCheckboxes.forEach(function (checkbox) {
            checkbox.addEventListener('change', function (e) {
                var index = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                updateGatewayField(index, 'ignoreSSLErrors', e.target.checked);
            });
        });

        // Project checkboxes
        var projectCheckboxes = document.querySelectorAll('.gateway-project-checkbox');
        projectCheckboxes.forEach(function (checkbox) {
            checkbox.addEventListener('change', function (e) {
                var gatewayIndex = parseInt(e.target.getAttribute('data-gateway-index'), 10);
                var projectName = e.target.getAttribute('data-project-name');
                toggleGatewayProject(gatewayIndex, projectName, e.target.checked);
            });
        });
    }

    // Update a gateway field
    function updateGatewayField(index, field, value) {
        for (var i = 0; i < gateways.length; i++) {
            if (gateways[i].index === index) {
                gateways[i][field] = value;
                break;
            }
        }
    }

    // Toggle a project selection for a gateway
    function toggleGatewayProject(gatewayIndex, projectName, isSelected) {
        for (var i = 0; i < gateways.length; i++) {
            if (gateways[i].index === gatewayIndex) {
                var projects = gateways[i].projects.slice();
                var existingIndex = projects.indexOf(projectName);
                if (isSelected && existingIndex === -1) {
                    projects.push(projectName);
                } else if (!isSelected && existingIndex !== -1) {
                    projects.splice(existingIndex, 1);
                }
                gateways[i].projects = projects;
                break;
            }
        }
    }

    // Submit the configuration
    function submitConfiguration() {
        // Clear previous errors
        clearAllErrors();

        var data = {
            projectPaths: projectPaths,
            gateways: gateways.map(function (g) {
                return {
                    name: g.name.trim(),
                    url: g.url.trim(),
                    ignoreSSLErrors: g.ignoreSSLErrors,
                    projects: g.projects
                };
            })
        };

        vscode.postMessage({
            command: 'submitConfiguration',
            data: data
        });
    }

    // Handle messages from the extension
    window.addEventListener('message', function (event) {
        var message = event.data;

        switch (message.command) {
            case 'folderSelected':
                handleFolderSelected(message.paths);
                break;

            case 'projectsDiscovered':
                handleProjectsDiscovered(message.projects, message.pathResults);
                break;

            case 'pathCorrected':
                handlePathCorrected(message.oldPath, message.newPath);
                break;

            case 'validationResult':
                handleValidationResult(message.errors);
                break;

            case 'nameValidation':
                handleNameValidation(message);
                break;

            case 'urlValidation':
                handleUrlValidation(message);
                break;

            case 'configurationSaved':
                handleConfigurationSaved(message);
                break;
        }
    });

    // Add selected folders to the list
    function handleFolderSelected(paths) {
        if (!paths || !Array.isArray(paths)) return;

        for (var i = 0; i < paths.length; i++) {
            if (projectPaths.indexOf(paths[i]) === -1) {
                projectPaths.push(paths[i]);
            }
        }
        renderPathList();
        // Trigger project scan
        vscode.postMessage({
            command: 'scanProjects',
            paths: projectPaths
        });
    }

    // Handle discovered projects
    function handleProjectsDiscovered(projects, results) {
        discoveredProjects = projects || [];
        pathResults = results || [];
        renderPathList(); // Re-render to show project counts and warnings
        renderDiscoveredProjects();
        renderGateways(); // Re-render to update project checkboxes
    }

    // Remove a path from the list
    function removePath(pathToRemove) {
        projectPaths = projectPaths.filter(function (p) {
            return p !== pathToRemove;
        });
        pathResults = pathResults.filter(function (r) {
            return r.path !== pathToRemove;
        });
        renderPathList();
        // Re-scan projects
        if (projectPaths.length > 0) {
            vscode.postMessage({
                command: 'scanProjects',
                paths: projectPaths
            });
        } else {
            discoveredProjects = [];
            pathResults = [];
            renderDiscoveredProjects();
            renderGateways();
        }
    }

    // Correct a path (replace with suggested parent)
    function correctPath(oldPath, newPath) {
        // Check if the new path already exists in the list
        var newPathExists = projectPaths.indexOf(newPath) !== -1;

        if (newPathExists) {
            // New path already exists - just remove the old path (consolidate)
            projectPaths = projectPaths.filter(function (p) {
                return p !== oldPath;
            });
        } else {
            // Replace the old path with the new one
            for (var i = 0; i < projectPaths.length; i++) {
                if (projectPaths[i] === oldPath) {
                    projectPaths[i] = newPath;
                    break;
                }
            }
        }

        // Remove old path result
        pathResults = pathResults.filter(function (r) {
            return r.path !== oldPath;
        });
        renderPathList();
        // Re-scan with the corrected path
        vscode.postMessage({
            command: 'scanProjects',
            paths: projectPaths
        });
    }

    // Handle path correction response
    function handlePathCorrected(oldPath, newPath) {
        // This is called when the extension confirms the path was corrected
        // The actual correction happens in correctPath, this is just for confirmation
        console.log('Path corrected from', oldPath, 'to', newPath);
    }

    // Get scan result for a path
    function getPathResult(pathValue) {
        for (var i = 0; i < pathResults.length; i++) {
            if (pathResults[i].path === pathValue) {
                return pathResults[i];
            }
        }
        return null;
    }

    // Render the project paths list
    function renderPathList() {
        if (!pathList) return;

        if (projectPaths.length === 0) {
            pathList.innerHTML = '<div class="empty-state">No project paths added yet.</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < projectPaths.length; i++) {
            var p = projectPaths[i];
            var result = getPathResult(p);

            if (result && result.isDirectProject) {
                // This is a direct project folder - show warning
                html += '<li class="path-item path-item-warning">';
                html += '  <div class="path-item-content">';
                html += '    <div class="path-item-main">';
                html += '      <span class="path-warning-icon" title="Direct project selected">⚠️</span>';
                html += '      <span class="path-item-text" title="' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>';
                html += '    </div>';
                html += '    <div class="path-warning-message">';
                html +=
                    '      You selected the project <strong>' +
                    escapeHtml(result.projectName || 'unknown') +
                    '</strong> directly. ';
                html += '      Select the folder <em>containing</em> your projects instead.';
                html += '    </div>';
                html += '    <div class="path-warning-actions">';
                html += '      <button class="btn btn-small btn-fix-path" data-old-path="' + escapeHtml(p) + '" ';
                html += '              data-new-path="' + escapeHtml(result.suggestedParent || '') + '">';
                html +=
                    '        <span class="btn-icon">✏️</span> Use parent folder: ' +
                    escapeHtml(result.suggestedParent || '');
                html += '      </button>';
                html += '    </div>';
                html += '  </div>';
                html +=
                    '  <button class="path-item-remove" data-path="' +
                    escapeHtml(p) +
                    '" title="Remove">&times;</button>';
                html += '</li>';
            } else {
                // Normal path - show project count
                var projectCount = result ? result.projectCount : 0;
                var countClass = projectCount > 0 ? 'project-count-success' : 'project-count-empty';
                var countText = projectCount === 1 ? '1 project' : projectCount + ' projects';

                html += '<li class="path-item">';
                html += '  <div class="path-item-content">';
                html += '    <span class="path-item-text" title="' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>';
                if (result) {
                    html += '    <span class="path-project-count ' + countClass + '">' + countText + '</span>';
                }
                html += '  </div>';
                html +=
                    '  <button class="path-item-remove" data-path="' +
                    escapeHtml(p) +
                    '" title="Remove">&times;</button>';
                html += '</li>';
            }
        }
        pathList.innerHTML = html;

        // Add remove listeners
        var removeButtons = pathList.querySelectorAll('.path-item-remove');
        removeButtons.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                var pathToRemove = e.target.getAttribute('data-path');
                if (pathToRemove) {
                    removePath(pathToRemove);
                }
            });
        });

        // Add fix path listeners
        var fixButtons = pathList.querySelectorAll('.btn-fix-path');
        fixButtons.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                var oldPath = e.target.getAttribute('data-old-path');
                var newPath = e.target.getAttribute('data-new-path');
                if (oldPath && newPath) {
                    correctPath(oldPath, newPath);
                }
            });
        });
    }

    // Render discovered projects
    function renderDiscoveredProjects() {
        if (!discoveredProjectsSection || !discoveredProjectsList) return;

        if (discoveredProjects.length === 0) {
            discoveredProjectsSection.style.display = 'none';
            return;
        }

        discoveredProjectsSection.style.display = 'block';

        var html = '';
        for (var i = 0; i < discoveredProjects.length; i++) {
            var project = discoveredProjects[i];
            html += '<span class="discovered-project-tag">';
            html += escapeHtml(project.name);
            if (project.parent) {
                html += ' <span class="project-parent">(inherits: ' + escapeHtml(project.parent) + ')</span>';
            }
            html += '</span>';
        }
        discoveredProjectsList.innerHTML = html;
    }

    // Handle validation result (form-level)
    function handleValidationResult(errors) {
        clearAllErrors();

        if (!errors || errors.length === 0) return;

        // Show global errors
        var globalErrors = errors.filter(function (e) {
            return e.field === 'gateways';
        });
        if (globalErrors.length > 0) {
            var errorDiv = document.createElement('div');
            errorDiv.className = 'global-error';
            errorDiv.textContent = globalErrors[0].message;
            var wizardContainer = document.querySelector('.wizard-container');
            if (wizardContainer && wizardContainer.firstChild) {
                wizardContainer.insertBefore(errorDiv, wizardContainer.children[2]); // After header and intro
            }
        }

        // Show field-specific errors
        for (var i = 0; i < errors.length; i++) {
            var error = errors[i];
            if (error.index !== undefined) {
                showFieldError(error.field, error.message, error.index);
            }
        }

        // Focus first gateway with error
        var firstError = errors.find(function (e) {
            return e.index !== undefined;
        });
        if (firstError) {
            var card = document.querySelector('.gateway-card[data-gateway-index="' + firstError.index + '"]');
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // Handle gateway name validation response
    function handleNameValidation(message) {
        var input = document.querySelector('.gateway-name[data-gateway-index="' + message.index + '"]');
        if (!input) return;

        clearFieldError(input);
        if (!message.isValid && message.error) {
            showInputError(input, message.error);
        }
    }

    // Handle gateway URL validation response
    function handleUrlValidation(message) {
        var input = document.querySelector('.gateway-url[data-gateway-index="' + message.index + '"]');
        if (!input) return;

        clearFieldError(input);
        if (!message.isValid && message.error) {
            showInputError(input, message.error);
        }
    }

    // Handle configuration saved response
    function handleConfigurationSaved(message) {
        if (!message.success && message.error) {
            console.error('Configuration save failed:', message.error);
        }
    }

    // Show error for a specific field by index
    function showFieldError(fieldType, message, index) {
        var selector = fieldType === 'gatewayName' ? '.gateway-name' : '.gateway-url';
        var input = document.querySelector(selector + '[data-gateway-index="' + index + '"]');
        if (input) {
            showInputError(input, message);
        }
    }

    // Show error on an input element
    function showInputError(input, message) {
        input.classList.add('error');
        var errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.textContent = message;
        input.parentNode.appendChild(errorEl);
    }

    // Clear error for a specific input
    function clearFieldError(input) {
        if (!input) return;
        input.classList.remove('error');
        var existingError = input.parentNode.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
    }

    // Clear all errors
    function clearAllErrors() {
        var errorMessages = document.querySelectorAll('.error-message');
        errorMessages.forEach(function (el) {
            el.remove();
        });

        var globalErrors = document.querySelectorAll('.global-error');
        globalErrors.forEach(function (el) {
            el.remove();
        });

        var errorInputs = document.querySelectorAll('.form-input.error');
        errorInputs.forEach(function (el) {
            el.classList.remove('error');
        });
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
