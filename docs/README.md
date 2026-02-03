# Flint Documentation

This directory contains the Docusaurus-based documentation for the Flint VS Code extension.

## 📚 Documentation Structure

```
docs/
├── docs/                    # Documentation content
│   ├── getting-started/     # Installation and setup guides
│   ├── configuration/       # Configuration documentation
│   ├── features/           # Feature documentation
│   ├── resources/          # Resource-specific guides
│   ├── commands/           # Command reference
│   ├── troubleshooting/    # Troubleshooting guides
│   └── development/        # Development documentation
├── static/                 # Static assets
│   └── img/               # Images and screenshots
├── src/                   # Custom components and styling
│   └── css/              # Custom CSS
├── docusaurus.config.ts   # Docusaurus configuration
├── sidebars.ts           # Sidebar navigation
└── package.json          # Dependencies and scripts
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18.0+ and npm 9.0+
- Git

### Installation

```bash
# Navigate to docs directory
cd docs

# Install dependencies
npm install
```

### Development

```bash
# Start development server
npm start

# The site will be available at http://localhost:3000
```

### Building

```bash
# Build for production
npm run build

# Test production build locally
npm run serve
```

## ✍️ Writing Documentation

### Creating New Pages

1. Create a new `.md` or `.mdx` file in the appropriate directory
2. Add frontmatter:
   ```markdown
   ---
   title: Your Page Title
   sidebar_label: Sidebar Label
   ---
   ```
3. Update `sidebars.ts` if needed

### Markdown Features

- **Code blocks** with syntax highlighting
- **Admonitions** for tips, warnings, notes
- **Tables** for structured data
- **Mermaid diagrams** for flowcharts
- **MDX components** for interactive content

### Adding Screenshots

1. Add images to `static/img/screenshots/`
2. Reference in markdown:
   ```markdown
   <div class="screenshot-container">
     <img src="/img/screenshots/your-image.png" alt="Description" />
   </div>
   ```

## 🎨 Styling

The documentation uses a custom theme based on Ignition's brand colors:

- **Primary**: Ignition Orange (#FF6B35)
- **Secondary**: Blue (#4A90E2)
- **Typography**: System fonts with good readability
- **Dark mode**: Full support with optimized colors

Customize styling in `src/css/custom.css`.

## 📦 Key Dependencies

- **Docusaurus**: 3.9.1 - Static site generator
- **React**: 19.0.0 - UI framework
- **Mermaid**: For diagrams
- **Local Search**: Offline search functionality
- **Prism**: Syntax highlighting

## 🔍 Search Configuration

The documentation uses local search for offline functionality:
- Searches all documentation content
- No external dependencies
- Keyboard shortcut: `Ctrl+K` / `Cmd+K`

## 📝 Documentation Guidelines

### Writing Style

- **Clear and concise** - Get to the point
- **Task-oriented** - Focus on what users want to do
- **Examples** - Include code examples and screenshots
- **Consistent** - Use consistent terminology

### Content Structure

1. **Overview** - What and why
2. **Prerequisites** - What's needed
3. **Steps** - How to do it
4. **Examples** - Show it in action
5. **Troubleshooting** - Common issues
6. **Next steps** - Where to go next

### Terminology

- **Flint** - The extension name (not "flint" or "FLINT")
- **Ignition** - The platform (capital I)
- **VS Code** - The editor (not "VSCode" or "vscode")
- **Project Browser** - The tree view (capital P and B)

## 🚢 Deployment

### GitHub Pages

```bash
# Build and deploy to GitHub Pages
npm run build
# Commit the build folder to gh-pages branch
```

### Custom Domain

1. Add `CNAME` file to `static/` with your domain
2. Configure DNS to point to GitHub Pages
3. Update `url` in `docusaurus.config.ts`

### Docker

```dockerfile
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
```

## 🤝 Contributing

### Before Contributing

1. Check existing documentation
2. Follow the style guide
3. Test your changes locally
4. Verify all links work

### Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## 📄 License

The documentation is licensed under the same MIT License as the Flint extension.

## 🔗 Useful Links

- [Docusaurus Documentation](https://docusaurus.io/docs)
- [Markdown Guide](https://www.markdownguide.org/)
- [MDX Documentation](https://mdxjs.com/)
- [Flint Repository](https://github.com/ignition-tools/flint)

## 📞 Support

For documentation issues or suggestions:
- [Open an issue](https://github.com/ignition-tools/flint/issues)
- [Start a discussion](https://github.com/ignition-tools/flint/discussions)