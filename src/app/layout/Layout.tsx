import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { curriculum } from '../../lessons/curriculum';
import { Icon } from '../../components/Icon';
import { useUI } from '../../stores/ui';
import { lab } from '../../application/LabController';
import { labById } from '../../labs';

export default function Layout() {
  const location = useLocation(); const mobileMenu = useUI(s => s.mobileMenu); const saved = useUI(s => s.saveStatus); const notice = useUI(s => s.notice); useUI(s => s.revision);
  const completed = curriculum.filter(c => lab.completed.has(`${c.id}-mastery`)).length;
  const close = () => useUI.setState({ mobileMenu: false });
  // Every page (and lesson step, ?stage=) starts at the top instead of keeping the previous page's scroll position.
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname, location.search]);
  return <div className="app-shell"><aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}>
    <Link className="brand" to="/" onClick={() => useUI.setState({ mobileMenu: false })}><span className="brand-mark"><Icon name="network" size={25}/></span><span>path<span className="brand-period">.</span><small>NETWORK LEARNING LAB</small></span></Link>
    <nav className="primary-nav" aria-label="メインナビゲーション"><NavLink to="/" end onClick={() => useUI.setState({ mobileMenu: false })}><Icon name="book" size={18}/>学習ホーム</NavLink><NavLink to="/simulator" onClick={close}><Icon name="network" size={18}/>プレイグラウンド</NavLink><NavLink to="/aws" onClick={close}><Icon name="cloud" size={18}/>AWS VPC Designer</NavLink><NavLink to="/terraform" onClick={close}><Icon name="code" size={18}/>Terraform Lab</NavLink><NavLink to="/analyzer" onClick={close}><Icon name="packet" size={18}/>Packet Analyzer</NavLink><NavLink to="/labs" onClick={close}><Icon name="lab" size={18}/>ラボ一覧</NavLink></nav>
    <div className="curriculum-label">YOUR LEARNING PATH <span>12 CHAPTERS</span></div>
    <nav className="curriculum-nav" aria-label="カリキュラム">{curriculum.map((chapter, i) => <div key={chapter.id}>{(i === 0 || curriculum[i - 1].level !== chapter.level) && <div className="curriculum-group">{chapter.level}</div>}{chapter.available ? <NavLink className={({ isActive }) => `${isActive || (location.pathname.startsWith('/lab/') && labById(location.pathname.slice(5))?.chapter === chapter.id) ? 'active' : ''}`} to={`/learn/${chapter.id}`} onClick={() => useUI.setState({ mobileMenu: false })}><span className={`chapter-number ${lab.completed.has(`${chapter.id}-mastery`) ? 'completed' : ''}`}>{lab.completed.has(`${chapter.id}-mastery`) ? <Icon name="check" size={14}/> : String(i + 1).padStart(2, '0')}</span><span>{chapter.title}</span><Icon name="chevron" size={12}/></NavLink> : <div className="chapter-planned"><span className="chapter-number">{String(i + 1).padStart(2, '0')}</span><span>{chapter.title}</span><small>準備中</small></div>}</div>)}</nav>
    <div className="sidebar-footer"><div className="progress-caption"><span>章の実技チェック</span><b>{completed} / {curriculum.length}</b></div><div className="progress-track"><span style={{ width: `${completed / curriculum.length * 100}%` }}/></div><p>ひとつずつ、確かな理解へ。</p><Link to="/roadmap"><Icon name="layers" size={15}/>学習ロードマップ<Icon name="arrow" size={14}/></Link></div>
  </aside>
  {mobileMenu && <button className="sidebar-overlay" aria-label="メニューを閉じる" onClick={() => useUI.setState({ mobileMenu: false })}/>}
  <div className="app-body"><header className="topbar"><div><button className="icon-button mobile-menu-button" aria-label="メニュー" onClick={() => useUI.setState({ mobileMenu: !mobileMenu })}><Icon name="menu"/></button><span className="topbar-label">LEARN. BUILD. UNDERSTAND.</span></div><div className="topbar-right"><span className="local-save"><span className={`status-dot ${saved === 'error' ? 'down' : ''}`}/>{saved === 'saved' ? 'このブラウザに保存' : saved === 'saving' ? '保存中…' : '保存できません'}</span><span className="version-label">v0.2</span><span className="avatar">Y</span></div></header>
    {notice && <div className="global-notice" role="alert"><Icon name="alert" size={18}/><span>{notice}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => useUI.setState({ notice: '' })}><Icon name="close" size={16}/></button></div>}
    <main><Outlet/></main><footer className="app-footer"><span>path. <span>理解は、つながる。</span></span><span>すべての通信はブラウザ内の教育用シミュレーションです。</span></footer>
  </div></div>;
}
