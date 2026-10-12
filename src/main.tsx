import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ComplaintsBook } from './ComplaintsBook.tsx'
import { PrivacyPolicy, ReturnsPolicy, TermsAndConditions } from './LegalPages.tsx'
import { StaffPortal } from './staff/StaffPortal.tsx'
import { KitchenDisplay } from './KitchenDisplay.tsx'
import { MemberPortal } from './MemberPortal.tsx'
import { AdminOrdersPortal } from './AdminOrdersPortal.tsx'
import { MetaPrivacyPolicy } from './MetaPrivacyPolicy.tsx'
import { MemberRegistration } from './MemberRegistration.tsx'
import { GiftCardPurchase } from './GiftCardPurchase.tsx'
import { GiftCardPage } from './GiftCardPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/staff' ? <StaffPortal /> : window.location.pathname === '/admin/pedidos' ? <AdminOrdersPortal /> : window.location.pathname === '/kitchen' ? <KitchenDisplay /> : window.location.pathname === '/socios' ? <MemberPortal /> : window.location.pathname === '/socios/registro' ? <MemberRegistration /> : window.location.pathname === '/libro-de-reclamaciones' ? <ComplaintsBook /> : window.location.pathname === '/terminos-y-condiciones' ? <TermsAndConditions /> : window.location.pathname === '/politica-de-privacidad' ? <PrivacyPolicy /> : window.location.pathname === '/politica-cambios-devoluciones' ? <ReturnsPolicy /> : window.location.pathname === '/privacy' ? <MetaPrivacyPolicy /> : window.location.pathname === '/gift-cards' ? <GiftCardPurchase /> : /^\/gift\/[a-f0-9]{64}$/.test(window.location.pathname) ? <GiftCardPage /> : <App />}
  </StrictMode>,
)
