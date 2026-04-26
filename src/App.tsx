import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Enroll } from './pages/Enroll'
import { Verify } from './pages/Verify'
import { ExamSession } from './pages/ExamSession'
import { AuthPayment } from './pages/AuthPayment'
import './index.css'

// VITE_MODE=payment → "/" sert AuthPayment (déploiement Mr de Villiers / pilote
// MaxSecurity). Toute autre valeur → comportement EDGUARD historique avec Home.
const PAYMENT_MODE = import.meta.env.VITE_MODE === 'payment'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={PAYMENT_MODE ? <AuthPayment /> : <Home />} />
        <Route path="/enroll"  element={<Enroll />} />
        <Route path="/verify"  element={<Verify />} />
        <Route path="/session" element={<ExamSession />} />
        <Route path="/auth-payment" element={<AuthPayment />} />
      </Routes>
    </BrowserRouter>
  )
}
