# Our Reliable Publishing Process

In our experience, maintaining up-to-date and highly accessible documentation is a core part of building trust with our users. That is why we rely on a GitHub Actions-based deployment pipeline for this very website.

## Why We Manage Publishing This Way

When dealing with complex technical systems, we must ensure that the information you read is perfectly stable and accurate. We chose this deployment method because it allows us to avoid the limitations of traditional, branch-only static publishing. Instead, it provides a strictly controlled build environment. Most importantly, it completely prevents out-of-date or broken documentation from ever reaching the live site. If our quality checks fail, the deployment stops, ensuring you only ever see the most reliable information.

## How the Deployment Works

Our publishing process is fully automated yet highly controlled. We store all documentation source files securely within the repository. We configure our repository to use GitHub Actions as the sole source of truth for the live pages.

The workflow itself is carefully split into distinct jobs. The first job handles the build process—installing dependencies and generating the static output. Only when this step succeeds flawlessly does the second job take over, securely publishing the polished artifact directly to the web.

```yaml
name: Deploy Docs to GitHub Pages

on:
  push:
    branches: ["main"]
    paths:
      - "docs/**"
      - ".github/workflows/deploy-pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: docs/package-lock.json
      - name: Install docs deps
        run: npm ci
        working-directory: docs
      - name: Build VitePress docs
        run: npm run docs:build
        working-directory: docs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## Maintaining Quality and Polish

We hold our technical writers to exactly the same high standards as our engineers. Every page must use semantic headings to segment information logically. We ensure all diagrams remain readable in any color mode, and we mandate descriptive text for all visual elements. This rigorous approach guarantees that whether you are exploring practical application scenarios or delving deep into our cloud architecture, your experience is smooth, informative, and professional.
