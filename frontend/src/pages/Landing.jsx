import React from 'react';
import { SiteFooter, SiteHeader, TopStrip } from '../components/landing/SiteChrome';
import {
  CtaBand,
  FeatureGrid,
  Hero,
  HowItWorks,
  PerformanceBand,
  RiskModel,
  StackStrip,
} from '../components/landing/Sections';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function Landing() {
  useDocumentTitle('Real-time card fraud detection');

  return (
    <div className="min-h-screen bg-white">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopStrip />
      <SiteHeader />
      <main id="main">
        <Hero />
        <StackStrip />
        <FeatureGrid />
        <HowItWorks />
        <PerformanceBand />
        <RiskModel />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
