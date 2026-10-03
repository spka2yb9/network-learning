import { Component, useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { curriculum } from '../../lessons/curriculum';
import { Icon } from '../../components/Icon';
import { useUI } from '../../stores/ui';
import { lab } from '../../application/LabController';
import { labById } from '../../labs';

export default function Layout() {
  const location = useLocation(); const menuOpen = useUI(s => s.menuOpen); const saved = useUI(s => s.saveStatus); const notice = useUI(s => s.notice); useUI(s => s.revision);
  const completed = curriculum.filter(c => lab.completed.has(`${c.id}-mastery`)).length;
  const close = () => useUI.setState({ menuOpen: false });
  // Every page (and lesson step, ?stage=) starts at the top instead of keeping the previous page's scroll position.
  // Workspaces (diagram, editor, capture) use the full width; the navigation opens as a drawer from the menu button.
  const workspace = /^\/(simulator|lab|aws|terraform|analyzer)(\/|$)/.test(location.pathname);
  // Any navigation (including browser Back) also closes the drawer.
  useEffect(() => { window.scrollTo(0, 0); close(); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  return <div className={`app-shell ${workspace ? 'workspace-mode' : ''}`}><aside id="sidebar" className={`sidebar ${menuOpen ? 'menu-open' : ''}`}>
    <Link className="brand" to="/" onClick={() => useUI.setState({ menuOpen: false })}><span className="brand-mark"><Icon name="network" size={25}/></span><span>path<span className="brand-period">.</span><small>NETWORK LEARNING LAB</small></span></Link>
    <nav className="primary-nav" aria-label="メインナビゲーション"><NavLink to="/" end onClick={() => useUI.setState({ menuOpen: false })}><Icon name="book" size={18}/>学習ホーム</NavLink><NavLink to="/simulator" onClick={close}><Icon name="network" size={18}/>プレイグラウンド</NavLink><NavLink to="/aws" onClick={close}><Icon name="cloud" size={18}/>AWS VPC Designer</NavLink><NavLink to="/terraform" onClick={close}><Icon name="code" size={18}/>Terraform Lab</NavLink><NavLink to="/analyzer" onClick={close}><Icon name="packet" size={18}/>Packet Analyzer</NavLink><NavLink to="/labs" onClick={close}><Icon name="lab" size={18}/>ラボ一覧</NavLink></nav>
    <div className="curriculum-label">YOUR LEARNING PATH <span>12 CHAPTERS</span></div>
    <nav className="curriculum-nav" aria-label="カリキュラム">{curriculum.map((chapter, i) => <div key={chapter.id}>{(i === 0 || curriculum[i - 1].level !== chapter.level) && <div className="curriculum-group">{chapter.level}</div>}{chapter.available ? <NavLink className={({ isActive }) => `${isActive || (location.pathname.startsWith('/lab/') && labById(location.pathname.slice(5))?.chapter === chapter.id) ? 'active' : ''}`} to={`/learn/${chapter.id}`} onClick={() => useUI.setState({ menuOpen: false })}><span className={`chapter-number ${lab.completed.has(`${chapter.id}-mastery`) ? 'completed' : ''}`}>{lab.completed.has(`${chapter.id}-mastery`) ? <Icon name="check" size={14}/> : String(i + 1).padStart(2, '0')}</span><span>{chapter.title}</span><Icon name="chevron" size={12}/></NavLink> : <div className="chapter-planned"><span className="chapter-number">{String(i + 1).padStart(2, '0')}</span><span>{chapter.title}</span><small>準備中</small></div>}</div>)}</nav>
    <div className="sidebar-footer"><div className="progress-caption"><span>章の実技チェック</span><b>{completed} / {curriculum.length}</b></div><div className="progress-track"><span style={{ width: `${completed / curriculum.length * 100}%` }}/></div><p>ひとつずつ、確かな理解へ。</p><Link to="/roadmap"><Icon name="layers" size={15}/>学習ロードマップ<Icon name="arrow" size={14}/></Link></div>
  </aside>
  {menuOpen && <button className="sidebar-overlay" aria-label="メニューを閉じる" onClick={() => useUI.setState({ menuOpen: false })}/>}
  <div className="app-body"><header className="topbar"><div><button className="icon-button menu-button" aria-label="メニュー" aria-controls="sidebar" aria-expanded={menuOpen} onClick={() => useUI.setState({ menuOpen: !menuOpen })}><Icon name="menu"/></button><span className="topbar-label">LEARN. BUILD. UNDERSTAND.</span></div><div className="topbar-right"><span className="local-save"><span className={`status-dot ${saved === 'error' ? 'down' : ''}`}/>{saved === 'saved' ? 'このブラウザに保存' : saved === 'saving' ? '保存中…' : '保存できません'}</span><span className="version-label">v0.2</span><span className="avatar">Y</span></div></header>
    {notice && <div className="global-notice" role="alert"><Icon name="alert" size={18}/><span>{notice}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => useUI.setState({ notice: '' })}><Icon name="close" size={16}/></button></div>}
    <main><PageBoundary path={location.pathname}><Outlet/></PageBoundary></main><footer className="app-footer"><span>path. <span>理解は、つながる。</span></span><span>すべての通信はブラウザ内の教育用シミュレーションです。</span></footer>
  </div></div>;
}

/** A page that fails to render (or a lazy chunk that is gone after a redeploy) shows a way out instead of a blank screen. */
class PageBoundary extends Component<{ children: ReactNode; path: string }, { error?: Error; path?: string }> {
  state: { error?: Error; path?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  // Moving to another page clears the error without remounting pages on normal navigation.
  static getDerivedStateFromProps(props: { path: string }, state: { path?: string }) { return props.path === state.path ? null : { error: undefined, path: props.path }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="not-found" role="alert"><h1>この画面を表示できませんでした。</h1><p className="muted">{this.state.error.message}</p><p>保存済みの進捗と構成は残っています。再読み込みしてください。</p><button className="button" onClick={() => location.reload()}>再読み込み</button></div>;
  }
}
