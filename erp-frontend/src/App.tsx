import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import AiAssistant from './components/AiAssistant'
import PageBreadcrumbs from './components/PageBreadcrumbs'
import SidebarNav from './components/SidebarNav'
import UserMenu from './components/UserMenu'
import './App.css'

const MOBILE_BREAKPOINT = 768

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  )

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

function App() {
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= MOBILE_BREAKPOINT : true,
  )
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  const toggleSidebar = () => setSidebarOpen((open) => !open)
  const closeSidebar = () => {
    if (isMobile) setSidebarOpen(false)
  }

  return (
    <div className={`app-shell${sidebarOpen ? '' : ' sidebar-collapsed'}${isMobile ? ' is-mobile' : ''}`}>
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <SidebarNav collapsed={!sidebarOpen} onNavigate={closeSidebar} />

      <div className="app-content">
        <header className="app-topbar">
          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={sidebarOpen}
          >
            <span className="app-hamburger" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
          <h1 className="app-topbar-title">Grand-Tek Technology USA</h1>
          <div className="app-topbar-actions">
            <button
              type="button"
              className={`ai-launcher${aiOpen ? ' active' : ''}`}
              onClick={() => setAiOpen((v) => !v)}
              aria-expanded={aiOpen}
            >
              AI Assistant
            </button>
            <UserMenu />
          </div>
        </header>
        <main className="app-main">
          <PageBreadcrumbs />
          <Outlet />
        </main>
      </div>

      <AiAssistant open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}

export default App
