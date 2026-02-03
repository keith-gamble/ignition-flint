# Changelog

All notable changes to the Flint for Ignition extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-02-03

### Added
- Public repository mirror workflow [f220e89]
- Release candidate preparation workflow [1e40e0d]

### Changed
- Transform RC versions for VS Code Marketplace compatibility [5ff1a43]
- Reduce cyclomatic complexity in debug adapter and script console [3ef54ab]

## [0.1.0] - 2026-02-03

### Added
- Initial release of Flint for Ignition
- Project Browser with hierarchical tree view
- Support for multiple gateways and projects
- Resource CRUD operations (create, read, update, delete)
- Resource search and content search functionality
- Support for Python Scripts, Named Queries, and Perspective resources
- Gateway and environment management
- Integration with Kindling for backup file viewing
- Integration with Designer Launcher (8.3+)
- Configuration validation and migration
- Resource.json validation and generation
- Search history management
- Status bar indicators for gateway and environment
- Resource templates for quick creation

### Fixed
- Linting errors throughout codebase
- TypeScript strict mode compliance

### Known Issues
- Project script autocomplete not working with nested inheritance
- Project script outlines not yet implemented
- Embedded script decoding in JSON files not implemented
- Gateway REST API integration for project scanning not complete
- No test coverage for most services (basic tests for ServiceContainer only)

## [0.0.1-SNAPSHOT] - 2024-01-10

Initial development version.

### Added
- Pre-release version for testing and feedback
- Core architecture and service infrastructure
- Basic functionality for resource browsing and management

---

## Version History Guide

### Version Numbering
- **Major** (X.0.0): Breaking changes, major feature additions
- **Minor** (0.X.0): New features, backwards compatible
- **Patch** (0.0.X): Bug fixes, minor improvements

### Release Types
- **SNAPSHOT**: Development builds, not for production
- **ALPHA**: Early testing, may have significant issues
- **BETA**: Feature complete, testing for stability
- **RC**: Release candidate, final testing
- **RELEASE**: Stable production version