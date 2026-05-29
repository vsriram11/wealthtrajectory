"use client";

import { useAppStore } from "@/lib/store";
import { AccountEditor } from "./_components/holdings/AccountEditor";
import { AccountList } from "./_components/holdings/AccountList";
import { AllocationPage } from "./_components/shell/AllocationPage";
import { MilestonesCard } from "./_components/projection/MilestonesCard";
import { CoastIndependenceCard } from "./_components/projection/CoastIndependenceCard";
import { ConcentrationRiskCard } from "./_components/allocation/ConcentrationRiskCard";
import { FeeDragCard } from "./_components/allocation/FeeDragCard";
import { GoalsCard } from "./_components/plan/GoalsCard";
import { NWPercentileCard } from "./_components/insights/NWPercentileCard";
import { WithdrawalSequenceCard } from "./_components/plan/WithdrawalSequenceCard";
import { HealthScoreCard } from "./_components/insights/HealthScoreCard";
import { IncomeAndSavingsRateCard } from "./_components/plan/IncomeAndSavingsRateCard";
import { AssetLocationCard } from "./_components/allocation/AssetLocationCard";
import { AssumptionsPanel } from "./_components/plan/AssumptionsPanel";
import { EmergencyFundCard } from "./_components/plan/EmergencyFundCard";
import { AuthHydrator } from "./_components/infra/AuthHydrator";
import { CloudSyncer } from "./_components/infra/CloudSyncer";
import { DataIO } from "./_components/data/DataIO";
import { DataPageExtras } from "./_components/shell/DataPageExtras";
import { EncryptionCard } from "./_components/data/EncryptionCard";
import { DrawdownPhasesCard } from "./_components/projection/DrawdownPhasesCard";
import { BackupDiscoverabilityBanner } from "./_components/data/BackupDiscoverabilityBanner";
import { GoogleSyncCard } from "./_components/data/GoogleSyncCard";
import { CalculatorsPage } from "./_components/shell/CalculatorsPage";
import { GlossaryPage } from "./_components/shell/GlossaryPage";
import { PlanPage } from "./_components/shell/PlanPage";
import { ProjectionsPage } from "./_components/shell/ProjectionsPage";
import { RothLadderCard } from "./_components/plan/RothLadderCard";
import { DemoHeader } from "./_components/shell/DemoHeader";
import { EncryptionUnlockBanner } from "./_components/data/EncryptionUnlockBanner";
import { SyncShrinkageBanner } from "./_components/data/SyncShrinkageBanner";
import { GlobalSyncBanner } from "./_components/data/GlobalSyncBanner";
import { SignInOutcomeBanner } from "./_components/data/SignInOutcomeBanner";
import { TimeTravelBanner } from "./_components/data/TimeTravelBanner";
import { EmptyState } from "./_components/ui/EmptyState";
import { QuickStart } from "./_components/data/QuickStart";
import { HoldingCreator } from "./_components/holdings/HoldingCreator";
import { HoldingEditor } from "./_components/holdings/HoldingEditor";
import { Insights } from "./_components/insights/Insights";
import { LiabilitiesList } from "./_components/holdings/LiabilitiesList";
import { LegalFooter } from "./_components/shell/LegalFooter";
import { LiabilityEditor } from "./_components/holdings/LiabilityEditor";
import { MemberFilter } from "./_components/insights/MemberFilter";
import { MembersSheet } from "./_components/insights/MembersSheet";
import { NavDrawer } from "./_components/shell/NavDrawer";
import { HomeMetrics, NetWorthCard } from "./_components/projection/NetWorthCard";
import { PersistenceHydrator } from "./_components/infra/PersistenceHydrator";
import { PriceRefresher } from "./_components/infra/PriceRefresher";
import { ProGate } from "./_components/ui/ProGate";
import { ServiceWorkerRegistrar } from "./_components/infra/ServiceWorkerRegistrar";
import { SessionEnforcer } from "./_components/infra/SessionEnforcer";
import { QuoteCloudSync } from "./_components/infra/QuoteCloudSync";
import { RemindersCard } from "./_components/data/RemindersCard";
import { ScenarioPicker } from "./_components/projection/ScenarioPicker";

/**
 * Top-level page router. Six pages keyed off `currentPage`:
 *
 *   1. HOME          — "How am I doing?" dashboard. Trimmed to the
 *                       8 essential cards every user needs in one
 *                       glance; deeper analytics + tax strategy live
 *                       on dedicated pages reachable via the hamburger.
 *   2. ACCOUNTS       — Raw asset / liability inventory.
 *   3. ALLOCATION     — Class / style / geography breakdowns + tax
 *                       buckets.
 *   4. PROJECTIONS    — Forward-looking models: doubling, growth
 *                       velocity, stress test, sensitivity, what-if,
 *                       scenarios, future composition.
 *   5. PLAN           — Strategy / tax / safety: assumptions,
 *                       drawdown phases, emergency fund, concentration,
 *                       fee drag, asset location, drawdown sequence,
 *                       Roth ladder, NW percentile.
 *   6. DATA           — Backup, encryption, members, disclosures.
 *
 * Visual sub-grouping within Projections + Plan uses SectionHeader.
 * The reorg replaced an unscrollable home page (21 cards) with this
 * IA — each page now caps at 5–10 cards and a coherent mental model.
 */
export default function Home() {
  const page = useAppStore((s) => s.currentPage);

  return (
    <main className="mx-auto min-h-dvh max-w-md">
      <PersistenceHydrator />
      <PriceRefresher />
      <AuthHydrator />
      <CloudSyncer />
      <QuoteCloudSync />
      <ServiceWorkerRegistrar />
      <SessionEnforcer />
      <TimeTravelBanner />
      <DemoHeader />
      <SignInOutcomeBanner />
      <EncryptionUnlockBanner />
      <SyncShrinkageBanner />
      <GlobalSyncBanner />
      <BackupDiscoverabilityBanner />
      <MemberFilter />
      {page === "home" && (
        <>
          {/* Scenario chip row — historically Pro-gated; in the OSS
              build ProGate is a pass-through, so this always renders.
              The wrapper is preserved for fork modularity. */}
          <ProGate variant="hide" title="" description="">
            <ScenarioPicker />
          </ProGate>
          <QuickStart />
          <NetWorthCard />
          <HomeMetrics />
          <HealthScoreCard />
          <MilestonesCard />
          <IncomeAndSavingsRateCard />
          <CoastIndependenceCard />
          <ProGate
            title="Insights"
            description="Smart guidance — progress to target, drag of low-yield cash, high-rate liabilities, and which account would advance your Independence date the most."
            bullets={[
              "Sensitivity analysis per account",
              "Cash drag warnings",
              "High-APR liability alerts",
            ]}
          >
            <Insights />
          </ProGate>
          <ProGate
            title="Goals tracker"
            description="Track non-Independence goals — house down payment, kid's college, sabbatical, wedding — separately from your Independence projection. Per-goal target, monthly contribution, and on-pace check."
            bullets={[
              "Unlimited goals with categories",
              "Per-goal on-pace check vs target date",
              "Progress bars + months-to-target",
            ]}
          >
            <GoalsCard />
          </ProGate>
        </>
      )}
      {page === "accounts" && (
        <>
          <AccountList />
          <LiabilitiesList />
        </>
      )}
      {page === "allocation" && <AllocationPage />}
      {page === "projections" && <ProjectionsPage />}
      {page === "plan" && <PlanPage />}
      {page === "calculators" && <CalculatorsPage />}
      {page === "glossary" && <GlossaryPage />}
      {page === "data" && (
        <>
          {/*
           * Page ordering: free path FIRST so it's the discoverable
           * default, then the encryption setup, then the optional Pro
           * (Drive sync) path. This sequence matches what we want
           * users to read top-to-bottom:
           *
           *   1. "Your data is yours — export it anywhere"  (DataIO)
           *   2. "Encrypt it before you move it"            (EncryptionCard)
           *   3. "Or let us sync it for you (Pro)"          (GoogleSyncCard)
           *
           * Both DataIO and EncryptionCard work fully without a
           * Google sign-in — see docs/OAUTH_VERIFICATION.md for
           * the why. GoogleSyncCard keeps its ProGate marker so
           * the architectural separation for future monetization
           * stays intact (the gate is a no-op today, easily
           * flipped later).
           */}
          <DataIO />
          <EncryptionCard />
          <ProGate
            title="Cloud backup"
            description="Mirror your data to your private Google Drive appDataFolder so it follows you across browsers and devices. Auto-syncs in the background."
            bullets={[
              "Encrypted at rest in Google's per-app sandbox",
              "Auto-syncs on every change",
              "Multi-device cross-sync",
            ]}
          >
            <GoogleSyncCard />
          </ProGate>
          <RemindersCard />
          <DataPageExtras />
          <EmptyState />
        </>
      )}

      <LegalFooter />

      <NavDrawer />
      <HoldingEditor />
      <HoldingCreator />
      <LiabilityEditor />
      <AccountEditor />
      <MembersSheet />
    </main>
  );
}
