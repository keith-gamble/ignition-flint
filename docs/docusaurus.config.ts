import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkCodeImport from 'remark-code-import';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Flint',
  tagline: 'VS Code Extension for Ignition by Inductive Automation',
  favicon: 'img/flint-icon.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://your-site.example.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  baseUrl: '/',

  organizationName: 'bw-design-group',
  projectName: 'ignition.tools.flint',

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        indexDocs: true,              // Index documentation pages
        indexBlog: false,             // Blog is disabled in presets
        indexPages: false,            // Skip indexing static pages
        language: "en",               // Match your i18n locale
        hashed: true,                 // Optimize index deduplication
        docsRouteBasePath: "/",       // Matches your docs routeBasePath
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          remarkPlugins: [remarkCodeImport],
          editUrl: 'https://github.com/bw-design-group/ignition.tools.flint/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Social card image
    image: 'img/flint-social-card.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Flint',
      logo: {
        alt: 'Flint Logo',
        src: 'img/flint-icon.png',
        srcDark: 'img/flint-icon.png',
      },
      items: [
        {
          href: 'https://github.com/bw-design-group/ignition.tools.flint',
          label: 'GitHub',
          position: 'right',
        },
        { type: 'search', position: 'right' }, // Add search bar to navbar
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started',
            },
            {
              label: 'Development',
              to: '/development',
            },
          ],
        },
        {
          title: 'Links',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/bw-design-group/ignition.tools.flint',
            },
            {
              label: 'Issues',
              href: 'https://github.com/bw-design-group/ignition.tools.flint/issues',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} BW Design Group.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'python', 'sql', 'yaml', 'typescript'],
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;