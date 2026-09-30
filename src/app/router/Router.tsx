import { lazy, Suspense } from 'react';
import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import Layout from '../layout/Layout';
import HomePage from '../pages/HomePage';
const LearnPage = lazy(() => import('../pages/LearnPage'));
const SimulatorPage = lazy(() => import('../pages/SimulatorPage'));
const AwsPage = lazy(() => import('../pages/AwsPage'));
const TerraformPage = lazy(() => import('../pages/TerraformPage'));
const AnalyzerPage = lazy(() => import('../pages/AnalyzerPage'));
const LabsPage = lazy(() => import('../pages/LabsPage'));
const RoadmapPage = lazy(() => import('../pages/RoadmapPage'));
export default function AppRouter() {
  return <HashRouter><Suspense fallback={<div className="loading-screen">学習スペースを準備しています…</div>}><Routes><Route element={<Layout/>}>
    <Route index element={<HomePage/>}/><Route path="learn/:chapter" element={<LearnPage/>}/>
    <Route path="simulator" element={<SimulatorPage/>}/><Route path="lab/:labId" element={<SimulatorPage/>}/>
    <Route path="aws" element={<AwsPage/>}/><Route path="aws/:labId" element={<AwsPage/>}/>
    <Route path="terraform" element={<TerraformPage/>}/><Route path="terraform/:labId" element={<TerraformPage/>}/>
    <Route path="analyzer" element={<AnalyzerPage/>}/><Route path="analyzer/:labId" element={<AnalyzerPage/>}/>
    <Route path="labs" element={<LabsPage/>}/><Route path="roadmap" element={<RoadmapPage/>}/>
    <Route path="*" element={<div className="not-found"><h1>ページが見つかりませんでした。</h1><Link to="/" className="button">学習ホームへ戻る</Link></div>}/>
  </Route></Routes></Suspense></HashRouter>;
}
