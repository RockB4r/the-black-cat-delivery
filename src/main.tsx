import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ComplaintsBook } from './ComplaintsBook.tsx'
import { StaffPortal } from './staff/StaffPortal.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/staff' ? <StaffPortal /> : window.location.pathname === '/libro-de-reclamaciones' ? <ComplaintsBook /> : <App />}
  </StrictMode>,
)
