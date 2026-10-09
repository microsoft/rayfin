import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import type { ReactNode } from 'react';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  const tsApiLandingPath = `/${
    (siteConfig.customFields?.tsApiLandingPath as string | undefined) ??
    'docs/ts-sdk'
  }`;
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroTopRow}>
          <img
            src={useBaseUrl('/img/rayfin.png')}
            alt="Project Rayfin"
            className={styles.heroLogo}
          />
        </div>

        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>

        <div className={styles.heroActions}>
          <Link
            className={clsx('button button--lg', styles.primaryCta)}
            to="/docs/guide"
          >
            Get Started
          </Link>
          <Link
            className={clsx('button button--lg', styles.secondaryCta)}
            to={tsApiLandingPath}
          >
            SDK Reference
          </Link>
        </div>

        <div className={styles.heroMeta}>
          <span className={styles.heroMetaItem}>Code-first</span>
          <span className={styles.heroMetaDot}>•</span>
          <span className={styles.heroMetaItem}>Typed GraphQL</span>
          <span className={styles.heroMetaDot}>•</span>
          <span className={styles.heroMetaItem}>Auth</span>
          <span className={styles.heroMetaDot}>•</span>
          <span className={styles.heroMetaItem}>Static content hosting</span>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const tsApiLandingPath = `/${
    (siteConfig.customFields?.tsApiLandingPath as string | undefined) ??
    'docs/ts-sdk'
  }`;
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />

      <main className={styles.main}>
        <section className={clsx('container', styles.section)}>
          <div className={styles.sectionHeaderRow}>
            <Heading as="h2" className={styles.sectionTitle}>
              Quick Access
            </Heading>
            <Link className={styles.sectionLink} to="/docs/guide">
              Browse the Guide →
            </Link>
          </div>

          <div className={styles.cards}>
            <div className={styles.card}>
              <Heading as="h3" className={styles.cardTitle}>
                Guide
              </Heading>
              <p className={styles.cardDesc}>
                Create new projects, manage with the CLI, define data & auth models, and run & connect your app.
              </p>
              <Link className={styles.cardLink} to="/docs/guide">
                Open Guide →
              </Link>
            </div>

            <div className={styles.card}>
              <Heading as="h3" className={styles.cardTitle}>
                SDK Reference
              </Heading>
              <p className={styles.cardDesc}>
                Client-side TypeScript SDK for building apps that define your backend and connect to it—all in one.
              </p>
              <Link className={styles.cardLink} to={tsApiLandingPath}>
                Open SDK Docs →
              </Link>
            </div>

          </div>
        </section>

        <section className={clsx('container', styles.section)}>
          <div className={styles.nextSteps}>
            <Heading as="h2" className={styles.nextStepsTitle}>
              Next Steps
            </Heading>

            <ol className={styles.nextStepsList}>
              <li>
                Start with the <Link to="/docs/guide">Guide</Link> to understand the end-to-end flow.
              </li>
              <li>
                Use the <Link to={tsApiLandingPath}>SDK Reference</Link> when you’re implementing clients.
              </li>
            </ol>

            <div className={styles.nextStepsActions}>
              <Link className={clsx('button button--lg', styles.ghostCta)} to="/docs/guide">
                <span className={styles.ctaIcon}>📖</span>
                Start Reading
              </Link>
              <Link
                className={clsx('button button--lg', styles.ghostCta)}
                href={siteConfig.customFields?.githubUrl as string}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-label="GitHub"
                  className={styles.githubIcon}
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                View on GitHub
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
