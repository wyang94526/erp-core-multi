import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import AiAssistant from './components/AiAssistant'
import HelpDrawer from './components/help/HelpDrawer'
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
  const [helpOpen, setHelpOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  useEffect(() => {
    setHelpOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelpOpen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && !event.repeat && (event.key === '/' || event.code === 'Slash')) {
        event.preventDefault()
        setHelpOpen((open) => !open)
        setAiOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
              className={`ai-launcher help-launcher${helpOpen ? ' active' : ''}`}
              onClick={() => {
                setHelpOpen((open) => !open)
                setAiOpen(false)
              }}
              aria-expanded={helpOpen}
              aria-controls="help-drawer"
              title="Help (Ctrl or ⌘ + /)"
            >
              <CircleHelp size={16} aria-hidden />
              Help
            </button>
            <button
              type="button"
              className={`ai-launcher${aiOpen ? ' active' : ''}`}
              onClick={() => {
                setAiOpen((open) => !open)
                setHelpOpen(false)
              }}
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

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AiAssistant open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}

export default App
